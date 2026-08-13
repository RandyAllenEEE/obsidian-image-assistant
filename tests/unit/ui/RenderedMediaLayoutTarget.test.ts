import { describe, expect, it } from 'vitest';
import {
    collectRenderedMediaLayoutTargets,
    isStandaloneRenderedMediaTarget,
    resolveRenderedMediaLayoutTarget
} from '../../../src/ui/RenderedMediaLayoutTarget';

describe('RenderedMediaLayoutTarget', () => {
    it('resolves an Obsidian image and its native resize corner to the same outer owner', () => {
        const view = document.createElement('div');
        view.className = 'markdown-source-view';
        const embed = view.appendChild(document.createElement('span'));
        embed.className = 'external-embed image-embed';
        const wrapper = embed.appendChild(document.createElement('span'));
        wrapper.className = 'image-wrapper';
        const image = wrapper.appendChild(document.createElement('img'));
        const corner = wrapper.appendChild(document.createElement('div'));
        corner.className = 'image-resize-corner';

        const fromImage = resolveRenderedMediaLayoutTarget(image);
        const fromCorner = resolveRenderedMediaLayoutTarget(corner);

        expect(fromImage).toMatchObject({
            kind: 'obsidian-image', owner: embed, placement: embed, visual: image, image,
            captionAnchor: image,
            sizing: 'obsidian-native'
        });
        expect(fromCorner).toEqual(fromImage);
    });

    it('uses the same core-image contract for local, URL, data, SVG and drawing previews', () => {
        for (const source of [
            'photo.png',
            'https://cdn.example.com/photo.png',
            'data:image/png;base64,AA==',
            'diagram.svg',
            'diagram.excalidraw.svg',
            'diagram.excalidraw.png',
            'diagram.drawio.svg'
        ]) {
            const embed = document.createElement('span');
            embed.className = 'image-embed';
            const image = embed.appendChild(document.createElement('img'));
            image.setAttribute('src', source);
            image.className = 'excalidraw-svg';
            const target = resolveRenderedMediaLayoutTarget(image);
            expect(target).toMatchObject({
                kind: 'obsidian-image',
                owner: embed,
                placement: embed,
                visual: image,
                captionAnchor: image,
                image,
                sizing: 'obsidian-native'
            });
        }
    });

    it('requires the public Excalidraw marker and a unique outer image embed', () => {
        const view = document.createElement('div');
        view.className = 'markdown-preview-view';
        const owner = view.appendChild(document.createElement('span'));
        owner.className = 'internal-embed image-embed';
        const marker = owner.appendChild(document.createElement('div'));
        marker.className = 'excalidraw-embedded-img';
        marker.setAttribute('fileSource', 'Drawing.excalidraw.md');
        const svg = marker.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
        svg.classList.add('excalidraw-svg');
        document.body.appendChild(view);

        expect(resolveRenderedMediaLayoutTarget(svg)).toMatchObject({
            kind: 'excalidraw-source', owner, placement: owner, visual: marker,
            captionAnchor: svg,
            sizing: 'external-renderer'
        });
        expect(resolveRenderedMediaLayoutTarget(owner)).toMatchObject({
            kind: 'excalidraw-source', owner, placement: owner, visual: marker
        });

        const duplicate = owner.appendChild(marker.cloneNode(true));
        expect(resolveRenderedMediaLayoutTarget(svg)).toBeNull();
        owner.removeChild(duplicate);
        view.remove();
    });

    it('uses the unique structural wrapper when Reading Mode replaced image-embed', () => {
        const view = document.createElement('div');
        view.className = 'markdown-preview-view';
        const paragraph = view.appendChild(document.createElement('p'));
        const wrapper = paragraph.appendChild(document.createElement('div'));
        const marker = wrapper.appendChild(document.createElement('div'));
        marker.className = 'excalidraw-embedded-img';
        marker.setAttribute('fileSource', 'Drawing.excalidraw.md');
        const svg = marker.appendChild(document.createElementNS(
            'http://www.w3.org/2000/svg',
            'svg'
        ));
        svg.classList.add('excalidraw-svg');
        document.body.appendChild(view);

        expect(resolveRenderedMediaLayoutTarget(svg)).toMatchObject({
            kind: 'excalidraw-source', owner: wrapper, placement: wrapper, visual: marker,
            sizing: 'external-renderer'
        });

        wrapper.appendChild(document.createElement('span'));
        expect(resolveRenderedMediaLayoutTarget(svg)).toBeNull();
        view.remove();
    });

    it('fails closed for forged markers outside Markdown views', () => {
        const editor = document.createElement('div');
        editor.className = 'excalidraw-wrapper';
        const owner = editor.appendChild(document.createElement('span'));
        owner.className = 'image-embed';
        const marker = owner.appendChild(document.createElement('div'));
        marker.className = 'excalidraw-embedded-img';
        marker.setAttribute('fileSource', 'Drawing.excalidraw.md');
        const svg = marker.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
        svg.classList.add('excalidraw-svg');
        expect(resolveRenderedMediaLayoutTarget(svg)).toBeNull();
    });

    it('accepts a media-bearing cm-embed-block without promoting ordinary containers', () => {
        const view = document.createElement('div');
        view.className = 'markdown-source-view';
        const content = view.appendChild(document.createElement('div'));
        content.className = 'cm-content';
        const block = content.appendChild(document.createElement('div'));
        block.className = 'cm-embed-block image-embed';
        const image = block.appendChild(document.createElement('img'));

        const target = resolveRenderedMediaLayoutTarget(image)!;
        expect(target.owner).toBe(block);
        expect(target.placement).toBe(block);
        expect(target.owner.matches('.cm-embed-block.image-embed')).toBe(true);

        const ordinaryBlock = content.appendChild(document.createElement('div'));
        ordinaryBlock.className = 'cm-embed-block';
        const embed = ordinaryBlock.appendChild(document.createElement('span'));
        embed.className = 'image-embed';
        const nestedImage = embed.appendChild(document.createElement('img'));
        expect(resolveRenderedMediaLayoutTarget(nestedImage)?.owner).toBe(embed);
    });

    it('uses a safe HTML host when the Excalidraw public marker is the image surface', () => {
        const view = document.createElement('div');
        view.className = 'markdown-preview-view';
        const owner = view.appendChild(document.createElement('span'));
        owner.className = 'internal-embed image-embed';
        const image = owner.appendChild(document.createElement('img'));
        image.className = 'excalidraw-embedded-img';
        image.setAttribute('fileSource', 'Drawing.excalidraw.md');
        document.body.appendChild(view);

        const target = resolveRenderedMediaLayoutTarget(image)!;
        expect(target).toMatchObject({
            kind: 'excalidraw-source', owner, placement: owner,
            visual: image, captionAnchor: image
        });
        view.remove();
    });

    it('rejects a direct public Excalidraw marker without an outer owner', () => {
        const view = document.createElement('div');
        view.className = 'markdown-source-view';
        const content = view.appendChild(document.createElement('div'));
        content.className = 'cm-content';
        const marker = content.appendChild(document.createElement('div'));
        marker.className = 'excalidraw-embedded-img';
        marker.setAttribute('fileSource', 'Drawing.excalidraw.md');
        const svg = marker.appendChild(document.createElementNS(
            'http://www.w3.org/2000/svg', 'svg'
        ));
        svg.classList.add('excalidraw-svg');
        document.body.appendChild(view);

        expect(resolveRenderedMediaLayoutTarget(svg)).toBeNull();
        expect(content.hasAttribute('data-image-assistant-layout-owner')).toBe(false);
        view.remove();
    });

    it('deduplicates nested candidates by stable owner', () => {
        const root = document.createElement('div');
        const embed = root.appendChild(document.createElement('span'));
        embed.className = 'image-embed';
        const wrapper = embed.appendChild(document.createElement('span'));
        wrapper.className = 'image-wrapper';
        wrapper.appendChild(document.createElement('img'));
        expect(collectRenderedMediaLayoutTargets(root)).toHaveLength(1);
    });

    it('treats a media-only paragraph as standalone without inspecting sibling paragraphs', () => {
        const root = document.createElement('div');
        root.appendChild(document.createElement('p')).textContent = 'before';
        const paragraph = root.appendChild(document.createElement('p'));
        const image = paragraph.appendChild(document.createElement('img'));
        root.appendChild(document.createElement('p')).textContent = 'after';

        const target = resolveRenderedMediaLayoutTarget(image)!;
        expect(target.owner).toBe(paragraph);
        expect(isStandaloneRenderedMediaTarget(target)).toBe(true);
    });

    it('does not classify prose-adjacent media as standalone', () => {
        const paragraph = document.createElement('p');
        paragraph.append('before ');
        const image = paragraph.appendChild(document.createElement('img'));
        paragraph.append(' after');

        const target = resolveRenderedMediaLayoutTarget(image)!;
        expect(target.owner).toBe(image);
        expect(isStandaloneRenderedMediaTarget(target)).toBe(false);
    });
});
