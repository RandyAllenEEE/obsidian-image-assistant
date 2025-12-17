import { Editor, MarkdownView, EditorPosition, EditorChange, Debouncer, debounce, Component } from "obsidian";
import ImageConverterPlugin from "../main";
import { ImagePositionData } from './ImageAlignmentManager';
import { LinkFormatter } from '../utils/LinkFormatter';
import { pipeSyntaxParser } from '../utils/PipeSyntaxParser';

export interface ResizeState {
    isResizing: boolean;
    isDragging: boolean;
    isScrolling: boolean;
}


export class ImageResizer {

    editor: Editor | null = null;
    markdownView: MarkdownView | null = null;
    handles: HTMLElement[] = []; // Array to store resize handle elements
    activeImage: HTMLImageElement | null = null; // Currently selected image being resized
    handleSize = 8; // Size of resize handles in pixels

    startX = 0; // Mouse start X position for drag
    startY = 0; // Mouse start Y position for drag
    initialWidth = 0; // Initial image width before resize
    initialHeight = 0; // Initial image height before resize
    currentHandle: string | null = null; // Which handle is being dragged (nw, ne, sw, se)
    initialAspectRatio = 1; // Initialize initialAspectRatio
    rafId: number | null = null;

    // Scope component to manage DOM/event registrations per active view
    private eventScope: Component | null = null;

    // Resize state
    public resizeState: ResizeState = {
        isResizing: false, // Flag to indicate if resizing is in progress
        isDragging: false, // Flag to indicate if the user is currently dragging a resize handle or image border - and to differentiate from scrolling
        isScrolling: false,// Flag to indicate if resizing is in progress (needed for smoothing scroll-wheel, and prevent mousemove from interfering)
    };

    private resizeBuffer: {
        [imageHash: string]: {
            width: number;
            height: number;
        };
    } = {};

    // Debounce the cache update
    private debouncedSaveToCache: Debouncer<
        [image: HTMLImageElement, newWidth: number, newHeight: number],
        void
    >;

    private scrollTimeout: number | null = null;
    private readonly SCROLL_DEBOUNCE_MS = 300;


    resizeSensitivity: number;
    scrollwheelModifier: "None" | "Shift" | "Control" | "Alt" | "Meta";
    private lastMouseEvent: MouseEvent | null = null;

    EDGE_SIZE = 30; // Increased constant for edge detection threshold

    throttledUpdateImageLink: (image: HTMLImageElement, newWidth: number, newHeight: number, currentHandle: string | null) => void;     // Throttled version of updateImageLink

    // Editor width constraint caching
    private cachedEditorMaxWidth: number | null = null;
    private linkFormatter: LinkFormatter;


    constructor(private plugin: ImageConverterPlugin) {
        this.linkFormatter = new LinkFormatter(this.plugin.app);
        this.throttledUpdateImageLink = this.throttle(
            (
                image: HTMLImageElement,
                newWidth: number,
                newHeight: number,
                currentHandle: string | null
            ) => {
                this.updateMarkdownLink(image, newWidth, newHeight, currentHandle);
            },
            100

        );
        // Get settings from plugin
        this.resizeSensitivity = this.plugin.settings.resizeSensitivity;
        this.scrollwheelModifier = this.plugin.settings.scrollwheelModifier;

        // Initialize the debounced function
        this.debouncedSaveToCache = debounce(
            this.saveDimensionsToCache,
            this.SCROLL_DEBOUNCE_MS,
            true
        );

    }

    onload(markdownView: MarkdownView) { // Accept MarkdownView
        this.markdownView = markdownView;
        this.editor = markdownView.editor;

        // Reset old scope (if any) to avoid duplicate listeners across layout changes
        if (this.eventScope) {
            // Use onunload for compatibility with test mocks
            (this.eventScope as any).onunload?.();
            this.eventScope = null;
        }

        // Only register events if master switch is enabled
        if (this.plugin.settings.isImageResizeEnabled) {
            // Create a fresh scope for this view
            this.eventScope = new Component();
            this.registerEditorEvents();
        }
    }

    onunload() {
        // Clean up any active resize operation
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        // Unload and reset event scope (removes DOM listeners registered via scope)
        if (this.eventScope) {
            (this.eventScope as any).onunload?.();
            this.eventScope = null;
        }

        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = null;
        }

        // Cancel any pending debounced/throttled operations
        if (this.debouncedSaveToCache?.cancel) {
            this.debouncedSaveToCache.cancel();
        }

        // Clean up DOM elements
        this.cleanupHandles();

        // Reset state
        this.resizeState = {
            isResizing: false,
            isDragging: false,
            isScrolling: false
        };

        // Clear cached editor width
        this.cachedEditorMaxWidth = null;

        // Clear references
        this.activeImage = null;
        this.lastMouseEvent = null;
        this.currentHandle = null;
        this.handles = [];

        // this.removeEditorEvents();

