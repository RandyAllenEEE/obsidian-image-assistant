import { describe, expect, it, vi } from 'vitest';
import {
    IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE,
    ImageAlignment
} from '../../../src/ui/ImageAlignment';
import { resolveRenderedMediaLayoutTarget } from '../../../src/ui/RenderedMediaLayoutTarget';

function createAlignment(enableEditModeWrap = false): ImageAlignment {
    return new ImageAlignment({} as any, {
        settings: { alignment: { enabled: true, default: 'center', enableEditModeWrap } }
    } as any);
}

function createCoreImage(className = 'markdown-source-view') {
    const view = document.createElement('div');
    view.className = className;
    const embed = view.appendChild(document.createElement('span'));
    embed.className = 'internal-embed image-embed';
    const wrapper = embed.appendChild(document.createElement('span'));
    wrapper.className = 'image-wrapper';
    const image = wrapper.appendChild(document.createElement('img'));
    return { view, embed, wrapper, image };
}

describe('ImageAlignment', () => {
    it('uses one outer owner/placement and leaves native resize DOM untouched', () => {
        const alignment = createAlignment();
        const { embed, wrapper, image } = createCoreImage();
        const corner = wrapper.appendChild(document.createElement('div'));
        corner.className = 'image-resize-corner';
        image.setAttribute('width', '240');

        alignment.applyLayout(image, {
            alignment: 'center', wrap: false, source: 'image-default'
        });

        expect(embed.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(embed.getAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe('true');
        expect(embed.getAttribute('data-image-assistant-layout-flow')).toBe('block');
        expect(embed.getAttribute('data-image-assistant-align')).toBe('center');
        expect(wrapper.attributes).toHaveLength(1);
        expect(image.hasAttribute('data-image-assistant-layout-visual')).toBe(false);
        expect(image.getAttribute('width')).toBe('240');
        expect(image.style.width).toBe('');
        expect(wrapper.contains(corner)).toBe(true);
    });

    it('is idempotent and emits no attribute churn for an unchanged layout', async () => {
        const alignment = createAlignment();
        const { embed, image } = createCoreImage();
        const layout = { alignment: 'center', wrap: false, source: 'image-default' } as const;
        alignment.applyLayout(image, layout);
        const mutations: MutationRecord[] = [];
        const observer = new MutationObserver(records => mutations.push(...records));
        observer.observe(embed, { subtree: true, attributes: true });

        alignment.applyLayout(image, layout);
        await Promise.resolve();
        observer.disconnect();

        expect(mutations).toHaveLength(0);
    });

    it('cleans competing legacy owners while retaining one owner and placement', () => {
        const alignment = createAlignment();
        const { embed, wrapper, image } = createCoreImage();
        wrapper.className += ' image-converter-aligned image-position-left';
        wrapper.setAttribute('data-image-assistant-layout-owner', 'true');
        wrapper.setAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE, 'true');
        wrapper.setAttribute('data-image-assistant-layout-positioned', 'true');
        wrapper.style.setProperty('--image-assistant-layout-offset', '120px');
        document.body.appendChild(embed.parentElement!);

        alignment.applyLayout(image, { alignment: 'right', wrap: false, source: 'pipe' });

        expect(embed.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(embed.getAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe('true');
        expect(embed.querySelectorAll('[data-image-assistant-layout-owner]')).toHaveLength(0);
        expect(embed.querySelectorAll('[data-image-assistant-layout-placement]')).toHaveLength(0);
        expect(wrapper.hasAttribute('data-image-assistant-layout-positioned')).toBe(false);
        expect(wrapper.style.getPropertyValue('--image-assistant-layout-offset')).toBe('');
        expect(wrapper.classList.contains('image-position-left')).toBe(false);
        embed.parentElement?.remove();
    });

    it('removes only legacy plugin-owned inline dimensions before native layout', () => {
        const alignment = createAlignment();
        const { embed, image } = createCoreImage();
        image.style.width = '500px';
        image.style.height = 'auto';
        image.setAttribute('data-image-assistant-dimension-owner', 'true');
        image.setAttribute('data-image-assistant-dimension-mode', 'width');
        image.setAttribute('width', '320');

        alignment.applyLayout(image, {
            alignment: 'center', wrap: false, source: 'image-default'
        });

        expect(image.style.width).toBe('');
        expect(image.style.height).toBe('');
        expect(image.hasAttribute('data-image-assistant-dimension-owner')).toBe(false);
        expect(image.hasAttribute('data-image-assistant-dimension-mode')).toBe(false);
        expect(image.getAttribute('width')).toBe('320');
        expect(embed.getAttribute('data-image-assistant-layout-owner')).toBe('true');
    });

    it('preserves upstream layout and coordinator positioning during a replay', () => {
        const alignment = createAlignment();
        const first = createCoreImage();
        first.embed.style.display = 'inline-block';
        first.embed.style.float = 'right';
        first.embed.style.marginLeft = '13px';

        alignment.applyLayout(first.image, {
            alignment: 'center', wrap: false, source: 'image-default'
        });
        alignment.clearImage(first.image);
        expect(first.embed.style.display).toBe('inline-block');
        expect(first.embed.style.float).toBe('right');
        expect(first.embed.style.marginLeft).toBe('13px');

        const second = createCoreImage();
        alignment.applyLayout(second.image, {
            alignment: 'right', wrap: false, source: 'pipe'
        });
        second.embed.setAttribute('data-image-assistant-layout-positioned', 'true');
        second.embed.style.setProperty('--image-assistant-layout-offset', '25px');
        second.embed.style.position = 'relative';
        second.embed.style.left = '25px';
        alignment.applyLayout(second.image, {
            alignment: 'right', wrap: false, source: 'pipe'
        });
        expect(second.embed.getAttribute('data-image-assistant-layout-positioned')).toBe('true');
        expect(second.embed.style.getPropertyValue('--image-assistant-layout-offset')).toBe('25px');
        expect(second.embed.style.position).toBe('relative');
        expect(second.embed.style.left).toBe('25px');
    });

    it('uses a media-only paragraph as both owner and placement', () => {
        const alignment = createAlignment();
        const paragraph = document.createElement('p');
        const image = paragraph.appendChild(document.createElement('img'));
        image.src = 'https://cdn.example.com/image.png';

        alignment.applyLayout(image, { alignment: 'center', wrap: false, source: 'image-default' });

        const target = resolveRenderedMediaLayoutTarget(image)!;
        expect(target.owner).toBe(paragraph);
        expect(target.placement).toBe(paragraph);
        expect(paragraph.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(paragraph.getAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe('true');
        expect(image.hasAttribute('data-image-assistant-layout-owner')).toBe(false);
    });

    it('never writes layout state to CodeMirror structural containers', () => {
        const alignment = createAlignment();
        const view = document.createElement('div');
        view.className = 'markdown-source-view';
        const content = view.appendChild(document.createElement('div'));
        content.className = 'cm-content';
        const line = content.appendChild(document.createElement('div'));
        line.className = 'cm-line';
        const block = line.appendChild(document.createElement('div'));
        block.className = 'cm-embed-block';
        const embed = block.appendChild(document.createElement('span'));
        embed.className = 'internal-embed image-embed';
        const image = embed.appendChild(document.createElement('img'));

        alignment.applyLayout(image, {
            alignment: 'right', wrap: false, source: 'pipe'
        });

        expect(embed.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(embed.getAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe('true');
        for (const structural of [content, line, block]) {
            expect(structural.attributes).toHaveLength(1);
        }
    });

    it('keeps a direct URL widget self-owned without marking cm-content', () => {
        const alignment = createAlignment();
        const view = document.createElement('div');
        view.className = 'markdown-source-view';
        const content = view.appendChild(document.createElement('div'));
        content.className = 'cm-content';
        const image = content.appendChild(document.createElement('img'));

        alignment.applyLayout(image, {
            alignment: 'right', wrap: false, source: 'pipe'
        });

        expect(image.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(image.getAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe('true');
        expect(content.attributes).toHaveLength(1);
        expect(image.hasAttribute('data-image-assistant-layout-direct-widget')).toBe(false);
    });

    it('keeps inline prose-adjacent images on their own stable element', () => {
        const alignment = createAlignment();
        const paragraph = document.createElement('p');
        paragraph.append('before ');
        const image = paragraph.appendChild(document.createElement('img'));
        paragraph.append(' after');

        alignment.applyLayout(image, { alignment: 'left', wrap: false, source: 'pipe' });

        expect(resolveRenderedMediaLayoutTarget(image)?.owner).toBe(image);
        expect(image.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(image.getAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe('true');
        expect(paragraph.hasAttribute('data-image-assistant-layout-owner')).toBe(false);
    });

    it('resolves wrapping directly into semantic flow state', () => {
        const disabled = createAlignment(false);
        const first = createCoreImage();
        disabled.applyLayout(first.image, { alignment: 'left', wrap: true, source: 'pipe' });
        expect(first.embed.getAttribute('data-image-assistant-wrap')).toBe('false');
        expect(first.embed.getAttribute('data-image-assistant-layout-flow')).toBe('block');

        const enabled = createAlignment(true);
        const second = createCoreImage();
        enabled.applyLayout(second.image, { alignment: 'right', wrap: true, source: 'pipe' });
        expect(second.embed.getAttribute('data-image-assistant-wrap')).toBe('true');
        expect(second.embed.getAttribute('data-image-assistant-layout-flow')).toBe('float-end');
    });

    it('positions the outer Excalidraw owner without touching renderer geometry', () => {
        const alignment = createAlignment(true);
        const view = document.createElement('div');
        view.className = 'markdown-source-view';
        const owner = view.appendChild(document.createElement('span'));
        owner.className = 'internal-embed image-embed';
        const rendered = owner.appendChild(document.createElement('div'));
        rendered.className = 'excalidraw-embedded-img';
        rendered.setAttribute('fileSource', 'Drawings/Test.excalidraw.md');
        rendered.style.width = '200px';
        rendered.style.maxWidth = '720px';
        const svg = rendered.appendChild(document.createElementNS(
            'http://www.w3.org/2000/svg', 'svg'
        ));
        svg.classList.add('excalidraw-svg');
        document.body.appendChild(view);
        const target = resolveRenderedMediaLayoutTarget(svg)!;

        alignment.applyLayoutTarget(target, {
            alignment: 'center', wrap: false, source: 'image-default'
        });

        expect(target.owner).toBe(owner);
        expect(target.placement).toBe(owner);
        expect(owner.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(owner.getAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe('true');
        expect(rendered.hasAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe(false);
        expect(rendered.hasAttribute('data-image-assistant-layout-owner')).toBe(false);
        expect(rendered.hasAttribute('data-image-assistant-layout-visual')).toBe(false);
        expect(svg.attributes).toHaveLength(1);
        expect(rendered.style.width).toBe('200px');
        expect(rendered.style.maxWidth).toBe('720px');
        view.remove();
    });

    it('cleans legacy experimental state across the owner document once encountered', () => {
        const alignment = createAlignment();
        const staleLine = document.body.appendChild(document.createElement('div'));
        staleLine.className = 'cm-line';
        staleLine.setAttribute('data-image-assistant-layout-context', 'true');
        staleLine.setAttribute('data-image-assistant-layout-context-align', 'right');
        const staleWidget = document.body.appendChild(document.createElement('img'));
        staleWidget.setAttribute('data-image-assistant-layout-context-candidate', 'true');
        staleWidget.setAttribute('data-image-assistant-layout-direct-widget', 'true');
        staleWidget.setAttribute('data-image-assistant-layout-direct-widget-align', 'right');
        staleWidget.setAttribute('data-image-assistant-layout-visual', 'true');
        staleWidget.setAttribute('data-image-assistant-layout-positioned', 'true');
        staleWidget.style.setProperty('--image-assistant-layout-offset', '40px');
        const { image } = createCoreImage();

        alignment.applyLayout(image, { alignment: 'left', wrap: false, source: 'pipe' });

        expect(staleLine.attributes).toHaveLength(1);
        for (const attribute of [
            'data-image-assistant-layout-context-candidate',
            'data-image-assistant-layout-direct-widget',
            'data-image-assistant-layout-direct-widget-align',
            'data-image-assistant-layout-visual',
            'data-image-assistant-layout-positioned'
        ]) {
            expect(staleWidget.hasAttribute(attribute)).toBe(false);
        }
        expect(staleWidget.style.getPropertyValue('--image-assistant-layout-offset')).toBe('');
        staleLine.remove();
        staleWidget.remove();
    });

    it('supports popout documents and cleans all namespaced state', () => {
        const alignment = createAlignment();
        const popout = document.implementation.createHTMLDocument('popout');
        const embed = popout.createElement('span');
        embed.className = 'internal-embed image-embed';
        const image = embed.appendChild(popout.createElement('img'));
        popout.body.appendChild(embed);

        alignment.applyLayout(image, { alignment: 'left', wrap: false, source: 'pipe' });
        expect(embed.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(embed.getAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe('true');
        alignment.cleanup(popout);
        expect(embed.hasAttribute('data-image-assistant-layout-owner')).toBe(false);
        expect(embed.hasAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe(false);
    });

    it('clears semantic owner and placement together', () => {
        const alignment = createAlignment();
        const { embed, image } = createCoreImage();
        alignment.applyLayout(image, { alignment: 'right', wrap: false, source: 'pipe' });

        alignment.clearImage(image);

        expect(embed.hasAttribute('data-image-assistant-layout-owner')).toBe(false);
        expect(embed.hasAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)).toBe(false);
    });
});
