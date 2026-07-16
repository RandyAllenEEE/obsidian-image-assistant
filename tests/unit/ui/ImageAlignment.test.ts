import { describe, expect, it, vi } from "vitest";
import { ImageAlignment } from "../../../src/ui/ImageAlignment";
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pluginStyles = readFileSync(join(process.cwd(), 'styles.css'), 'utf8');

describe("ImageAlignment", () => {
    it("applies alignment to exactly one preferred layout owner", () => {
        const app = { workspace: { getActiveFile: vi.fn(() => ({ path: "note.md" })) } } as any;
        const alignment = new ImageAlignment(app, {} as any);
        const embed = document.createElement("span");
        embed.className = "internal-embed image-embed image-position-left image-wrap";
        const image = document.createElement("img");
        image.src = "image.png";
        embed.appendChild(image);

        alignment.applyAlignmentToImage(image, { position: "right", wrap: false, width: "320", height: "50%" });
        expect(image.classList.contains("image-position-right")).toBe(false);
        expect(image.style.width).toBe("320px");
        expect(image.style.height).toBe("50%");
        expect(embed.classList.contains("image-position-right")).toBe(true);
        expect(embed.classList.contains("image-no-wrap")).toBe(true);
        expect(embed.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(embed.querySelectorAll('[data-image-assistant-layout-owner]')).toHaveLength(0);

        alignment.applyAlignmentToImage(image, { position: "none", wrap: false });
        expect(image.classList.contains("image-converter-aligned")).toBe(false);
        expect(embed.classList.contains("image-converter-aligned")).toBe(false);
    });

    it("is idempotent and handles missing position data", () => {
        const alignment = new ImageAlignment({ workspace: { getActiveFile: () => ({ path: "note.md" }) } } as any, {} as any);
        const image = document.createElement("img");
        image.src = "image.png";
        image.className = "image-converter-aligned image-position-left image-wrap";
        image.style.width = "100px";
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

        alignment.applyAlignmentToImage(image, { position: "left", wrap: true, width: "100" });
        alignment.applyAlignmentToImage(image, undefined as any);
        expect(error).toHaveBeenCalled();
    });

    it("removes legacy plugin inline layout when alignment is cleared", () => {
        const alignment = new ImageAlignment({} as any, {} as any);
        const image = document.createElement('img');
        image.className = 'image-converter-aligned image-position-left image-wrap';
        image.style.display = 'inline-block';
        image.style.float = 'left';
        image.style.marginRight = '10px';

        alignment.clearImage(image);

        expect(image.className).toBe('');
        expect(image.style.display).toBe('');
        expect(image.style.float).toBe('');
        expect(image.style.marginRight).toBe('');
    });

    it("does not mutate an owner when the resolved layout is unchanged", async () => {
        const alignment = new ImageAlignment({} as any, {} as any);
        const embed = document.createElement('span');
        embed.className = 'internal-embed image-embed';
        const image = embed.appendChild(document.createElement('img'));
        const layout = { alignment: 'center', wrap: false, source: 'image-default' } as const;
        alignment.applyLayout(image, layout, { width: '320' });
        const mutations: MutationRecord[] = [];
        const observer = new MutationObserver(records => mutations.push(...records));
        observer.observe(embed, { subtree: true, attributes: true });

        alignment.applyLayout(image, layout, { width: '320' });
        await new Promise(resolve => setTimeout(resolve, 0));
        observer.disconnect();

        expect(mutations).toHaveLength(0);
    });

    it("does not write inline display styles for reading mode layout", () => {
        const alignment = new ImageAlignment({ workspace: { getActiveFile: () => null } } as any, {} as any);
        const image = document.createElement("img");
        alignment.ensureReadingModeLayout(image, "left");
        expect(image.style.display).toBe("");
        alignment.ensureReadingModeLayout(image, "none");
        expect(image.style.display).toBe("");

        const embed = document.createElement("span");
        embed.className = "internal-embed";
        embed.appendChild(image);
        alignment.ensureReadingModeLayout(image, "right");
        expect(image.style.display).toBe("");
    });

    it("reads current alignment without depending on the active file", () => {
        const workspace: any = { getActiveFile: vi.fn(() => ({ path: "note.md" })) };
        const alignment = new ImageAlignment({ workspace } as any, {} as any);
        const image = document.createElement("img");

        expect(alignment.getCurrentImageAlignment(image)).toEqual({ align: "none", wrap: false });
        image.setAttribute("src", "image.png");
        image.className = "image-position-center image-wrap";
        expect(alignment.getCurrentImageAlignment(image)).toEqual({ align: "center", wrap: true });

        workspace.getActiveFile.mockReturnValue(null);
        expect(alignment.getCurrentImageAlignment(image)).toEqual({ align: "center", wrap: true });
    });

    it("uses a standalone paragraph as the common owner and cleans all plugin state", () => {
        const alignment = new ImageAlignment({} as any, {} as any);
        const paragraph = document.createElement('p');
        const image = paragraph.appendChild(document.createElement('img'));

        alignment.applyLayout(image, { alignment: 'center', wrap: false, source: 'image-default' });
        expect(paragraph.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        expect(image.hasAttribute('data-image-assistant-layout-owner')).toBe(false);

        alignment.cleanup(paragraph);
        expect(paragraph.hasAttribute('data-image-assistant-layout-owner')).toBe(false);
        expect(paragraph.classList.contains('image-converter-aligned')).toBe(false);
    });

    it("transfers ownership to and from a temporary resize container", () => {
        const alignment = new ImageAlignment({} as any, {} as any);
        const embed = document.createElement('span');
        embed.className = 'internal-embed image-embed';
        const image = embed.appendChild(document.createElement('img'));
        alignment.applyLayout(image, { alignment: 'right', wrap: true, source: 'pipe' });

        const resize = document.createElement('div');
        resize.className = 'image-resize-container';
        embed.appendChild(resize);
        resize.appendChild(image);
        alignment.transferLayoutOwner(image, resize);
        expect(resize.getAttribute('data-image-assistant-align')).toBe('right');
        expect(embed.hasAttribute('data-image-assistant-layout-owner')).toBe(false);
        expect(image.hasAttribute('data-image-assistant-layout-owner')).toBe(false);

        const retainedLayout = alignment.getResolvedLayout(image);
        embed.insertBefore(image, resize);
        resize.remove();
        alignment.applyLayout(image, retainedLayout);
        expect(embed.getAttribute('data-image-assistant-align')).toBe('right');
    });

    it("supports image owners created by a popout document", () => {
        const alignment = new ImageAlignment({} as any, {} as any);
        const popout = document.implementation.createHTMLDocument('popout');
        const embed = popout.createElement('span');
        embed.className = 'internal-embed image-embed';
        const image = embed.appendChild(popout.createElement('img'));
        popout.body.appendChild(embed);

        alignment.applyLayout(image, { alignment: 'left', wrap: false, source: 'pipe' });
        expect(embed.getAttribute('data-image-assistant-layout-owner')).toBe('true');
        alignment.cleanup(popout);
        expect(embed.hasAttribute('data-image-assistant-layout-owner')).toBe(false);
    });

    it("ships one owner-scoped alignment stylesheet without legacy container rules", () => {
        expect(pluginStyles).toContain('[data-image-assistant-layout-owner="true"]');
        expect(pluginStyles).toContain('.image-assistant-live-preview-caption[data-image-assistant-caption-align="center"]');
        expect(pluginStyles).not.toContain('.external-image-container');
        expect(pluginStyles).not.toContain('.image-position-left:not(.image-wrap)');
        expect(pluginStyles.match(/\/\* ---------------------- IMAGE ALIGNMENT/g)).toHaveLength(1);
    });
});
