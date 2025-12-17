import { App, MarkdownView, Editor, TFile } from 'obsidian';

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
            const content = editor.getValue();
            const src = img.getAttribute('src');
            if (!src) return null;

            // Handle Online Images (http/https)
            if (src.startsWith('http')) {
                // For online images, the Markdown source usually contains the full URL.
                // We should try to find the URL exactly as it appears (or URI decoded).
                // Common formats: ![alt](url) or ![alt|size](url)

                // Strategy 1: Look for the exact src in a Markdown link structure
                // Use a simplified check first
                const encodedSrc = src;
                const decodedSrc = decodeURIComponent(src);

                // Escape for Regex
                const escapedEncoded = this.escapeRegexCharacters(encodedSrc);
                const escapedDecoded = this.escapeRegexCharacters(decodedSrc); // Handle cases where source text is decoded

                // Match: ![...]( ... url ... )
                // Note: We match the URL being present in the parentheses.
                // We construct a regex that looks for the URL ending a sequence or being the sequence.
                const onlineRegex = new RegExp(`!\\[([^\\]]*)\\]\\(([^)]*(${escapedEncoded}|${escapedDecoded})[^)]*)\\)`, 'g');

                let match = onlineRegex.exec(content);
                if (match) {
                    return `![${match[1]}](${match[2]})`;
                }
            }

            // Handle Local/Internal Images
            // Extract image path (remove query params)
            const [cleanSrc] = src.split('?');
            // Decode URI component to handle spaces and special chars correctly
            const decodedSrc = decodeURIComponent(cleanSrc);
            const imageName = decodedSrc.split(/[/\\]/).pop();

            if (!imageName) return null;

            const escapedImageName = this.escapeRegexCharacters(imageName);

            // Regex for Wiki links: ![[ ... imageName ... ]]
            // Allow for optional pipe params after filename
            const wikiRegex = new RegExp(`!\\[\\[([^\\]]*${escapedImageName}[^\\]]*)\\]\\]`, 'g');

            // Regex for Markdown links: ![ ... ]( ... imageName ... )
            const markdownRegex = new RegExp(`!\\[([^\\]]*)\\]\\(([^)]*${escapedImageName}[^)]*)\\)`, 'g');

            let match;

            // Try Wiki links
            while ((match = wikiRegex.exec(content)) !== null) {
                return `![[${match[1]}]]`;
            }

            // Try Markdown links
            while ((match = markdownRegex.exec(content)) !== null) {
                return `![${match[1]}](${match[2]})`;
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
