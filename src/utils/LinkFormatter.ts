import { App, TFile, Notice, MarkdownView } from "obsidian";
import { EditorView } from "@codemirror/view";
import { LinkFormat, PathFormat } from "../settings/LinkFormatSettings";
import { EmbedResizeSettings, ResizeScaleMode, ResizeUnits } from "../settings/NonDestructiveResizeSettings";
import { loadImage } from "./ImageLoadUtils";
import { LocalImageReferenceSerializer } from "./LocalImageReferenceSerializer";


export class LinkFormatter {
    private readonly referenceSerializer: LocalImageReferenceSerializer;

    constructor(private app: App) {
        this.referenceSerializer = new LocalImageReferenceSerializer(app);
    }

    async formatLink(
        linkPath: string,
        linkFormat: LinkFormat,
        pathFormat: PathFormat,
        activeFile: TFile | null,
        embedResize?: EmbedResizeSettings | null,
        prependCurrentDir = true
    ): Promise<string> {
        if (!linkPath) {
            throw new Error("Link path cannot be empty.");
        }

        // Get the TFile object using the provided linkPath
        const file = this.app.vault.getAbstractFileByPath(linkPath);

        // Check if the file exists
        if (!(file instanceof TFile)) {
            throw new Error(`No file found at path: ${linkPath}`);
        }

        if (pathFormat === "relative" && !activeFile) {
            throw new Error("Cannot format relative path without an active file.");
        }

        let resizeParams = "";
        if (embedResize) {
            resizeParams = await this.getResizeParams(
                embedResize,
                file
            );
        }

        return this.referenceSerializer.serialize({
            target: file,
            sourceFile: activeFile ?? file,
            settings: { linkFormat, pathFormat, prependCurrentDir },
            attributes: linkFormat === "wikilink" ? resizeParams.replace(/^\|/, "") : resizeParams
        });
    }