        this.editor = null;
        this.markdownView = null;

    }

    onLayoutChange(markdownView: MarkdownView) {
        // Clear cached editor width when layout changes
        this.cachedEditorMaxWidth = null;

        // Handle layout changes (e.g., reposition handles)
        this.cleanupHandles();
        this.onload(markdownView);
        if (this.lastMouseEvent) {
            this.handleImageHover(this.lastMouseEvent);
        }
    }

    /**
     * Gets the cached editor maximum width, using LinkFormatter's getEditorMaxWidth method.
     * Caches the result for performance until layout changes.
     * @returns The editor max width in pixels.
     */
    private getCachedEditorMaxWidth(): number {
        if (this.cachedEditorMaxWidth === null) {
            // Use LinkFormatter's getEditorMaxWidth method
            this.cachedEditorMaxWidth = (this.linkFormatter as any).getEditorMaxWidth();
        }
        return this.cachedEditorMaxWidth!; // Non-null assertion since we just set it above
    }

    // onActiveLeafChange(markdownView: MarkdownView) {
    //     this.cleanupHandles();
    //     this.onload(markdownView);
    //     if (this.lastMouseEvent) {
    //         this.handleImageHover(this.lastMouseEvent);
    //     }
    // }

    // onEditorChange(editor: Editor, view: MarkdownView) {
    //     // Handle editor changes (e.g., clean up if an image is removed)
    //     if (this.activeImage && !view.containerEl.contains(this.activeImage)) {
    //         this.cleanupHandles();
    //     }
    // }

    private registerEditorEvents() {
        if (!this.editor || !this.markdownView || !this.eventScope) return; // Check MarkdownView too

        // WE register for DOCUMENT as it is broad and allows to work in READING and Live Preview mode
        // 1. Hover Detection
        this.eventScope.registerDomEvent(this.markdownView.containerEl, 'mouseover', this.handleImageHover);

        // 2. Drag Handling: Mouse down, move, up events for handles
        this.eventScope.registerDomEvent(document as any, 'mousedown', this.handleMouseDown);
        this.eventScope.registerDomEvent(document as any, 'mousemove', this.handleMouseMove);
        this.eventScope.registerDomEvent(document as any, 'mouseup', this.handleMouseUp);

        // 3. Register mousewheel event for resizing
        this.eventScope.registerDomEvent(this.markdownView.containerEl, 'wheel', this.handleMouseWheel as any, { passive: false });

    }

    // private removeEditorEvents() {
    //     if (!this.editor || !this.markdownView) return;
    //     // Auto unlaoded by obsidian
    // }



    private handleImageHover = (event: MouseEvent) => {
        // Skip hover logic if a scroll-wheel resize is in progress
        if (this.resizeState.isScrolling) return;

        // Check if drag resizing is permitted before showing handles/borders
        if (!this.isResizingPermitted('drag')) {
            this.cleanupHandles();
            return;
        }

        const target = event.target as HTMLElement;

        // Store the mouse event for scroll handling
        this.lastMouseEvent = event;

        // If we already have an active image and the hover is within its container, avoid cleanup/recreate thrash
        const activeContainer = this.activeImage?.matchParent(".image-resize-container") as HTMLElement | null;

        // Early exit: Not an image or a resize handle?
        if (!target.instanceOf(HTMLImageElement) && !target.hasClass('image-resize-handle')) {
            if (activeContainer && activeContainer.contains(target)) {
                // Still within the same container; keep handles
                return;
            }
            this.cleanupHandles();
            return;
        }

        // Skip Excalidraw images
        if (target.instanceOf(HTMLImageElement) && this.plugin.supportedImageFormats.isExcalidrawImage(target)) {
            this.cleanupHandles();
            return;
        }

        // **Check for active MarkdownView**
        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        // Early exit: No active MarkdownView or target is not within the active view
        if (!activeView || !activeView.containerEl.contains(target)) {
            this.cleanupHandles();
            return;
        }

        // Bypass for elements within a specific selector (e.g., MAP-VIEW plugin)
        if (target.matchParent(".map-view-main")) {
            this.cleanupHandles();
            return;
        }

        // Exit if resizing is already in progress
        if (this.resizeState.isResizing) return;

        // Handle external images: add a border and perform edge detection for cursor change
        if (target.instanceOf(HTMLImageElement) && this.isExternalLink(target.src)) {
            if (this.activeImage === target && target.hasClass("image-resize-border")) {
                // Already active; just update edge detection
                this.handleEdgeDetection(event, target);
                return;
            }
            this.activeImage = target;
            target.addClass("image-resize-border");
            this.handleEdgeDetection(event, target);
            return;
        }

        // Handle internal images: create resize handles
        if (target.instanceOf(HTMLImageElement) && !this.isExternalLink(target.src)) {
            // If this image already has a container/handles, do nothing
            const container = target.matchParent(".image-resize-container");
            if (this.activeImage === target && this.handles.length > 0 && container) {
                return;
            }
            this.activeImage = target;
            this.createHandles(target);
            return;
        }
    };

    /**
     * Performs edge detection on external images to dynamically change the cursor style
     * based on the mouse position, indicating possible resize directions.
     *
     * @param event - The mouse event.
     * @param imageTarget - The target HTMLImageElement.
     */
    private handleEdgeDetection(event: MouseEvent, imageTarget: HTMLImageElement) {
        // Skip edge detection during active scrolling
        if (this.resizeState.isScrolling) {
            return;
        }

        if (event.target && (event.target as HTMLElement).hasClass('image-resize-handle')) {
            return;
        }

        const imageRect = imageTarget.getBoundingClientRect();
        const x = event.clientX - imageRect.left;
        const y = event.clientY - imageRect.top;

        const isNearTopEdge = y <= this.EDGE_SIZE;
        const isNearBottomEdge = y >= imageRect.height - this.EDGE_SIZE;
        const isNearLeftEdge = x <= this.EDGE_SIZE;
        const isNearRightEdge = x >= imageRect.width - this.EDGE_SIZE;

        // Update cursor style based on proximity to edges
        if (isNearTopEdge || isNearBottomEdge || isNearLeftEdge || isNearRightEdge) {
            if ((isNearTopEdge && isNearLeftEdge) || (isNearBottomEdge && isNearRightEdge)) {
                imageTarget.style.cursor = 'nwse-resize'; // Diagonal resize (top-left or bottom-right)
            } else if ((isNearTopEdge && isNearRightEdge) || (isNearBottomEdge && isNearLeftEdge)) {
                imageTarget.style.cursor = 'nesw-resize'; // Diagonal resize (top-right or bottom-left)
            } else if (isNearTopEdge || isNearBottomEdge) {
                imageTarget.style.cursor = 'ns-resize'; // Vertical resize
            } else if (isNearLeftEdge || isNearRightEdge) {
                imageTarget.style.cursor = 'ew-resize'; // Horizontal resize
            } else {
                imageTarget.style.cursor = 'se-resize'; // Default (bottom-right corner)
            }
        } else {
            imageTarget.style.cursor = 'default'; // Cursor outside the edge
        }
    }

    /**
     * Cleans up any existing resize handles or borders applied to the active image.
     * Resets the cursor and clears the active image and last mouse event references.
     */
    private cleanupHandles() {
        if (this.resizeState.isResizing || !this.activeImage) return;

        const handleContainer = this.activeImage.matchParent(
            ".image-resize-container"
        );
        if (handleContainer) {
            // **OPTIONAL:** Re-apply alignment classes to the image
            const alignmentClasses = [
                "image-position-left",
                "image-position-center",
                "image-position-right",
                "image-wrap",
                "image-no-wrap",
                "image-converter-aligned"
            ];
            for (const className of alignmentClasses) {
                if (handleContainer.hasClass(className)) {
                    this.activeImage.addClass(className);
                    // Remove the class from the container
                    handleContainer.removeClass(className);
                }
            }


            handleContainer.parentNode?.insertBefore(this.activeImage, handleContainer);
            if ((handleContainer as any).detach) {
                (handleContainer as any).detach();
            } else {
                handleContainer.remove();
            }
            this.handles = [];
        }

        if (this.activeImage.hasClass("image-resize-border")) {
            this.activeImage.removeClass("image-resize-border");
            this.activeImage.style.cursor = 'default';
        }

        this.activeImage = null;
        this.lastMouseEvent = null;
    }

    /**
     * Creates resize handles for internal images and attaches them to the image.
     *
     * @param image - The HTMLImageElement for which to create handles.
     */
    private createHandles(image: HTMLImageElement) {
        this.cleanupHandles();
        this.activeImage = image;

        const parent = image.parentElement;
        if (!parent) return;
        const container = parent.createEl("div", { cls: "image-resize-container" });

        // Check for and apply existing alignment classes
        const alignmentClasses = [
            "image-position-left",
            "image-position-center",
            "image-position-right",
            "image-wrap",
            "image-no-wrap",
            "image-converter-aligned"
        ];
        for (const className of alignmentClasses) {
            if (image.hasClass(className)) {
                container.addClass(className);
            }
        }

        parent.insertBefore(container, image);
        container.appendChild(image);

        const handleTypes = ["nw", "ne", "sw", "se", "n", "s", "e", "w"];
        this.handles = handleTypes.map((type) => {
            const el = container.createEl("div", {
                cls: `image-resize-handle image-resize-handle-${type}`,
            });
            el.setAttr("data-handle-type", type);
            return el;
        });
    }

    /**
    * Handles the 'mousedown' event. Initiates resizing based on whether the event
    * occurred on a resize handle (for internal images) or near the edge of an image
    * marked with a resize border (for external images).
    *
    * @param event - The MouseEvent object.
    */
    private handleMouseDown = (event: MouseEvent) => {
        // Check if drag resizing is permitted
        if (!this.isResizingPermitted('drag')) return;

        const target = event.target as HTMLElement;

        // Handle resize handle click (internal images)
        if (target.hasClass("image-resize-handle")) {
            event.preventDefault();
            event.stopPropagation();
            this.startResize(event, target);
            this.resizeState.isDragging = true; // Set isDragging to true
            return;
        }

        // Handle near-edge click for resize initiation (external images)
        if (
            target.instanceOf(HTMLImageElement) &&
            target.hasClass("image-resize-border")
        ) {
            event.preventDefault();
            event.stopPropagation();
            this.startResize(event, target); // Treat image as resize target
            this.resizeState.isDragging = true; // Set isDragging to true
            return;
        }
    };

    /**
     * Starts the resizing process. Sets the `isResizing` flag, identifies the active image,
     * adds visual feedback, determines the handle type (border or specific handle),
     * gets initial dimensions, calculates the aspect ratio, and updates plugin settings.
     *
     * @param event - The MouseEvent object.
     * @param resizeTarget - The target element for resizing (either a handle or an image with a border).
     */
    private startResize(event: MouseEvent, resizeTarget: HTMLElement | HTMLImageElement) {
        this.resizeState.isResizing = true;
        this.activeImage =
            this.activeImage || (resizeTarget.matchParent("img") as HTMLImageElement);

        // Add 'resizing' class for visual feedback during resize
        if (this.activeImage) {
            if (this.activeImage.hasClass("image-resize-border")) {
                // External image: add 'resizing' to the image itself
                this.activeImage.addClass("resizing");
            } else {
                // Internal image: add 'resizing' to the handle container
                const container = this.activeImage.matchParent(".image-resize-container");
                if (container) {
                    container.addClass("resizing");
                }
            }
        } else {
            // If no active image after attempted set, cancel resize and exit early
            this.resizeState.isResizing = false;
            return;
        }

        // Determine handle type (border or specific handle)
        this.currentHandle = resizeTarget.hasClass("image-resize-border")
            ? "border"
            : (resizeTarget as HTMLElement).getAttr("data-handle-type") || null;

        // Get initial dimensions and calculate aspect ratio
        const rect = this.activeImage.getBoundingClientRect();
        if (rect) {
            this.startX = event.clientX;
            this.startY = event.clientY;
            this.initialWidth = rect.width;
            this.initialHeight = rect.height;
            this.initialAspectRatio = this.initialWidth / this.initialHeight;

            // Ensure inline styles are initialized to pixel values so subsequent updates are visible
            if (this.activeImage) {
                this.activeImage.style.width = `${Math.round(this.initialWidth)}px`;
                this.activeImage.style.height = `${Math.round(this.initialHeight)}px`;
            }

            // Update plugin settings
            // this.plugin.settings.resizeState.isResizing = true;
            // this.plugin.saveSettings();
        } else {
            // If no rect found, cancel resize
            this.resizeState.isResizing = false;
        }
    }
    /**
     * Handles the 'mousemove' event. Updates the cursor style for external images during
     * hover and performs resizing calculations when `isResizing` is true.
     *
     * @param event - The MouseEvent object.
     */
    private handleMouseMove = (event: MouseEvent) => {
        // Only run if drag resizing is active
        if (!this.resizeState.isDragging) return;

        const runResizeCalc = () => {
            // Edge detection when hovering over external images
            if (this.activeImage && this.activeImage.hasClass('image-resize-border')) {
                this.handleEdgeDetection(event, this.activeImage);
            }

            if (!this.resizeState.isResizing || !this.activeImage || !this.editor) {
                return;
            }

            // Calculate the change in mouse position since the start of the resize
            const deltaX = event.clientX - this.startX;
            const deltaY = event.clientY - this.startY;

            // Initialize new dimensions with the initial dimensions
            let newWidth = this.initialWidth;
            let newHeight = this.initialHeight;
            const minSize = 10; //minimum size for resizing

            // Resizing logic based on handle type
            if (this.currentHandle === "border") {
                // Uniform scaling for border resize (external images)
                const scaleFactor = Math.max(
                    (this.initialWidth + deltaX) / this.initialWidth,
                    (this.initialHeight + deltaY) / this.initialHeight
                );
                newWidth = Math.max(minSize, this.initialWidth * scaleFactor);
                newHeight = Math.max(minSize, this.initialHeight * scaleFactor);
            } else {
                // Handle-based resizing (internal images)
                const isAspectFixed = this.plugin.settings.isDragAspectRatioLocked;

                switch (this.currentHandle) {
                    case 'n': // Top handle: adjust height from the top
                        if (isAspectFixed) {
                            newHeight = Math.max(minSize, this.initialHeight - deltaY);
                            newWidth = newHeight * this.initialAspectRatio;
                        } else {
                            newHeight = Math.max(minSize, this.initialHeight - deltaY);
                        }
                        break;
                    case 's': // Bottom handle: adjust height from the bottom
                        if (isAspectFixed) {
                            newHeight = Math.max(minSize, this.initialHeight + deltaY);
                            newWidth = newHeight * this.initialAspectRatio;
                        } else {
                            newHeight = Math.max(minSize, this.initialHeight + deltaY);
                        }
                        break;
                    case 'e': // Right handle: adjust width from the right
                        if (isAspectFixed) {
                            newWidth = Math.max(minSize, this.initialWidth + deltaX);
                            newHeight = newWidth / this.initialAspectRatio;
                        } else {
                            newWidth = Math.max(minSize, this.initialWidth + deltaX);
                        }
                        break;
                    case 'w': // Left handle: adjust width from the left
                        if (isAspectFixed) {
                            newWidth = Math.max(minSize, this.initialWidth - deltaX);
                            newHeight = newWidth / this.initialAspectRatio;
                        } else {
                            newWidth = Math.max(minSize, this.initialWidth - deltaX);
                        }
                        break;
                    case 'nw': // Top-left handle: adjust width and maintain aspect ratio
                    case 'sw': // Bottom-left handle: adjust width and maintain aspect ratio
                        newWidth = Math.max(minSize, this.initialWidth - deltaX);
                        newHeight = newWidth / this.initialAspectRatio;
                        break;
                    case 'ne': // Top-right handle: adjust width and maintain aspect ratio
                    case 'se': // Bottom-right handle: adjust width and maintain aspect ratio
                        newWidth = Math.max(minSize, this.initialWidth + deltaX);
                        newHeight = newWidth / this.initialAspectRatio;
                        break;
                }
            }

            // Apply editor width constraint
            const maxEditorWidth = this.getCachedEditorMaxWidth();

            if (newWidth > maxEditorWidth) {
                const aspectRatio = this.initialAspectRatio;
                newWidth = maxEditorWidth;

                // Recalculate height to maintain aspect ratio
                if (this.currentHandle === "border" ||
                    ["nw", "ne", "sw", "se"].includes(this.currentHandle || "")) {
                    // For proportional handles, always maintain aspect ratio
                    newHeight = newWidth / aspectRatio;
                } else if (this.plugin.settings.isDragAspectRatioLocked) {
                    // For edge handles, only maintain ratio if aspect ratio lock is enabled
                    newHeight = newWidth / aspectRatio;
                }
                // For non-locked edge handles, don't adjust height automatically
            }

            // Set the new width and height of the image, rounded to the nearest pixel
            const roundedWidth = Math.round(newWidth);
            const roundedHeight = Math.round(newHeight);
            this.activeImage.style.width = `${roundedWidth}px`;
            this.activeImage.style.height = `${roundedHeight}px`;

            // Live-update the markdown link during drag (throttled) so users can see size numbers change
            this.throttledUpdateImageLink(this.activeImage, roundedWidth, roundedHeight, this.currentHandle);

            // Update the cursor position during resize (visual feedback only during drag)
            this.updateCursorPositionDuringResize();
        };


        // Cancel any existing animation frame request to prevent conflicts
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        // Request a new animation frame to handle the resize calculations and updates
        this.rafId = requestAnimationFrame(runResizeCalc);
    };

    /**
     * Handles the 'mouseup' event. Cleans up the resizing state, removes visual feedback,
     * updates the Markdown link with the final dimensions, and performs cleanup.
     *
     * @param event - The MouseEvent object.
     */
    private handleMouseUp = () => {
        // Exit if not resizing or if scroll resizing is in progress
        if (!this.resizeState.isResizing || this.resizeState.isScrolling) {
            return;
        }

        // If no image is set, also exit early
        if (!this.activeImage) {
            return;
        }

        // Remove 'resizing' class
        if (this.activeImage.hasClass("image-resize-border")) {
            // External image
            this.activeImage.removeClass("resizing");
        } else {
            // Internal image
            const container = this.activeImage.matchParent(".image-resize-container");
            if (container) {
                container.removeClass("resizing");
            }
        }

        // Reset the current handle
        this.currentHandle = null;

        // Determine final dimensions in a DOM-agnostic way (happy-dom often returns 0 for offset* values)
        const widthStyle = parseInt(this.activeImage.style.width || '0', 10);
        const heightStyle = parseInt(this.activeImage.style.height || '0', 10);
        const finalWidth = Number.isFinite(widthStyle) && widthStyle > 0 ? widthStyle : Math.round(this.initialWidth);
        const finalHeight = Number.isFinite(heightStyle) && heightStyle > 0 ? heightStyle : Math.round(this.initialHeight);

        // Update the markdown link with the final dimensions
        this.updateMarkdownLink(this.activeImage, finalWidth, finalHeight, this.currentHandle);

        // Mark flags
        this.resizeState.isDragging = false;
        this.resizeState.isResizing = false;

        // In reading mode, remove handles; in edit mode, keep handles for subsequent drags
        const state = this.markdownView?.getState?.();
        const isReadingMode = state && state.mode === "preview";
        if (isReadingMode) {
            this.cleanupHandles();
        }
    };

    /**
     * Handles the 'wheel' event for resizing images using the scroll wheel.
     *
     * @param event - The WheelEvent object.
     */
    private handleMouseWheel = (event: WheelEvent) => {
        // Early permission check
        if (!this.plugin.settings.isScrollResizeEnabled) return;
        if (!this.checkModifierKey(event)) return;

        // Get the target element
        const target = event.target as HTMLElement;

        // Check if the target is an image or part of an image (e.g., a resize handle)
        let image: HTMLImageElement | null = null;
        if (target.tagName === "IMG") {
            image = target as HTMLImageElement;
        } else if (target.hasClass("image-resize-handle")) {
            // If it's a resize handle, find the parent image
            const imageContainer = target.closest(".image-resize-container");
            if (imageContainer) {
                image = imageContainer.querySelector("img") as HTMLImageElement;
            }
        }

        // If no image found, or it's not in the active MarkdownView, return
        if (!image || !this.markdownView?.containerEl.contains(image)) return;

        // Skip Excalidraw images
        if (this.plugin.supportedImageFormats.isExcalidrawImage(image)) return;

        // Prevent default scroll behavior
        event.preventDefault();
        event.stopPropagation();

        // Set up scrolling state
        this.resizeState.isScrolling = true;
        this.activeImage = image;

        // Get initial dimensions
        const rect = image.getBoundingClientRect();
        if (!rect) return;

        this.initialWidth = rect.width;
        this.initialHeight = rect.height;
        this.initialAspectRatio = this.initialWidth / this.initialHeight;

        // Calculate new dimensions
        let { newWidth, newHeight } = this.resizeImageScrollWheel(event, image);

        // Apply editor width constraint
        const maxEditorWidth = this.getCachedEditorMaxWidth();

        if (newWidth > maxEditorWidth) {
            const aspectRatio = this.initialAspectRatio;
            newWidth = maxEditorWidth;
            newHeight = newWidth / aspectRatio; // Always maintain aspect ratio for scroll resize
        }

        // Update visual dimensions immediately
        // Prefer the declared style width units to decide whether to keep % or use px
        const declaredWidth = image.style.width || "";
        if (declaredWidth.endsWith("%")) {
            image.style.width = `${newWidth}%`;
        } else {
            image.style.width = `${newWidth}px`;
        }
        image.style.height = `${newHeight}px`;

        // Get active file and image name
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            console.warn("Could not get active file for image:", image);
            return;
        }
        const notePath = activeFile.path;
        const imageName = this.getImageName(image);
        if (!imageName) return;

        // Check if alignment is enabled
        const isAlignmentEnabled = this.plugin.settings.isImageAlignmentEnabled;

        // 注：我们不再使用缓存和 hash，改为基于 Pipe Syntax
        /*
        // Only get the image hash if alignment is enabled
        let imageHash = null;
        if (isAlignmentEnabled && this.plugin.ImageAlignmentManager) {
            imageHash = this.plugin.ImageAlignmentManager.getImageHash(notePath, imageName);
        }
        */
        const imageHash = imageName; // 临时使用 imageName 作为 key

        // Check if the image has a positional class
        const hasPositionalClass = isAlignmentEnabled && Array.from(image.classList).some(className =>
            className.startsWith("image-position-")
        );

        // Buffer the dimensions (only if needed for later use, e.g., debouncing and alignment is enabled)
        if (isAlignmentEnabled) {
            this.resizeBuffer[imageHash!] = { // Use imageHash! only if isAlignmentEnabled is true
                width: newWidth,
                height: newHeight,
            };
        }

        // Use throttled version if alignment is disabled OR if the image doesn't have a positional class
        if (!isAlignmentEnabled || !hasPositionalClass) {
            // Update markdown link immediately (but still throttled)
            this.throttledUpdateImageLink(image, newWidth, newHeight, null);
        }

        // Debounced update to the markdown link and cache (only if alignment is enabled)
        if (isAlignmentEnabled) {
            this.debouncedSaveToCache(image, newWidth, newHeight);
        }

        // Reset scroll state after delay
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
        }

        this.scrollTimeout = window.setTimeout(() => {
            this.resizeState.isScrolling = false;
            this.activeImage = null;
        }, this.SCROLL_DEBOUNCE_MS);
    };


    /**
     * Checks if the correct modifier key is pressed during a wheel event.
     *
     * @param event - The WheelEvent object.
     * @returns True if the correct modifier key is pressed, false otherwise.
     */
    private checkModifierKey(event: WheelEvent): boolean {
        // Early return if scroll resize is not permitted
        if (!this.isResizingPermitted('scroll')) return false;

        // Read the current setting to honor runtime changes
        const currentModifier = this.plugin?.settings?.scrollwheelModifier ?? this.scrollwheelModifier;
        switch (currentModifier) {
            case "Shift":
                return event.shiftKey;
            case "Control":
                return event.ctrlKey;
            case "Alt":
                return event.altKey;
            case "Meta":
                return event.metaKey;
            case "None":
                return true; // Always enabled if "None"
            default:
                return false;
        }
    }

    /**
     * Calculates new dimensions for an image or video element based on scroll wheel input.
     *
     * @param event - The WheelEvent object.
     * @param img - The HTMLImageElement or HTMLVideoElement being resized.
     * @returns An object containing the new width and height.
     */
    resizeImageScrollWheel(event: WheelEvent, img: HTMLImageElement | HTMLVideoElement) {
        // Prevent default scroll behavior
        // event.preventDefault();

        const delta = Math.sign(event.deltaY);

        // Use resizeSensitivity from plugin settings
        const sensitivity = this.plugin.settings.resizeSensitivity;
        const scaleFactor = delta < 0 ? (1 + sensitivity) : (1 / (1 + sensitivity));

        let newWidth;
        const computedWidth = getComputedStyle(img).width;
        const declaredWidth = (img as HTMLElement).style?.width || "";
        if (declaredWidth.endsWith('%')) {
            // Handle elements with percentage widths declared in style
            newWidth = parseFloat(declaredWidth) * scaleFactor;
            newWidth = Math.max(1, Math.min(newWidth, 100)); // Keep within 1-100%
        } else if (img instanceof HTMLVideoElement && computedWidth.endsWith('%')) {
            // Fallback: some environments may express video width in % via computed style
            newWidth = parseFloat(computedWidth) * scaleFactor;
            newWidth = Math.max(1, Math.min(newWidth, 100));
        } else {
            // Handle images and videos with pixel widths
            newWidth = img.clientWidth * scaleFactor;
            newWidth = Math.max(22, newWidth); // Minimum width
        }

        // Calculate height maintaining aspect ratio
        const aspectRatio = img.clientWidth / img.clientHeight;
        let newHeight = Math.max(22, newWidth / aspectRatio);

        // Round values
        newWidth = Math.round(newWidth);
        newHeight = Math.round(newHeight);

        // Return new dimensions without position calculations
        return {
            newWidth,
            newHeight,
            newLeft: 0,
            newTop: 0
        };
    }

    /**
     * Calculates the ending line number of a potentially multiline link.
     *
     * @param editor The editor instance.
     * @param startLine The starting line number of the link.
     * @param startCh The starting character position of the link.
     * @param endCh The ending character position of the link on the starting line.
     * @returns The line number where the link actually ends.
     */
    private getEndLineOfLink(editor: Editor, startLine: number, startCh: number, endCh: number): number {
        let lineContent = editor.getLine(startLine).substring(startCh, endCh);
        let currentLine = startLine;

        // Check if the link is multiline by searching for closing brackets.
        while (!lineContent.match(/\]\]|\)/) && currentLine < editor.lastLine()) {  //Added editor.lastLine() to avoid infinite loops
            currentLine++;
            lineContent = editor.getLine(currentLine); //no substring needed, as it always starts from 0
        }
        return currentLine;
    }

    /**
 * Finds the end line of a callout block, starting from a given line.
 *
 * @param editor The editor instance.
 * @param startLine The line number to start searching from.
 * @returns The line number of the end of the callout, or the startLine if not in a callout.
 */
    private getEndOfCallout(editor: Editor, startLine: number): number {
        let currentLine = startLine;
        let lineContent = editor.getLine(currentLine);

        // Check if we're *actually* in a callout
        if (!lineContent.trimStart().startsWith(">")) {
            return startLine; // Not in a callout, return the starting line
        }
        //If not trimmed there will be added extra line
        const [firstNonWhitespaceChar] = lineContent.trimStart();
        // Iterate downwards, checking for the end of the callout
        while (currentLine < editor.lastLine()) {
            currentLine++;
            lineContent = editor.getLine(currentLine);
            //If not trimmed there will be added extra line
            const [currentLineNonWhitespaceChar] = lineContent.trimStart();
            // A callout ends when a line doesn't start with ">"
            if (currentLineNonWhitespaceChar != firstNonWhitespaceChar) {
                return currentLine - 1; // Return the *previous* line (end of callout)
            }
        }

        // If we reach the end of the file and it's all callout, return the last line
        return editor.lastLine();
    }

    /**
     * Updates Markdown links within the current editor that match the resized image.
     *
     * This function identifies lines containing Markdown or Wikilinks that point to the
     * provided image, and updates their size parameters based on the new width, height,
     * and the handle used for resizing. 
     * 
     * It leverages Obsidian's API for efficient line processing. Specifically it utilizes
     * `editor.transaction()` to ensure that all link updates are performed **atomically**.
     * This means that either all changes are successfully applied, or none are, preventing
     * the document from being left in a partially updated state if an error occurs.
     * Transactions also improve performance by allowing the editor to optimize the
     * application of multiple changes and are better integrated with Obsidian's undo/redo system.
     *
     * @param image - The HTMLImageElement that was resized.
     * @param newWidth - The new width of the image in pixels.
     * @param newHeight - The new height of the image in pixels.
     * @param currentHandle - A string indicating which handle was used for resizing
     *                        (e.g., 'n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'),
     *                        or null if the resize was not initiated from a handle.
     */
    private async updateMarkdownLink(image: HTMLImageElement, newWidth: number, newHeight: number, currentHandle: string | null) {
        if (!this.editor || !this.markdownView) return;

        // Check if we're in reading mode
        const state = this.markdownView.getState();
        const isReadingMode = state.mode === "preview";

        if (isReadingMode) {
            // In reading mode, only update the visual size without modifying the markdown
            image.style.width = `${Math.round(newWidth)}px`;
            image.style.height = `${Math.round(newHeight)}px`;
            return;
        }

        const imageName = this.getImageName(image);
        if (!imageName) {
            console.warn("Could not get imageName for image:", image);
            return;
        }

        // Handle external/cloud images based on settings
        if (this.isExternalLink(imageName)) {
            // Check cloud upload settings
            const cloudSettings = this.plugin.settings.cloudUploadSettings;

            // Only update markdown if user chose 'actual' size source
            if (cloudSettings.imageSizeSource !== 'actual') {
                console.log('[ImageResizer] Skipping markdown update for external image (imageSizeSource is not "actual"):', imageName);
                // Only update visual size
                image.style.width = `${Math.round(newWidth)}px`;
                image.style.height = `${Math.round(newHeight)}px`;
                return;
            }
            // If imageSizeSource is 'actual', continue to update markdown with actual dimensions
            console.log('[ImageResizer] Updating markdown with actual dimensions for external image:', imageName);
        }

        const { editor } = this;
        const normalizedTargetName = this.isBase64Image(imageName) ? imageName : this.getFilenameFromPath(imageName);

        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            console.warn("Could not get active file for image:", image);
            return;
        }

        // Prepare changes before applying them
        const changes: EditorChange[] = [];
        let cursorPosition: EditorPosition | null = null; // Initialize cursor position
        const cursorLocation = this.plugin.settings.resizeCursorLocation;

        editor.getValue()
            .split('\n')
            .forEach((lineContent, line) => {
                if (this.isFrontmatter(line, editor)) return;

                // Use pipeSyntaxParser to find all links
                const matches = pipeSyntaxParser.extractAllLinks(lineContent).filter(match => {
                    const matchFilename = this.isBase64Image(match.data.path) ? match.data.path : this.getFilenameFromPath(match.data.path);
                    return matchFilename === normalizedTargetName;
                });

                matches.forEach(match => {
                    let updatedContent = "";

                    // Calculate new size string based on handler
                    let newSizeString = `${Math.round(newWidth)}`; // default

                    const isAspectLocked = this.plugin.settings.isDragAspectRatioLocked;

                    // Logic to determine format based on handle and locking
                    if (this.isExternalLink(imageName)) {
                        // External images (border resize) usually just Width
                        newSizeString = `${Math.round(newWidth)}`;
                    } else if (currentHandle) {
                        if (["nw", "ne", "sw", "se"].includes(currentHandle)) {
                            // Proportional resize
                            newSizeString = `${Math.round(newWidth)}`; // Standard Obsidian format is just Width
                        } else if (["n", "s"].includes(currentHandle)) {
                            // Vertical resize
                            if (isAspectLocked) {
                                newSizeString = `${Math.round(newWidth)}`; // If locked, width drives it
                            } else {
                                newSizeString = `x${Math.round(newHeight)}`; // Height only
                            }
                        } else if (["e", "w"].includes(currentHandle)) {
                            // Horizontal resize
                            newSizeString = `${Math.round(newWidth)}`;
                        }
                    } else {
                        // Scroll wheel or other -> Width
                        newSizeString = `${Math.round(newWidth)}`;
                    }

                    // Update the parsed data object
                    const updatedData = { ...match.data };

                    if (newSizeString.startsWith('x')) {
                        const h = parseInt(newSizeString.substring(1));
                        updatedData.size = { height: h, format: 'xH' };
                    } else {
                        const w = parseInt(newSizeString);
                        updatedData.size = { width: w, format: 'W' };
                    }

                    // Build new link text using the Builder
                    updatedContent = pipeSyntaxParser.buildPipeSyntax(updatedData);

                    // Calculate replacement range
                    const startCh = match.index;
                    const endCh = match.index + match.fullMatch.length;

                    changes.push({
                        from: { line, ch: startCh },
                        to: { line, ch: endCh },
                        text: updatedContent,
                    });
                });
            });

        if (changes.length > 0) {
            // Apply changes as a single transaction
            editor.transaction({
                changes: changes,
            });
        }
    }

    /**
     * Updates the cursor position during resizing based on plugin settings.
     */
    private updateCursorPositionDuringResize() {
        // Early return if cursor updates are disabled
        if (this.plugin.settings.resizeCursorLocation === "none") return;

        if (!this.markdownView || !this.activeImage || !this.editor) return;

        const { editor } = this;
        const cursorPos = editor.getCursor();
        const lineContent = editor.getLine(cursorPos.line);

        const imageName = this.getImageName(this.activeImage);
        if (!imageName) return;

        if (!lineContent.includes(imageName)) return;

        // Find link start and end positions
        const internalLinkStart = lineContent.indexOf("![[");
        const externalLinkStart = lineContent.indexOf("![");
        const linkEnd = lineContent.search(/\]\]|\)/); // Find closing ]] or )

        let newCursorPos: EditorPosition | undefined;

        if (this.plugin.settings.resizeCursorLocation === "front") {
            // Set cursor to the front of the link, but not before position 0
            if (internalLinkStart !== -1 || externalLinkStart !== -1) {
                newCursorPos = {
                    line: cursorPos.line,
                    ch: Math.max(0, Math.max(internalLinkStart, externalLinkStart)), // Ensure ch is not negative
                };
            } else {
                return;
            }
        } else if (this.plugin.settings.resizeCursorLocation === "back") {
            // Set cursor to the end of the link
            if (linkEnd !== -1) {
                newCursorPos = {
                    line: cursorPos.line,
                    ch: linkEnd + (lineContent[linkEnd] === "]" ? 2 : 1),
                };
            } else {
                return;
            }
        } else if (this.plugin.settings.resizeCursorLocation === "below") {
            // Calculate the end line of the image link
            if (linkEnd !== -1) {
                const endLine = this.getEndLineOfLink(editor, cursorPos.line, internalLinkStart !== -1 ? internalLinkStart : externalLinkStart, linkEnd);
                newCursorPos = { line: endLine + 1, ch: 0 };
            }
        }

        // Only update cursor if we have a new position and it's different from current
        if (newCursorPos && !this.areEditorPositionsEqual(cursorPos, newCursorPos)) {
            editor.setCursor(newCursorPos);
        }
    }

    // Helper function to compare EditorPositions
    private areEditorPositionsEqual(pos1: EditorPosition, pos2: EditorPosition): boolean {
        return pos1.line === pos2.line && pos1.ch === pos2.ch;
    }

    /**
     * Normalizes a file path by decoding URI components and replacing backslashes with forward slashes.
     *
     * @param path - The path to normalize.
     * @returns The normalized path.
     */
    private normalizePath(path: string): string {
        try {
            return decodeURIComponent(path).replace(/\\/g, "/");
        } catch {
            return path.replace(/\\/g, "/");
        }
    }

    /**
     * Extracts the filename from a given path.
     *
     * @param path - The path to extract the filename from.
     * @returns The extracted filename.
     */
    private getFilenameFromPath(path: string): string {
        const normalized = this.normalizePath(path);
        return normalized.split("/").pop() || normalized;
    }

    /**
     * Checks if a given line number in the editor is within the frontmatter.
     *
     * @param lineNumber - The line number to check.
     * @param editor - The editor instance.
     * @returns True if the line is within the frontmatter, false otherwise.
     */
    private isFrontmatter(lineNumber: number, editor: Editor): boolean {
        let inFrontmatter = false;
        let frontmatterStart = false;

        for (let i = 0; i <= lineNumber; i++) {
            const line = editor.getLine(i);

            if (i === 0 && line === "---") {
                inFrontmatter = true;
                frontmatterStart = true;
                continue;
            }

            if (inFrontmatter && line === "---") {
                inFrontmatter = false;
                continue;
            }

            if (i === lineNumber && inFrontmatter && frontmatterStart) {
                return true;
            }
        }
        return false;
    }

    /**
     * Finds all Markdown and Wikilink image matches in a given content string.
     *
     * @param content - The content string to search.
     * @returns An array of match objects with details about each image link.
     */
    // findAllMatches removed - replaced by pipeSyntaxParser.extractAllLinks

    /**
     * Gets the image name from an HTMLImageElement.
     *
     * @param img - The HTMLImageElement to extract the name from.
     * @returns The image name, or null if not found or if there's an error.
     */
    private getImageName(img: HTMLImageElement | null): string | null {
        if (!img) return null;
        let imageName = img.getAttribute("src");

        if (!imageName) return null;

        if (this.isBase64Image(imageName)) {
            return imageName;
        }

        if (this.isExternalLink(imageName)) {
            return imageName;
        }

        try {
            imageName = decodeURIComponent(imageName);
            const parts = imageName.split(/[/\\]/);
            const [lastPart] = parts.slice(-1);
            const [fileName] = (lastPart ?? "").split("?");
            return fileName;
        } catch (error) {
            console.error("Error processing image path:", error);
            return null;
        }
    }

    /**
     * Checks if an image name represents an external link.
     *
     * @param imageName - The image name to check.
     * @returns True if it's an external link, false otherwise.
     */
    private isExternalLink(imageName: string): boolean {
        return imageName.startsWith("http://") || imageName.startsWith("https://");
    }

    /**
     * Checks if a source string is a Base64 image.
     *
     * @param src - The source string to check.
     * @returns True if it's a Base64 image, false otherwise.
     */
    private isBase64Image(src: string): boolean {
        return src.startsWith("data:image");
    }


    private isResizingPermitted(resizeType: 'drag' | 'scroll'): boolean {
        if (!this.markdownView) return false;

        // Check master switch first
        if (!this.plugin.settings.isImageResizeEnabled) {
            return false;
        }

        // Check reading mode permissions
        const state = this.markdownView.getState();
        const isReadingMode = state.mode === "preview";
        if (isReadingMode && !this.plugin.settings.isResizeInReadingModeEnabled) {
            return false;
        }

        // Check specific resize type permissions
        if (resizeType === 'drag') {
            return this.plugin.settings.isDragResizeEnabled;
        }
        if (resizeType === 'scroll') {
            return this.plugin.settings.isScrollResizeEnabled;
        }

        return false;
    }

    /**
 * Saves the buffered dimensions to the cache and updates the markdown link.
 * This method is called by the debounced function.
 * 
 * @param image The image element being resized.
 * @param newWidth The new width of the image.
 * @param newHeight The new height of the image.
 */
    private saveDimensionsToCache = async (image: HTMLImageElement, newWidth: number, newHeight: number) => {
        // Update markdown link
        this.updateMarkdownLink(image, newWidth, newHeight, null);

        // Save to cache using the buffered dimensions
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) return;

        const notePath = activeFile.path;
        const imageName = this.getImageName(image);
        if (!imageName) return;

        // 注：我们不再使用缓存和 hash，改为基于 Pipe Syntax
        // 尺寸更新已经在 throttledUpdateImageLink 中处理，这里不需要再保存到缓存
        /*
        const imageHash = this.plugin.ImageAlignmentManager!.getImageHash(
            notePath,
            imageName
        );
        const bufferedDimensions = this.resizeBuffer[imageHash];

        if (bufferedDimensions && this.plugin.settings.isImageAlignmentEnabled && this.plugin.ImageAlignmentManager) {
            const cachedAlignment = this.plugin.ImageAlignmentManager.getImageAlignment(notePath, imageName);
            if (cachedAlignment) {
                await this.plugin.ImageAlignmentManager.saveImageAlignmentToCache(
                    notePath,
                    imageName,
                    cachedAlignment.position,
                    `${Math.round(bufferedDimensions.width)}px`,
                    `${Math.round(bufferedDimensions.height)}px`,
                    cachedAlignment.wrap
                );
            }

            // Remove the dimensions from the buffer after saving
            delete this.resizeBuffer[imageHash];
        }
        */

        // 使用 imageName 作为 key 清理 buffer
        const imageKey = imageName;
        if (this.resizeBuffer[imageKey]) {
            delete this.resizeBuffer[imageKey];
        }
    };

    /**
     * Throttles a function to be called at most once within a specified time limit.
     *
     * @param func - The function to throttle.
     * @param limit - The time limit in milliseconds.
     * @returns A throttled version of the function.
     */
    private throttle<T extends (...args: any[]) => void>(
        func: T,
        limit: number
    ): (...args: Parameters<T>) => void {
        let inThrottle: boolean;
        return (...args: Parameters<T>) => {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                window.setTimeout(() => inThrottle = false, limit);
            }
        };
    }
}
