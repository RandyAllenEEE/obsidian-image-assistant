import { App, MarkdownView, Editor, TFile } from 'obsidian';
import {
    createWikiLinkRegex,
    createMarkdownLinkRegex,
    createUrlLinkRegex
} from './RegexPatterns';

export class RefinedImageUtils {
    constructor(private app: App) { }

    /**
     * Extracts the full link text for an image from the editor content.
     * Attempts to find the specific instance of the image if possible, 
     * but currently defaults to finding the first match for the filename.
     * 
     * @param img - The HTMLImageElement in the DOM.
     * @param file - The file containing the image.
     * @returns The full link text (e.g. "![[image.png]]") or null if not found.
     */
    public getImageLinkText(img: HTMLImageElement, file: TFile): string | null {
        // Try getting it from the active editor if we are in one
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView && markdownView.file && markdownView.file.path === file.path) {
            return this.getImageLinkTextFromEditor(img, markdownView.editor);
        }

        // Fallback: Read file content directly (less precise for line numbers, but good for raw text)
        // TODO: Implement direct file reading fallback if needed, but Editor is preferred for live updates.
        return null;
    }

    /**
     * Extracts link text using the Editor instance.
     * 
     * @param img 
     * @param editor 
     * @returns 
     */
    public getImageLinkTextFromEditor(img: HTMLImageElement, editor: Editor): string | null {
        try {
            const src = img.getAttribute('src');
            if (!src) return null;

            let searchTerms: string[] = [];
            let isNetwork = false;
            let encodedSrc = "";
            let decodedSrc = "";

            if (src.startsWith('http')) {
                isNetwork = true;
                encodedSrc = src;
                try {
                    decodedSrc = decodeURIComponent(src);
                } catch (e) {
                    decodedSrc = src;
                }
                searchTerms.push(encodedSrc);
                if (encodedSrc !== decodedSrc) searchTerms.push(decodedSrc);
            } else {
                // Local/Internal
                const [cleanSrc] = src.split('?');
                try {
                    decodedSrc = decodeURIComponent(cleanSrc);
                } catch (e) {
                    decodedSrc = cleanSrc;
                }
                const imageName = decodedSrc.split(/[/\\]/).pop();
                if (imageName) searchTerms.push(imageName);
            }

            if (searchTerms.length === 0) return null;

            const lineCount = editor.lineCount();

            // Iterate lines to find the link - much safer than regex on full content
            for (let i = 0; i < lineCount; i++) {
                const line = editor.getLine(i);

                // Fast pre-flight check
                if (!searchTerms.some(term => line.includes(term))) continue;

                // If line contains the term, perform precise extraction
                if (isNetwork) {
                    const escapedEncoded = this.escapeRegexCharacters(encodedSrc);
                    const escapedDecoded = this.escapeRegexCharacters(decodedSrc);
                    const onlineRegex = createUrlLinkRegex(escapedEncoded, escapedDecoded);
                    const match = onlineRegex.exec(line);
                    if (match) {
                        // match[0] is the full match, e.g. ![alt](url)
                        return match[0];
                    }

                    // Fallback for Wiki-style network images
                    const wikiRegex = createWikiLinkRegex(escapedDecoded);
                    const wikiMatch = wikiRegex.exec(line);
                    if (wikiMatch) {
                        // regex captures inner content, need to reconstruct or capture full?
                        // createWikiLinkRegex captures full group 0 as entire match? 
                        // Check RegexPatterns.ts: It returns `RegExp('![[...]]', 'g')`
                        // So exec returns match[0] as the full string.
                        return wikiMatch[0];
                    }

                } else {
                    // Local Image
                    const imageName = searchTerms[0];
                    const escapedImageName = this.escapeRegexCharacters(imageName);

                    const wikiRegex = createWikiLinkRegex(escapedImageName);
                    let match = wikiRegex.exec(line);
                    if (match) return match[0];

                    const markdownRegex = createMarkdownLinkRegex(escapedImageName);
                    match = markdownRegex.exec(line);
                    if (match) return match[0];
                }
            }

            return null;
        } catch (error) {
            console.error('RefinedImageUtils: Error getting image link text:', error);
            return null;
        }
    }

    /**
     * Finds the line number where the linkText appears.
     * Supports attempting to find the Nth occurrence if we could determine identifying info.
     * For now, it finds the first occurrence or iterates if we add more logic.
     * 
     * @param editor 
     * @param linkText 
     * @returns 
     */
    public findLinkLineNumber(editor: Editor, linkText: string): number {
        const lineCount = editor.lineCount();

        for (let i = 0; i < lineCount; i++) {
            const line = editor.getLine(i);
            if (line.includes(linkText)) {
                return i;
            }
        }
        return -1;
    }

    private escapeRegexCharacters(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