    // Add helper function to generate resize parameters
    private async getResizeParams(
        embedResize: EmbedResizeSettings,
        file: TFile
    ): Promise<string> {
        let resizeParams = "";
        const originalDimensions = await this.getImageDimensions(file);

        if (!originalDimensions) {
            console.warn(
                `Could not get dimensions for ${file.name}. No resizing applied.`
            );
            return "";
        }

        let width: number | undefined;
        let height: number | undefined;
        let longestEdge: number | undefined;
        let shortestEdge: number | undefined;

        // 1. Calculate dimensions based on the configured embed resize mode.
        switch (embedResize.resizeDimension) {
            case "width":
                width = this.getDimensionValue(
                    embedResize.width,
                    originalDimensions.width,
                    embedResize.resizeUnits
                );
                break;
            case "height":
                height = this.getDimensionValue(
                    embedResize.height,
                    originalDimensions.height,
                    embedResize.resizeUnits
                );
                break;
            case "both":
                if (embedResize.width !== undefined || embedResize.height !== undefined) {
                    width = this.getDimensionValue(
                        embedResize.width,
                        originalDimensions.width,
                        embedResize.resizeUnits
                    );
                    height = this.getDimensionValue(
                        embedResize.height,
                        originalDimensions.height,
                        embedResize.resizeUnits
                    );
                } else if (embedResize.customValue) {
                    const dimensions = this.parseCustomDimensions(
                        embedResize.customValue,
                        originalDimensions,
                        embedResize.resizeUnits
                    );
                    ({ width, height } = dimensions);
                }
                break;
            case "longest-edge":
                longestEdge = this.getDimensionValue(
                    embedResize.longestEdge,
                    Math.max(
                        originalDimensions.width,
                        originalDimensions.height
                    ),
                    embedResize.resizeUnits
                );
                width = originalDimensions.width >= originalDimensions.height
                    ? longestEdge
                    : undefined;
                height = originalDimensions.height > originalDimensions.width
                    ? longestEdge
                    : undefined;
                break;
            case "shortest-edge":
                shortestEdge = this.getDimensionValue(
                    embedResize.shortestEdge,
                    Math.min(
                        originalDimensions.width,
                        originalDimensions.height
                    ),
                    embedResize.resizeUnits
                );
                width = originalDimensions.width < originalDimensions.height
                    ? shortestEdge
                    : undefined;
                height = originalDimensions.height <= originalDimensions.width
                    ? shortestEdge
                    : undefined;
                break;
            case "original-width":
                width = originalDimensions.width;
                break;
            case "original-height":
                height = originalDimensions.height;
                break;
            case "editor-max-width": {
                const editorMaxWidth = this.getEditorMaxWidth();

                if (!editorMaxWidth || isNaN(editorMaxWidth)) {
                    console.warn("Invalid editorMaxWidth:", editorMaxWidth);
                    return "";
                }

                if (embedResize.editorMaxWidthValue === undefined || isNaN(embedResize.editorMaxWidthValue)) {
                    console.warn("Invalid editorMaxWidthValue:", embedResize.editorMaxWidthValue);
                    return "";
                }

                // Calculate the target width
                const targetWidth = embedResize.resizeUnits === "percentage"
                    ? Math.round((editorMaxWidth * embedResize.editorMaxWidthValue) / 100)
                    : embedResize.editorMaxWidthValue;

                width = targetWidth;
                break;
            }
            case "none":
            default:
                return ""; // No resize parameters
        }

        // 2. Apply Scale Mode (Reduce/Enlarge)
        if (width !== undefined) {
            width = this.applyScaleModeToDimension(
                width,
                originalDimensions.width,
                embedResize.resizeScaleMode
            );
        }
        if (height !== undefined) {
            height = this.applyScaleModeToDimension(
                height,
                originalDimensions.height,
                embedResize.resizeScaleMode
            );
        }

        // 3. Apply Editor Max Width Constraint (if applicable and width is defined)
        if (embedResize.respectEditorMaxWidth && width !== undefined) {
            const editorMaxWidth = this.getEditorMaxWidth();
            if (width > editorMaxWidth) {
                if (embedResize.maintainAspectRatio && height !== undefined) {
                    height = Math.round(
                        editorMaxWidth *
                        originalDimensions.height /
                        originalDimensions.width
                    );
                }
                width = editorMaxWidth;
            }
        }

        // 4. Build the canonical single- or double-axis PipeSyntax.
        if (width !== undefined || height !== undefined) {
            const roundedWidth = width !== undefined ? Math.round(width) : undefined;
            const roundedHeight = height !== undefined ? Math.round(height) : undefined;
            if (roundedWidth !== undefined && roundedHeight !== undefined) {
                resizeParams = `|${roundedWidth}x${roundedHeight}`;
            } else if (roundedWidth !== undefined) {
                const preservesTrailingAxis = embedResize.resizeDimension === 'both'
                    && /^\s*\d+(?:\.\d+)?%?x\s*$/.test(embedResize.customValue ?? '');
                resizeParams = `|${roundedWidth}${preservesTrailingAxis ? 'x' : ''}`;
            } else {
                resizeParams = `|x${roundedHeight}`;
            }
        } else {
            resizeParams = "";
        }

        return resizeParams;
    }

    private getDimensionValue(configuredValue: number | undefined, originalDimension: number, resizeUnits: ResizeUnits): number | undefined {
        if (configuredValue === undefined) return undefined;
        if (resizeUnits === "percentage") {
            return Math.round(originalDimension * configuredValue / 100);
        }
        return configuredValue;
    }

    private parseCustomDimensions(customValue: string, originalDimensions: { width: number, height: number }, resizeUnits: ResizeUnits): { width: number | undefined, height: number | undefined } {
        const match = customValue.match(/(\d*(?:\.\d+)?)(%)?x(\d*(?:\.\d+)?)(%)?/); // Allow decimal percentages
        if (!match) return { width: undefined, height: undefined };

        let width = match[1] ? parseFloat(match[1]) : undefined;
        let height = match[3] ? parseFloat(match[3]) : undefined;

        if (resizeUnits === "percentage") {
            if (width !== undefined) {
                width = Math.round(originalDimensions.width * width / 100);
            }
            if (height !== undefined) {
                height = Math.round(originalDimensions.height * height / 100);
            }
        }

        return { width, height };
    }

    private applyScaleModeToDimension(currentDimension: number, originalDimension: number, scaleMode: ResizeScaleMode): number {
        if (scaleMode === "reduce" && currentDimension > originalDimension) {
            return originalDimension;
        }
        if (scaleMode === "enlarge" && currentDimension < originalDimension) {
            return originalDimension;
        }
        return currentDimension;
    }

