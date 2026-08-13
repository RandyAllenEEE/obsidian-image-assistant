import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderedMediaLayoutTarget } from '../../../../src/ui/RenderedMediaLayoutTarget';
import {
    CAPTION_GEOMETRY_ATTRIBUTE,
    LAYOUT_POSITIONED_ATTRIBUTE,
    LivePreviewImageLayoutCoordinator
} from '../../../../src/ui/caption/LivePreviewImageLayoutCoordinator';

function rect(left: number, width: number): DOMRect {
    return {
        left,
        right: left + width,
        top: 0,
        bottom: 100,
        width,
        height: 100,
        x: left,
        y: 0,
        toJSON: () => ({})
    } as DOMRect;
}

function createFrameHarness() {
    const callbacks = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        callbacks.set(++frameId, callback);
        return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
        callbacks.delete(id);
    });
    return {
        flushOne: () => {
            const pending = [...callbacks.entries()];
            callbacks.clear();
            pending.forEach(([id, callback]) => callback(id));
            return pending.length;
        },
        flush: () => {
            let flushed = 0;
            for (let guard = 0; callbacks.size > 0 && guard < 12; guard++) {
                const pending = [...callbacks.entries()];
                callbacks.clear();
                pending.forEach(([id, callback]) => callback(id));
                flushed += pending.length;
            }
            return flushed;
        },
        callbacks
    };
}

interface ObserverHarness {
    resize: TestResizeObserver[];
    mutation: TestMutationObserver[];
}

interface TestResizeObserver {
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    callback: ResizeObserverCallback;
}

interface TestMutationObserver {
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    callback: MutationCallback;
}

function installObservers(restores: Array<() => void>): ObserverHarness {
    const resize: TestResizeObserver[] = [];
    const mutation: TestMutationObserver[] = [];

    class FakeResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(readonly callback: ResizeObserverCallback) {
            resize.push(this);
        }
    }
    class FakeMutationObserver {
        observe = vi.fn();
        disconnect = vi.fn();
        takeRecords = vi.fn(() => []);
        constructor(readonly callback: MutationCallback) {
            mutation.push(this);
        }
    }

    for (const [name, value] of [
        ['ResizeObserver', FakeResizeObserver],
        ['MutationObserver', FakeMutationObserver]
    ] as const) {
        const original = Object.getOwnPropertyDescriptor(window, name);
        Object.defineProperty(window, name, { configurable: true, value });
        restores.push(() => original
            ? Object.defineProperty(window, name, original)
            : delete (window as unknown as Record<string, unknown>)[name]);
    }
    return { resize, mutation };
}

function createCaption(root: HTMLElement, key: string): HTMLElement {
    const caption = root.appendChild(document.createElement('span'));
    caption.className = 'image-assistant-live-preview-caption';
    caption.setAttribute('data-image-assistant-caption-renderer', 'codemirror');
    caption.setAttribute('data-image-assistant-layout-key', key);
    caption.setAttribute('data-image-assistant-caption-width', 'auto');
    caption.setAttribute('data-image-assistant-caption-wrap', 'false');
    return caption;
}

function createTarget(
    owner: HTMLElement,
    placement: HTMLElement,
    image: HTMLImageElement
): RenderedMediaLayoutTarget {
    return {
        kind: 'obsidian-image',
        owner,
        placement,
        visual: image,
        captionAnchor: image,
        image,
        sizing: 'obsidian-native'
    } as RenderedMediaLayoutTarget;
}

function pixels(element: HTMLElement, property: string): number {
    return Number.parseFloat(element.style.getPropertyValue(property)) || 0;
}

function snapshotAttributes(element: Element): readonly (readonly [string, string])[] {
    return Array.from(element.attributes)
        .map(attribute => [attribute.name, attribute.value] as const)
        .sort(([left], [right]) => left.localeCompare(right));
}

function mutationRecord(
    addedNodes: Node[] = [],
    removedNodes: Node[] = []
): MutationRecord {
    return {
        addedNodes: addedNodes as unknown as NodeList,
        removedNodes: removedNodes as unknown as NodeList,
        attributeName: null,
        attributeNamespace: null,
        nextSibling: null,
        oldValue: null,
        previousSibling: null,
        target: document.body,
        type: 'childList'
    };
}