    /**
         * `getEditorMaxWidth`
         *
         * Calculates the maximum width (in pixels) available for content within the editor.
         * This function specifically targets the width of a single line element (`cm-line`)
         * in the CodeMirror 6 editor, providing a good approximation of the usable
         * horizontal space for text.
         *
         * **Why this approach?**
         * - The Obsidian API does not directly expose the editor's line width.
         * - We need to measure the width of a `cm-line` element, which is an internal
         *   implementation detail of CodeMirror.
         * - `clientWidth` is used because it gives the inner width of the element
         *   (including padding), which closely reflects the actual space available
         *   for text content.
         *
         * **Important Considerations:**
         * - This method relies on the `cm-line` class, which is part of CodeMirror 6's
         *   internal structure. Future CodeMirror updates *could* potentially change this,
         *   although it's less likely than changes to higher-level CSS classes.
         * - If the editor is empty, there might be no `cm-line` element. The function
         *   handles this with a fallback.
         * - This is still an approximation. Minor variations in line width might occur
         *   due to font size differences or other styling applied to specific lines.
         *
         * @returns {number} The maximum width available for content in the editor (width of a `cm-line`),
         *                   or 800 as a default if the width cannot be determined.
         */
    private getEditorMaxWidth(): number {

        // -------------------- OPTION 1. ------------------------- 
        // FULL WIDTH OF WHOLE EDITOR ARE
        // Get the width of the editor container (adjust the selector as needed)
        // const editorContainer = document.querySelector(
        //     ".cm-editor"
        // ) as HTMLElement;
        // if (!editorContainer) {
        //     console.warn("Editor container not found. Using default width.");
        //     return 800; // Default width
        // }

        // // Get computed styles
        // const computedStyles = window.getComputedStyle(editorContainer);

        // // Extract width, padding, and margin
        // const width = parseFloat(computedStyles.width);
        // const paddingLeft = parseFloat(computedStyles.paddingLeft);
        // const paddingRight = parseFloat(computedStyles.paddingRight);
        // const marginLeft = parseFloat(computedStyles.marginLeft);
        // const marginRight = parseFloat(computedStyles.marginRight);

        // // Calculate usable width
        // const usableWidth =
        //     width - paddingLeft - paddingRight - marginLeft - marginRight;


        // -------------------- OPTION 2. ------------------------- 
        //ONLY area where we can actually write - USE ONLY WIDTH
        const activeLeaf = this.app.workspace.getMostRecentLeaf();

        // If no active leaf or view is found, return the default width.
        if (!activeLeaf || !activeLeaf.view) {
            return 800;
        }

        // Ensure the active view is a MarkdownView and has an associated editor.
        if (
            !(activeLeaf.view instanceof MarkdownView) ||
            !activeLeaf.view.editor
        ) {
            return 800;
        }

        const { view } = activeLeaf;
        const { editor } = view;

        // Access the CodeMirror EditorView through the Obsidian Editor.
        // We temporarily use `as any` to bypass type checking for the undocumented `.cm` property,
        // and then immediately cast it to `EditorView` for type safety.
        const editorView = (editor as any).cm as EditorView;

        // If we cannot access the CodeMirror EditorView, return the default width.
        if (!editorView) {
            console.warn("Could not access CodeMirror EditorView");
            return 800;
        }

        // Get the width of a cm-line element (which represents a single line of text).
        // `contentDOM` is the element in CodeMirror 6 that directly contains the lines of code/text.
        // `clientWidth` provides the inner width of the element, including padding but excluding borders and margins.
        // The optional chaining operator (`?.`) ensures that if `querySelector` returns null (e.g., in an empty editor),
        // we don't throw an error.
        const contentWidth =
            editorView.contentDOM.querySelector(".cm-line")?.clientWidth;

        // If we cannot determine the content width (e.g., the editor is empty), return the default width.
        if (!contentWidth) {
            console.warn("Could not determine content width, using default 800");
            return 800;
        }

        return contentWidth;
    }

    // Helper function to get image dimensions (using async/await)
    private async getImageDimensions(
        file: TFile
    ): Promise<{ width: number; height: number } | null> {
        const img = new Image();
        try {
            await loadImage(img, this.app.vault.getResourcePath(file));
            return { width: img.width, height: img.height };
        } catch {
            new Notice(`Failed to load image dimensions for ${file.name}`);
            return null;
        }
    }
}