describe('LivePreviewImageLayoutCoordinator', () => {
    const restores: Array<() => void> = [];

    afterEach(() => {
        while (restores.length) restores.pop()?.();
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    it('atomically aligns a right image and Caption from one content-container scope', () => {
        const frames = createFrameHarness();
        const observers = installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        const editor = root.appendChild(document.createElement('div'));
        editor.className = 'cm-editor';
        const contentContainer = editor.appendChild(document.createElement('div'));
        contentContainer.className = 'cm-contentContainer';
        const zeroWidthContent = contentContainer.appendChild(document.createElement('div'));
        zeroWidthContent.className = 'cm-content';
        const placement = zeroWidthContent.appendChild(document.createElement('span'));
        const image = placement.appendChild(document.createElement('img'));
        const caption = createCaption(root, 'right-image');

        vi.spyOn(contentContainer, 'getBoundingClientRect').mockReturnValue(rect(100, 1000));
        vi.spyOn(zeroWidthContent, 'getBoundingClientRect').mockReturnValue(rect(777, 1));
        vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() =>
            rect(140 + pixels(placement, '--image-assistant-layout-offset'), 200)
        );
        vi.spyOn(caption, 'getBoundingClientRect').mockImplementation(() =>
            rect(110 + pixels(caption, '--image-assistant-caption-offset'), 200)
        );

        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerTarget(createTarget(placement, placement, image), 'right-image', {
            standalone: true,
            scope: 'root',
            alignment: 'right',
            wrap: false
        });
        frames.flush();

        // desiredLeft = 100 + (1000 - 200) = 900 for both outputs.
        expect(placement.getAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe('true');
        expect(placement.getAttribute('data-image-assistant-layout-key')).toBe('right-image');
        expect(image.hasAttribute('data-image-assistant-layout-key')).toBe(false);
        expect(placement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('760px');
        expect(caption.getAttribute(CAPTION_GEOMETRY_ATTRIBUTE)).toBe('true');
        expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('790px');
        expect(caption.style.getPropertyValue('--image-assistant-caption-rendered-width')).toBe('200px');
        expect(image.getBoundingClientRect().left).toBe(900);
        expect(caption.getBoundingClientRect().left).toBe(900);

        // The zero-width .cm-content must never become the measurement scope.
        expect(zeroWidthContent.getBoundingClientRect).not.toHaveBeenCalled();
        expect(observers.resize[0].observe).toHaveBeenCalledWith(root);
        expect(observers.resize[0].observe).toHaveBeenCalledWith(contentContainer);
        expect(observers.resize[0].observe).toHaveBeenCalledWith(placement);
        expect(observers.resize[0].observe).toHaveBeenCalledWith(image);
        expect(observers.resize[0].observe).not.toHaveBeenCalledWith(caption);
        coordinator.destroy();
    });

    it('recomputes replacement geometry without copying an old raw offset', () => {
        const frames = createFrameHarness();
        const observers = installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 800));
        const removedWrapper = root.appendChild(document.createElement('div'));
        const firstPlacement = removedWrapper.appendChild(document.createElement('span'));
        const first = firstPlacement.appendChild(document.createElement('img'));
        const caption = createCaption(root, 'virtualized');
        vi.spyOn(first, 'getBoundingClientRect').mockImplementation(() =>
            rect(120 + pixels(firstPlacement, '--image-assistant-layout-offset'), 200)
        );
        vi.spyOn(caption, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(caption, '--image-assistant-caption-offset'), 200)
        );

        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        const firstTarget = createTarget(firstPlacement, firstPlacement, first);
        coordinator.registerTarget(firstTarget, 'virtualized', {
            standalone: true,
            scope: 'root',
            alignment: 'right',
            wrap: false
        });
        frames.flush();
        expect(firstPlacement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('480px');
        expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('600px');

        coordinator.detachSubtree(removedWrapper);
        expect(firstPlacement.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe(false);
        expect(firstPlacement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('');
        expect(firstPlacement.hasAttribute('data-image-assistant-layout-key')).toBe(false);
        expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('600px');
        expect(observers.resize[0].unobserve).toHaveBeenCalledWith(first);
        removedWrapper.remove();
        const replacementPlacement = root.appendChild(document.createElement('span'));
        const replacement = replacementPlacement.appendChild(document.createElement('img'));
        vi.spyOn(replacement, 'getBoundingClientRect').mockImplementation(() =>
            rect(150 + pixels(replacementPlacement, '--image-assistant-layout-offset'), 200)
        );
        const replacementTarget = createTarget(
            replacementPlacement,
            replacementPlacement,
            replacement
        );
        coordinator.registerTarget(replacementTarget, 'virtualized', {
            standalone: true,
            scope: 'root',
            alignment: 'right',
            wrap: false
        });

        // The old 480px offset belongs to the removed node's 120px baseline.
        // It must never be copied to the replacement's 150px baseline.
        expect(replacementPlacement.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe(false);
        expect(replacementPlacement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('');
        expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('600px');

        frames.flush();
        // The next read corrects the replacement's different zero-offset baseline.
        expect(replacementPlacement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('450px');
        expect(replacement.getBoundingClientRect().left).toBe(600);
        expect(caption.getBoundingClientRect().left).toBe(600);
        coordinator.destroy();
    });

    it('settles for the requested stable frames and stops after twelve unstable frames', () => {
        const frames = createFrameHarness();
        installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 600));
        const placement = root.appendChild(document.createElement('span'));
        const image = placement.appendChild(document.createElement('img'));
        vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(placement, '--image-assistant-layout-offset'), 200)
        );
        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerTarget(createTarget(placement, placement, image), 'settle', {
            standalone: true,
            scope: 'root',
            alignment: 'center',
            wrap: false
        });
        expect(frames.flush()).toBe(4);

        coordinator.schedule(1);
        expect(frames.flush()).toBe(2);
        coordinator.schedule(3);
        expect(frames.flush()).toBe(4);

        let width = 200;
        vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(placement, '--image-assistant-layout-offset'), ++width)
        );
        coordinator.schedule(3);
        expect(frames.flush()).toBe(12);
        expect(frames.callbacks.size).toBe(0);
        coordinator.destroy();
    });

    it('observes and reacts to the actual scope without observing Caption', () => {
        const frames = createFrameHarness();
        const observers = installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        const editor = root.appendChild(document.createElement('div'));
        editor.className = 'cm-editor';
        const scope = editor.appendChild(document.createElement('div'));
        scope.className = 'cm-contentContainer';
        const placement = scope.appendChild(document.createElement('span'));
        const image = placement.appendChild(document.createElement('img'));
        const caption = createCaption(root, 'resized-scope');
        let scopeWidth = 600;
        vi.spyOn(scope, 'getBoundingClientRect').mockImplementation(() => rect(0, scopeWidth));
        vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(placement, '--image-assistant-layout-offset'), 200)
        );
        vi.spyOn(caption, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(caption, '--image-assistant-caption-offset'), 200)
        );

        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerTarget(createTarget(placement, placement, image), 'resized-scope', {
            standalone: true,
            scope: 'root',
            alignment: 'right',
            wrap: false
        });
        frames.flush();
        expect(placement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('400px');
        expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('400px');
        expect(observers.resize[0].observe).toHaveBeenCalledWith(scope);
        expect(observers.resize[0].observe).toHaveBeenCalledWith(placement);
        expect(observers.resize[0].observe).toHaveBeenCalledWith(image);
        expect(observers.resize[0].observe).not.toHaveBeenCalledWith(caption);

        scopeWidth = 800;
        observers.resize[0].callback([], observers.resize[0] as unknown as ResizeObserver);
        frames.flush();
        expect(placement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('600px');
        expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('600px');
        coordinator.destroy();
    });

    it.each(['owner', 'placement', 'visual', 'captionAnchor'] as const)(
        'detachSubtree matches a removed %s boundary',
        boundary => {
            const frames = createFrameHarness();
            const observers = installObservers(restores);
            const root = document.body.appendChild(document.createElement('div'));
            vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 600));
            const owner = root.appendChild(document.createElement('div'));
            const placement = root.appendChild(document.createElement('div'));
            const visual = root.appendChild(
                document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            );
            const captionAnchor = root.appendChild(document.createElement('img'));
            vi.spyOn(captionAnchor, 'getBoundingClientRect').mockReturnValue(rect(0, 200));
            const target = {
                kind: 'excalidraw-source',
                owner,
                placement,
                visual,
                captionAnchor,
                image: captionAnchor,
                sizing: 'external-renderer'
            } as RenderedMediaLayoutTarget;
            const coordinator = new LivePreviewImageLayoutCoordinator(root);
            coordinator.registerTarget(target, `removed-${boundary}`, {
                standalone: true,
                scope: 'root',
                alignment: 'center',
                wrap: false
            });
            frames.flush();
            expect(placement.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe(true);

            coordinator.detachSubtree(target[boundary]);

            expect((coordinator as any).tracked.size).toBe(0);
            expect(placement.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe(false);
            expect(placement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('');
            expect(observers.resize[0].unobserve).toHaveBeenCalledWith(captionAnchor);
            coordinator.destroy();
        }
    );

    it('discovers replacement Captions only through narrow child-list observation', () => {
        const frames = createFrameHarness();
        const observers = installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 600));
        const placement = root.appendChild(document.createElement('span'));
        const image = placement.appendChild(document.createElement('img'));
        vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(placement, '--image-assistant-layout-offset'), 200)
        );
        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerTarget(createTarget(placement, placement, image), 'late-caption', {
            standalone: true,
            scope: 'root',
            alignment: 'center',
            wrap: false
        });
        frames.flush();

        const caption = createCaption(root, 'late-caption');
        vi.spyOn(caption, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(caption, '--image-assistant-caption-offset'), 200)
        );
        observers.mutation[0].callback(
            [mutationRecord([caption])],
            observers.mutation[0] as unknown as MutationObserver
        );
        frames.flush();

        expect(observers.mutation[0].observe).toHaveBeenCalledWith(root, {
            childList: true,
            subtree: true
        });
        expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('200px');
        expect(caption.style.getPropertyValue('--image-assistant-caption-rendered-width')).toBe('200px');
        expect(observers.resize[0].observe).not.toHaveBeenCalledWith(caption);
        coordinator.destroy();
    });

    it('keeps external SVG and IMG attributes and styles strictly read-only', () => {
        const frames = createFrameHarness();
        const observers = installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 600));
        const owner = root.appendChild(document.createElement('div'));
        const placement = owner.appendChild(document.createElement('div'));
        const svg = placement.appendChild(
            document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        );
        const image = placement.appendChild(document.createElement('img'));
        svg.setAttribute('viewBox', '0 0 320 180');
        svg.setAttribute('data-upstream-svg', 'preserve');
        svg.setAttribute('data-image-assistant-layout-key', 'upstream-svg-key');
        svg.setAttribute('data-image-assistant-layout-positioned', 'upstream-svg-position');
        svg.setAttribute('style', 'display: block; color: rgb(1, 2, 3);');
        image.setAttribute('src', 'data:image/png;base64,upstream');
        image.setAttribute('data-upstream-image', 'preserve');
        image.setAttribute('data-image-assistant-layout-key', 'upstream-image-key');
        image.setAttribute('style', 'max-width: 73%; opacity: 0.8;');
        const svgBefore = snapshotAttributes(svg);
        const imageBefore = snapshotAttributes(image);
        vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() =>
            rect(50 + pixels(placement, '--image-assistant-layout-offset'), 200)
        );
        const target = {
            kind: 'excalidraw-source',
            owner,
            placement,
            visual: svg,
            captionAnchor: image,
            image,
            sizing: 'external-renderer'
        } as RenderedMediaLayoutTarget;

        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerTarget(target, 'external', {
            standalone: true,
            scope: 'root',
            alignment: 'center',
            wrap: false
        });
        frames.flush();

        expect(placement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('150px');
        expect(placement.getAttribute('data-image-assistant-layout-key')).toBe('external');
        expect(owner.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe(false);
        expect(owner.getAttribute('style')).toBeNull();
        expect(snapshotAttributes(svg)).toEqual(svgBefore);
        expect(snapshotAttributes(image)).toEqual(imageBefore);
        expect(observers.resize[0].observe).toHaveBeenCalledWith(image);
        coordinator.destroy();
        expect(snapshotAttributes(svg)).toEqual(svgBefore);
        expect(snapshotAttributes(image)).toEqual(imageBefore);
        expect(placement.hasAttribute('data-image-assistant-layout-key')).toBe(false);
    });

    it('coalesces geometry signals and does not create an observer feedback loop', () => {
        const frames = createFrameHarness();
        const observers = installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 600));
        const placement = root.appendChild(document.createElement('span'));
        const image = placement.appendChild(document.createElement('img'));
        const caption = createCaption(root, 'stable');
        vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(placement, '--image-assistant-layout-offset'), 200)
        );
        vi.spyOn(caption, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(caption, '--image-assistant-caption-offset'), 200)
        );
        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerTarget(createTarget(placement, placement, image), 'stable', {
            standalone: true,
            scope: 'root',
            alignment: 'center',
            wrap: false
        });

        coordinator.schedule();
        coordinator.schedule(4);
        expect(frames.callbacks.size).toBe(1);
        frames.flush();
        expect(frames.callbacks.size).toBe(0);

        observers.resize[0].callback([], observers.resize[0] as unknown as ResizeObserver);
        observers.resize[0].callback([], observers.resize[0] as unknown as ResizeObserver);
        expect(frames.callbacks.size).toBe(1);
        frames.flush();
        expect(frames.callbacks.size).toBe(0);
        expect(observers.resize[0].observe).not.toHaveBeenCalledWith(caption);
        coordinator.destroy();
    });

    it('clears managed geometry for wrap or inline media', () => {
        const frames = createFrameHarness();
        installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 600));
        const placement = root.appendChild(document.createElement('span'));
        const image = placement.appendChild(document.createElement('img'));
        const caption = createCaption(root, 'wrap');
        vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect(0, 200));
        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        const target = createTarget(placement, placement, image);
        coordinator.registerTarget(target, 'wrap', {
            standalone: true,
            scope: 'root',
            alignment: 'right',
            wrap: false
        });
        frames.flush();
        expect(placement.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe(true);

        coordinator.registerTarget(target, 'wrap', {
            standalone: true,
            scope: 'root',
            alignment: 'right',
            wrap: true
        });
        frames.flush();
        expect(placement.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe(false);
        expect(placement.style.getPropertyValue('--image-assistant-layout-offset')).toBe('');
        expect(caption.hasAttribute(CAPTION_GEOMETRY_ATTRIBUTE)).toBe(false);
        coordinator.destroy();
    });

    it('unregisters a production image target by its rendered image', () => {
        const frames = createFrameHarness();
        installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 600));
        const owner = root.appendChild(document.createElement('span'));
        const image = owner.appendChild(document.createElement('img'));
        vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() =>
            rect(pixels(owner, '--image-assistant-layout-offset'), 200)
        );
        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerTarget(createTarget(owner, owner, image), 'removed-image', {
            standalone: true,
            scope: 'root',
            alignment: 'right',
            wrap: false
        });
        frames.flush();
        expect(owner.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe(true);
        expect(owner.getAttribute('data-image-assistant-layout-key')).toBe('removed-image');

        coordinator.unregisterImage(image);

        expect((coordinator as any).tracked.size).toBe(0);
        expect(owner.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)).toBe(false);
        expect(owner.style.getPropertyValue('--image-assistant-layout-offset')).toBe('');
        expect(owner.hasAttribute('data-image-assistant-layout-key')).toBe(false);
        coordinator.destroy();
    });

    it('avoids global interaction listeners', () => {
        createFrameHarness();
        const observers = installObservers(restores);
        const root = document.body.appendChild(document.createElement('div'));
        const placement = root.appendChild(document.createElement('span'));
        const image = placement.appendChild(document.createElement('img'));
        const windowEvents = vi.spyOn(window, 'addEventListener');
        const documentEvents = vi.spyOn(document, 'addEventListener');
        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerTarget(createTarget(placement, placement, image), 'no-global-events', {
            standalone: true,
            scope: 'root',
            alignment: 'left',
            wrap: false
        });

        expect(observers.resize[0].observe).toHaveBeenCalledWith(image);
        const forbidden = new Set([
            'pointermove',
            'mousemove',
            'scroll',
            'focus',
            'transitionrun',
            'transitionend'
        ]);
        expect(windowEvents.mock.calls.some(([name]) => forbidden.has(String(name)))).toBe(false);
        expect(documentEvents.mock.calls.some(([name]) => forbidden.has(String(name)))).toBe(false);
        coordinator.destroy();
    });
});
