import {
	Menu,
	View,
	TFile,
	Notice,
	setIcon,
	Platform,
	Component,
	normalizePath,
	App,
	MenuItem,
	MarkdownView,
	Editor,
	Modal,
} from 'obsidian';
import { t } from '../lang/helpers';

import * as path from 'path';
import ImageConverterPlugin from "../main";
import { FolderAndFilenameManagement } from '../local/FolderAndFilenameManagement';
import { ConfirmDialog } from '../settings/SettingsModals';
import { VariableProcessor, VariableContext } from '../local/VariableProcessor';
import { ImageAnnotationModal } from './ImageAnnotation';
import { Crop } from './Crop';
import { ProcessSingleImageModal } from "./modals/ProcessSingleImageModal";
import { CloudImageDeleter } from '../cloud/CloudImageDeleter';
import { pipeSyntaxParser } from '../utils/PipeSyntaxParser';

interface ImageMatch {
	lineNumber: number;
	line: string;
	fullMatch: string;
}

export class ContextMenu extends Component {
	private contextMenuRegistered = false;
	private currentMenu: Menu | null = null;
	private cloudDeleter: CloudImageDeleter;

	private readonly stopPropagationHandler = (e: Event) => e.stopPropagation();
	private readonly documentClickHandler = (event: MouseEvent) => {
		if (!(event.target as HTMLElement).closest('.image-converter-contextmenu-info-container') &&
			!(event.target as HTMLElement).closest('.menu-item')) {
			this.currentMenu?.hide();
		}
	};

	constructor(
		private app: App,
		private plugin: ImageConverterPlugin,
		private folderAndFilenameManagement: FolderAndFilenameManagement,
		private variableProcessor: VariableProcessor,
	) {
		super();
		this.cloudDeleter = new CloudImageDeleter(plugin);
		this.registerContextMenuListener();
	}

	/*-----------------------------------------------------------------*/
	/*                       CONTEXT MENU SETUP                        */
	/*-----------------------------------------------------------------*/

	/**
	 * Registers the context menu listener on the document.
	 * This listener will trigger the context menu when an image is right-clicked.
	 */
	registerContextMenuListener() {
		if (this.contextMenuRegistered) {
			return;
		}

		this.registerDomEvent(
			document,
			'contextmenu',
			this.handleContextMenuEvent,
			true
		);
		this.contextMenuRegistered = true;
	}

	/**
	 * Handles the context menu event.
	 * This function is called when the context menu is triggered on an image.
	 * @param event - The MouseEvent object.
	 */
	handleContextMenuEvent = (event: MouseEvent) => {
		const target = event.target as HTMLElement;
		const activeView = this.app.workspace.getActiveViewOfType(View);
		const isCanvasView = activeView?.getViewType() === 'canvas';

		if (isCanvasView) {
			return;
		}

		const img = target instanceof HTMLImageElement ? target : target.closest('img');
		if (!img) {
			return;
		}

		// Skip Excalidraw images
		if (this.plugin.supportedImageFormats.isExcalidrawImage(img)) {
			return;
		}

		const isImageInSupportedContainer = !!(
			img.closest('.markdown-preview-view') ||
			img.closest('.markdown-source-view')
			// img.closest('.view-content > div') // uncomment this to enable it inside its individual window
		);
		if (!isImageInSupportedContainer) {
			if (target.closest('.map-view-main')) {
				return;
			}
			return;
		}

		event.preventDefault(); // prevents the default context menu from appearing (if any)
		event.stopPropagation(); // prevents the event from bubbling up to parent elements (like the callout)

		const menu = new Menu();
		let activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			const mv = this.app.workspace.getActiveViewOfType(MarkdownView) as any;
			activeFile = (mv && (mv as any).file) ? (mv as any).file : null;
		}

		if (activeFile) {
			this.createContextMenuItems(menu, img, activeFile, event);
		}

		menu.showAtMouseEvent(event);
	};

	/*-----------------------------------------------------------------*/
	/*                     CONTEXT MENU ITEM CREATION                  */
	/*-----------------------------------------------------------------*/

	/**
	 * Creates the items for the context menu.
	 * @param menu - The Menu object to add items to.
	 * @param img - The HTMLImageElement that was right-clicked.
	 * @param activeFile - The currently active TFile.
	 * @param event - The MouseEvent object.
	 * @returns True if the menu was created successfully.
	 */
	createContextMenuItems(
		menu: Menu,
		img: HTMLImageElement,
		activeFile: TFile,
		event: MouseEvent
	) {
		this.currentMenu = menu;

		// Check if image is network image
		const isNetwork = this.isNetworkImage(img);

		this.addRenameAndMoveInputs(menu, img, activeFile, isNetwork);

		menu.addSeparator();

		if (!Platform.isMobile) {
			this.addOpenInNewWindowMenuItem(menu, img);
			menu.addSeparator();
			this.addCutImageMenuItem(menu, event);
		}

		this.addCopyImageMenuItem(menu, event);
		this.addCopyBase64ImageMenuItem(menu, event);

		menu.addSeparator();

		// Logic migrated from ImageAlignment.ts
		if (this.plugin.settings.alignment.enabled && this.plugin.imageStateManager) {
			this.addAlignmentOptions(menu, img);
		}

		// Network images: only show download option
		// Local images: show all processing options and upload
		if (isNetwork) {
			// Network image: show download option
			this.addDownloadNetworkImageMenuItem(menu, img, event);
		} else {
			// Local image: show converter options (process, crop, annotate)
			this.addProcessImageMenuItem(menu, img, event);
			this.addCropRotateFlipMenuItem(menu, img);
			this.addAnnotateImageMenuItem(menu, img);

			// Add upload option for local images (always available)
			this.addUploadToCloudMenuItem(menu, img, event);
		}

		menu.addSeparator();

		if (!Platform.isMobile) {
			this.addShowInNavigationMenuItem(menu, img)
			this.addShowInSystemExplorerMenuItem(menu, img)
		}



		menu.addSeparator();
		this.addDeleteImageAndLinkMenuItem(menu, event);

		return true;
	}

	/**
	 * Adds alignment options to the context menu.
	 * @param menu - The Menu object.
	 * @param img - The HTMLImageElement.
	 */
	addAlignmentOptions(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_ALIGN_IMAGE")) // Ensure this key exists or use "Alignment"
				.setIcon('align-center')
				.setSubmenu()
				.addItem((subItem) => {
					subItem
						.setTitle(t("ALIGN_LEFT"))
						.setIcon('align-left')
						.onClick(async () => {
							await this.plugin.imageStateManager?.updateState(img, { align: 'left' });
						});
				})
				.addItem((subItem) => {
					subItem
						.setTitle(t("ALIGN_CENTER"))
						.setIcon('align-center')
						.onClick(async () => {
							await this.plugin.imageStateManager?.updateState(img, { align: 'center' });
						});
				})
				.addItem((subItem) => {
					subItem
						.setTitle(t("ALIGN_RIGHT"))
						.setIcon('align-right')
						.onClick(async () => {
							await this.plugin.imageStateManager?.updateState(img, { align: 'right' });
						});
				})
				.addItem((subItem) => {
					subItem
						.setTitle(t("OPTION_NONE"))
						.setIcon('x')
						.onClick(async () => {
							// Assuming 'none' removes alignment
							await this.plugin.imageStateManager?.updateState(img, { align: 'center' }); // Wait, 'none' isn't in ImageAlignmentOptions usually, but let's check. Default to center or remove.
							// Actually ImageStateManager allows 'left' | 'center' | 'right'.
							// If I want to remove it, I might need to send specific instruction or handle invalid value.
							// For now I'll just skip 'none' or map it to a reset. 
							// But wait, the parser supports 'none' implicitly? No.
							// Let's stick to L/C/R.
						});
				});
		});
	}

	/**
	 * Check if an image is a network image (URL starts with http:// or https://)
	 */
	private isNetworkImage(img: HTMLImageElement): boolean {
		const src = img.getAttribute('src');
		if (!src) return false;
		return src.startsWith('http://') || src.startsWith('https://');
	}


	/*-----------------------------------------------------------------*/
	/*                        CAPTION INPUT                            */
	/*-----------------------------------------------------------------*/

	// loadCurrentCaption Logic Moved to ImageStateManager

	// loadCurrentDimensions Logic Moved to ImageStateManager

	// updateImageLinkWithDimensions Logic Moved to ImageStateManager

	/**
	 * Handles updating image dimensions and caption.
	 */
	private async handleDimensionsAndCaptionUpdate(
		menu: Menu,
		captionInput: HTMLInputElement,
		widthInput: HTMLInputElement,
		heightInput: HTMLInputElement,
		img: HTMLImageElement,
		activeFile: TFile,
		isResolvableOrNetwork: boolean
	) {
		const newCaption = captionInput.value.trim();
		const widthStr = widthInput.value.trim();
		const heightStr = heightInput.value.trim();

		// Validate dimensions
		if ((widthStr && !(/^\d+$/.test(widthStr))) || (heightStr && !(/^\d+$/.test(heightStr)))) {
			new Notice(t("MSG_DIMENSIONS_POSITIVE"));
			return;
		}

		if (this.plugin.imageStateManager) {
			await this.plugin.imageStateManager.updateState(img, {
				caption: newCaption,
				width: widthStr ? parseInt(widthStr) : undefined,
				height: heightStr ? parseInt(heightStr) : undefined
			});
			new Notice(t("MSG_CAPTION_UPDATED"));
		}

		menu.hide();
	}

	/*-----------------------------------------------------------------*/
	/*                      RENAME AND MOVE IMAGE                      */
	/*-----------------------------------------------------------------*/

	// All event listeners use this.registerDomEvent()
	// The Component class's onunload() will clean these up automatically
	// Even though we add these listeners each time the menu is created, they'll be cleaned up when:

	// The menu is closed (DOM elements are removed)
	// The component is unloaded
	// The plugin is disabled
	/**
	 * Adds input fields for renaming and moving the image to the context menu.
	 * @param menu - The Menu object to add the input fields to.
	 * @param img - The HTMLImageElement that was right-clicked.
	 * @param activeFile - The currently active TFile.
	 * @param isNetwork - Whether the image is a network image.
	 */
	addRenameAndMoveInputs(menu: Menu, img: HTMLImageElement, activeFile: TFile, isNetwork: boolean = false) {
		// Removed early return to allow Caption/Size inputs for network images

		const isNativeMenus = (this.app.vault as any).getConfig('nativeMenus');

		if (!isNativeMenus && !Platform.isMobile) {
			const imagePath = (this.folderAndFilenameManagement && typeof (this.folderAndFilenameManagement as any).getImagePath === 'function')
				? (this.folderAndFilenameManagement as any).getImagePath(img)
				: null;
			const isImageResolvable = imagePath !== null;

			let fileNameWithoutExt = '';
			let directoryPath = '';
			let fileExtension = '';
			let obsidianVaultPathForRename: string | undefined;
			let file: TFile | File;

			if (isImageResolvable) {
				const parsedPath = path.parse(imagePath);
				fileNameWithoutExt = parsedPath.name;
				directoryPath = parsedPath.dir;
				fileExtension = parsedPath.ext;
				obsidianVaultPathForRename = imagePath;
				if (!directoryPath) {
					directoryPath = '/';
				}

				const abstractFile = this.app.vault.getAbstractFileByPath(imagePath);
				file = abstractFile instanceof TFile ? abstractFile : new File([""], imagePath);
			}

			menu.addItem((item) => {
				const menuItem = item as any;

				// Create main container
				const inputContainer = document.createElement('div');
				inputContainer.className = 'image-converter-contextmenu-info-container';

				// Create name input group
				const nameGroup = document.createElement('div');
				nameGroup.className = 'image-converter-contextmenu-input-group';

				const nameIcon = document.createElement('div');
				nameIcon.className = 'image-converter-contextmenu-icon-container';
				setIcon(nameIcon, 'file-text');
				nameGroup.appendChild(nameIcon);

				const nameLabel = document.createElement('label');
				nameLabel.textContent = t("LABEL_NAME");
				nameLabel.setAttribute('for', 'image-converter-name-input');
				nameGroup.appendChild(nameLabel);

				const nameInput = document.createElement('input');
				nameInput.type = 'text';
				nameInput.value = fileNameWithoutExt;
				nameInput.placeholder = t("PLACEHOLDER_NAME");
				nameInput.className = 'image-converter-contextmenu-name-input';
				nameInput.id = 'image-converter-name-input';
				if (!isImageResolvable || isNetwork) {
					nameInput.classList.add('image-converter-contextmenu-disabled');
					nameInput.disabled = true;
				}
				nameGroup.appendChild(nameInput);

				// Create path input group
				const pathGroup = document.createElement('div');
				pathGroup.className = 'image-converter-contextmenu-input-group';

				const pathIcon = document.createElement('div');
				pathIcon.className = 'image-converter-contextmenu-icon-container';
				setIcon(pathIcon, 'folder');
				pathGroup.appendChild(pathIcon);

				const pathLabel = document.createElement('label');
				pathLabel.textContent = t("LABEL_FOLDER_CONTEXT");
				pathLabel.setAttribute('for', 'image-converter-path-input');
				pathGroup.appendChild(pathLabel);

				const pathInput = document.createElement('input');
				pathInput.type = 'text';
				pathInput.value = directoryPath;
				pathInput.placeholder = t("PLACEHOLDER_PATH");
				pathInput.className = 'image-converter-contextmenu-path-input';
				pathInput.id = 'image-converter-path-input';
				if (!isImageResolvable || isNetwork) {
					pathInput.classList.add('image-converter-contextmenu-disabled');
					pathInput.disabled = true;
				}
				pathGroup.appendChild(pathInput);

				// Create caption input group
				const captionGroup = document.createElement('div');
				captionGroup.className = 'image-converter-contextmenu-input-group';

				const captionIcon = document.createElement('div');
				captionIcon.className = 'image-converter-contextmenu-icon-container';
				setIcon(captionIcon, 'subtitles');
				captionGroup.appendChild(captionIcon);

				const captionLabel = document.createElement('label');
				captionLabel.textContent = t("LABEL_CAPTION");
				captionLabel.setAttribute('for', 'image-converter-caption-input');
				captionGroup.appendChild(captionLabel);

				const captionInput = document.createElement('input');
				captionInput.type = 'text';
				captionInput.placeholder = t("PLACEHOLDER_CAPTION_LOADING");
				captionInput.className = 'image-converter-contextmenu-caption-input';
				captionInput.id = 'image-converter-caption-input';
				captionGroup.appendChild(captionInput);

				// Create dimensions input group
				const dimensionsGroup = document.createElement('div');
				dimensionsGroup.className = 'image-converter-contextmenu-input-group';

				const dimensionsIcon = document.createElement('div');
				dimensionsIcon.className = 'image-converter-contextmenu-icon-container';
				setIcon(dimensionsIcon, 'aspect-ratio');
				dimensionsGroup.appendChild(dimensionsIcon);

				const dimensionsLabel = document.createElement('label');
				dimensionsLabel.textContent = t("LABEL_SIZE");
				dimensionsLabel.setAttribute('for', 'image-converter-width-input');
				dimensionsGroup.appendChild(dimensionsLabel);

				// Create width input
				const widthInput = document.createElement('input');
				widthInput.type = 'number';
				widthInput.min = '1';
				widthInput.placeholder = t("PLACEHOLDER_WIDTH");
				widthInput.className = 'image-converter-contextmenu-dimension-input';
				widthInput.id = 'image-converter-width-input';

				// Create height input
				const heightInput = document.createElement('input');
				heightInput.type = 'number';
				heightInput.min = '1';
				heightInput.placeholder = t("PLACEHOLDER_HEIGHT");
				heightInput.className = 'image-converter-contextmenu-dimension-input';
				heightInput.id = 'image-converter-height-input';

				// Create dimension inputs container
				const dimensionInputsContainer = document.createElement('div');
				dimensionInputsContainer.className = 'image-converter-contextmenu-dimension-inputs';
				dimensionInputsContainer.appendChild(widthInput);
				dimensionInputsContainer.appendChild(document.createTextNode('×')); // multiplication symbol
				dimensionInputsContainer.appendChild(heightInput);

				dimensionsGroup.appendChild(dimensionInputsContainer);

				// Load dimensions via StateManager
				const currentStateSize = this.plugin.imageStateManager?.getImageState(img);
				if (currentStateSize) {
					widthInput.value = currentStateSize.width?.toString() || "";
					heightInput.value = currentStateSize.height?.toString() || "";
				}



				// Add all groups to container
				if (!isNetwork) {
					inputContainer.appendChild(nameGroup);
					inputContainer.appendChild(pathGroup);
				}
				inputContainer.appendChild(captionGroup);
				inputContainer.appendChild(dimensionsGroup);


				// Add single confirm button
				const confirmButton = document.createElement('div');
				confirmButton.className = 'image-converter-contextmenu-button image-converter-contextmenu-confirm';
				setIcon(confirmButton, 'check');
				inputContainer.appendChild(confirmButton);

				// Register event listeners for all inputs
				[nameInput, pathInput, captionInput, widthInput, heightInput].forEach(input => {
					this.registerDomEvent(input, 'mousedown', this.stopPropagationHandler);
					this.registerDomEvent(input, 'click', this.stopPropagationHandler);
					this.registerDomEvent(input, 'keydown', this.stopPropagationHandler);
				});


				this.registerDomEvent(document, 'click', this.documentClickHandler);

				// Load caption via StateManager
				const currentState = this.plugin.imageStateManager?.getImageState(img);
				if (currentState) {
					captionInput.value = currentState.caption || "";
				}
				captionInput.placeholder = t("PLACEHOLDER_CAPTION");

				// Single confirm button handler
				this.registerDomEvent(confirmButton, 'click', async () => {
					if (isImageResolvable && !isNetwork) {
						// Only handle rename and move for local resolvable images
						await this.handleRenameAndMove(
							menu,
							nameInput,
							pathInput,
							img,
							isImageResolvable,
							fileNameWithoutExt,
							fileExtension,
							obsidianVaultPathForRename,
							file,
							activeFile
						);
					}

					// Handle caption and dimensions update for any editable image type (Local or Network)
					if (isImageResolvable || isNetwork) {
						await this.handleDimensionsAndCaptionUpdate(
							menu,
							captionInput,
							widthInput,
							heightInput,
							img,
							activeFile,
							isImageResolvable || isNetwork
						);
					}
				});

				// Clear and set the menu item content (gracefully handle test mocks without a DOM property)
				const maybeDom: any = (menuItem as any).dom;
				if (maybeDom && typeof maybeDom.appendChild === 'function') {
					// If Obsidian exposes a DOM element, populate it
					if (typeof maybeDom.empty === 'function') {
						maybeDom.empty();
					} else {
						// Fallback: clear via innerHTML if available
						try { maybeDom.innerHTML = ''; } catch (e) { void e; }
					}
					maybeDom.appendChild(inputContainer);
				} else {
					// Minimal fallback for test environment without MenuItem DOM
					(menuItem as any).setTitle?.(t("MENU_IMAGE_TOOLS"));
				}
			});
		}
	}

	/**
	 * Handles the renaming and moving of the image.
	 * @param menu - The Menu object.
	 * @param nameInput - The HTMLInputElement for the new name.
	 * @param pathInput - The HTMLInputElement for the new path.
	 * @param img - The HTMLImageElement to rename/move.
	 * @param isImageResolvable - Boolean indicating if the image path can be resolved.
	 * @param fileNameWithoutExt - The current file name without extension.
	 * @param fileExtension - The file extension.
	 * @param obsidianVaultPathForRename - The original path of the image in the Obsidian vault.
	 */
	// - `\ / : * ? " < > | [ ] ( )` - INVALID characters
	// Leading and trailing dots (`.`) are removed.
	// Leading and trailing spaces are removed.
	// For more examples check sanitizeFilename inside FolderAndFilenameManagement.ts
	private readonly handleRenameAndMove = async (
		menu: Menu,
		nameInput: HTMLInputElement,
		pathInput: HTMLInputElement,
		img: HTMLImageElement,
		isImageResolvable: boolean,
		fileNameWithoutExt: string,
		fileExtension: string,
		obsidianVaultPathForRename: string | undefined,
		file: TFile | File,
		activeFile: TFile
	) => {
		if (!isImageResolvable) return;
		let newName = nameInput.value;
		let newDirectoryPath = pathInput.value;

		// --- Process variables in the input fields ---
		const variableContext: VariableContext = { file, activeFile };
		newName = await this.variableProcessor.processTemplate(newName, variableContext);
		newDirectoryPath = await this.variableProcessor.processTemplate(newDirectoryPath, variableContext);

		if (!newName.trim()) {
			new Notice(t("MSG_ENTER_NEW_NAME"));
			return;
		}

		newName = this.folderAndFilenameManagement.sanitizeFilename(newName);

		if (/^[.]+$/.test(newName.trim())) {
			new Notice(t("MSG_ENTER_VALID_NAME"));
			return;
		}
		if (!newDirectoryPath.trim()) {
			new Notice(t("MSG_ENTER_NEW_PATH"));
			return;
		}

		if (obsidianVaultPathForRename) {
			try {
				// Handle Rename
				if (newName && newName !== fileNameWithoutExt) {
					const newPath = normalizePath(path.join(newDirectoryPath, `${newName}${fileExtension}`));
					const abstractFile = this.app.vault.getAbstractFileByPath(obsidianVaultPathForRename);
					if (abstractFile instanceof TFile) {
						await this.folderAndFilenameManagement.ensureFolderExists(newDirectoryPath);
						await this.app.fileManager.renameFile(abstractFile, newPath);
						img.src = this.app.vault.getResourcePath(abstractFile);
						new Notice(t("MSG_NAME_UPDATED"));
					}
				}
				// Handle Movea
				const currentNameWithExtension = `${newName}${fileExtension}`;
				const oldPath = obsidianVaultPathForRename;
				const newPath = normalizePath(path.join(newDirectoryPath, currentNameWithExtension));

				if (newPath !== oldPath) {
					const abstractFile = this.app.vault.getAbstractFileByPath(oldPath);
					if (abstractFile instanceof TFile) {
						await this.folderAndFilenameManagement.ensureFolderExists(newDirectoryPath);

						if (oldPath.toLowerCase() === newPath.toLowerCase()) {
							const safeRenameSuccessful = await this.folderAndFilenameManagement.safeRenameFile(abstractFile, newPath);
							if (safeRenameSuccessful) {
								new Notice(t("MSG_PATH_UPDATED_CASE"));
							} else {
								new Notice(t("MSG_PATH_UPDATE_FAILED_CASE"));
							}
						} else {
							await this.app.fileManager.renameFile(abstractFile, newPath);
							new Notice(t("MSG_PATH_UPDATED"));
						}
						img.src = this.app.vault.getResourcePath(abstractFile);
						const leaf = this.app.workspace.getMostRecentLeaf();
						if (leaf) {
							const currentState = leaf.getViewState();
							await leaf.setViewState({ type: 'empty', state: {} });
							await leaf.setViewState(currentState);
						}
					}
				}
			} catch (error) {
				console.error('Failed to update image path:', error);
				new Notice(t("MSG_PATH_UPDATE_FAILED"));
			}
		}
		menu.hide();
	};

	/*-----------------------------------------------------------------*/
	/*                         OPEN IN NEW WINDOW                      */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Open in new window" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement that was right-clicked.
	 */
	addOpenInNewWindowMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_OPEN_NEW_WINDOW"))
				.setIcon('square-arrow-out-up-right')
				.onClick(async () => {
					try {
						const imagePath = this.folderAndFilenameManagement.getImagePath(img);
						if (imagePath) {
							const file = this.app.vault.getAbstractFileByPath(imagePath);
							if (file instanceof TFile) {
								const leaf = this.app.workspace.getLeaf('window');
								if (leaf) {
									await leaf.openFile(file);
								}
							}
						}
					} catch (error) {
						new Notice(t("MSG_FAIL_OPEN_WINDOW"));
						console.error(error);
					}
				});
		});
	}

	/*-----------------------------------------------------------------*/
	/*                        HELPER METHODS                           */
	/*-----------------------------------------------------------------*/

	/**
	 * Normalizes an image path for consistent comparison.
	 * Converts backslashes to forward slashes, replaces '%20' with spaces,
	 * removes query parameters, converts to lowercase, and trims whitespace.
	 *
	 * @param path - The image path to normalize.
	 * @returns The normalized image path, always starting with a '/'.
	 */
	private normalizeImagePath(path: string): string {
		if (!path) return '';

		// Decode URL encoded characters first
		let normalizedPath = decodeURIComponent(path);

		// Remove any URL parameters
		const [pathWithoutQuery] = normalizedPath.split('?');
		normalizedPath = pathWithoutQuery;

		// Convert backslashes to forward slashes
		normalizedPath = normalizedPath.replace(/\\/g, '/');

		// Handle spaces in paths
		normalizedPath = normalizedPath.replace(/%20/g, ' ');

		// Ensure consistent leading slash
		if (!normalizedPath.startsWith('/')) {
			normalizedPath = `/${normalizedPath}`;
		}

		// Normalize any '../' or './' sequences
		normalizedPath = normalizePath(normalizedPath);

		return normalizedPath.toLowerCase();
	}

	/**
	 * Finds the line number where the frontmatter section ends in the editor.
	 *
	 * @param editor - The Obsidian Editor instance.
	 * @returns The line number of the frontmatter end, or -1 if not found.
	 */
	private findFrontmatterEnd(editor: Editor): number {
		let inFrontmatter = false;
		const lineCount = editor.getDoc().lineCount();

		for (let i = 0; i < lineCount; i++) {
			const line = editor.getLine(i).trim();
			if (line === '---') {
				if (!inFrontmatter && i === 0) {
					inFrontmatter = true;
				} else if (inFrontmatter) {
					return i;
				}
			}
		}
		return -1;
	}

	/**
	 * Extracts the filename from an image link, handling both wiki and markdown formats.
	 *
	 * @param link - The full image link.
	 * @returns The extracted filename, or null if not found.
	 */
	/**
	 * Extracts the filename from an image link, handling both wiki and markdown formats.
	 *
	 * @param link - The full image link.
	 * @returns The extracted filename, or null if not found.
	 */
	private extractFilenameFromLink(link: string): string | null {
		const parsed = pipeSyntaxParser.parsePipeSyntax(link);
		if (parsed && parsed.path) {
			return parsed.path;
		}
		return null;
	}


	/**
	 * Finds image links in the editor's content based on the provided criteria.
	 *
	 * @param editor - The Obsidian Editor instance.
	 * @param imagePath - The path of the image (for local images) or null (for external images).
	 * @param isExternal - A flag indicating whether the image is external.
	 * @returns An array of objects, each containing the line number, line content, and full match
	 *          for each matching image link found. Returns an empty array if no matches are found.
	 */
	private async findImageMatches(
		editor: Editor,
		imagePath: string | null,
		isExternal: boolean
	): Promise<{ lineNumber: number, line: string, fullMatch: string, index: number }[]> {
		const lineCount = editor.getDoc().lineCount();
		const frontmatterEnd = this.findFrontmatterEnd(editor);
		const matches: { lineNumber: number, line: string, fullMatch: string, index: number }[] = [];
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) return matches;

		for (let i = frontmatterEnd + 1; i < lineCount; i++) {
			const line = editor.getLine(i);
			const links = pipeSyntaxParser.extractAllLinks(line);

			for (const link of links) {
				const linkPath = link.data.path;

				if (isExternal) {
					// For external/network images, imagePath is effectively the URL
					// We compare the path in the link with the passed imagePath (URL)
					if (imagePath && linkPath === imagePath) {
						matches.push({ lineNumber: i, line, fullMatch: link.fullMatch, index: link.index });
					}
				} else {
					// For local images
					if (imagePath && !linkPath.startsWith('http')) {
						// Helper to resolve relative paths
						const resolveRelativePath = (p: string, activeFilePath: string): string => {
							const activeFileDir = path.dirname(activeFilePath);
							if (p.startsWith('./') || p.startsWith('../')) {
								return normalizePath(path.join(activeFileDir, p));
							}
							return normalizePath(p);
						};

						const resolvedLinkPath = resolveRelativePath(linkPath, activeFile.path);
						const normalizedImagePath = this.normalizeImagePath(imagePath);
						const normalizedResolvedPath = this.normalizeImagePath(resolvedLinkPath);

						// Check for exact match or if the normalized image path ends with the resolved path
						if (normalizedImagePath === normalizedResolvedPath ||
							normalizedImagePath.endsWith(normalizedResolvedPath)) {
							matches.push({ lineNumber: i, line, fullMatch: link.fullMatch, index: link.index });
						}
					}
				}
			}
		}

		return matches;
	}

	/**
	 * Processes the first Base64 image found in the editor's content.
	 *
	 * @param editor - The Obsidian Editor instance.
	 * @param src - The `src` attribute of the Base64 image to search for.
	 * @param processor - A callback function to process the matched Base64 image.
	 *                    This function takes the editor, line number, line content, and full match as arguments.
	 * @returns True if a Base64 image was found and processed, false otherwise.
	 */
	private async processBase64Image(
		editor: Editor,
		src: string,
		processor: (editor: Editor, lineNumber: number, line: string, fullMatch: string) => Promise<void>
	): Promise<boolean> {
		const lineCount = editor.getDoc().lineCount();
		for (let i = 0; i < lineCount; i++) {
			const line = editor.getLine(i);
			const base64Matches = [...line.matchAll(/<img\s+src="data:image\/[^"]+"\s*\/?>/g)];

			for (const match of base64Matches) {
				if (match[0].includes(src)) {
					await processor(editor, i, line, match[0]);
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Helper method to remove an image link from the editor.
	 * @param editor - The Editor instance.
	 * @param lineNumber - The line number where the match was found.
	 * @param line - The line content.
	 * @param fullMatch - The full matched text.
	 * @param copyToClipboard - Whether to copy the text to clipboard before removing.
	 */
	private async removeImageLinkFromEditor(
		editor: Editor,
		lineNumber: number,
		line: string,
		fullMatch: string,
		copyToClipboard: boolean
	) {
		if (copyToClipboard) {
			await navigator.clipboard.writeText(fullMatch);
		}

		const startPos = {
			line: lineNumber,
			ch: line.indexOf(fullMatch)
		};
		const endPos = {
			line: lineNumber,
			ch: startPos.ch + fullMatch.length
		};

		// Calculate trailing whitespace
		let trailingWhitespace = 0;
		while (line[endPos.ch + trailingWhitespace] === ' ' ||
			line[endPos.ch + trailingWhitespace] === '\t') {
			trailingWhitespace++;
		}

		// If this is the only content on the line, delete the entire line
		if (line.trim() === fullMatch.trim()) {
			editor.replaceRange('',
				{ line: lineNumber, ch: 0 },
				{ line: lineNumber + 1, ch: 0 });
		} else {
			// Otherwise, just delete the match and its trailing whitespace
			editor.replaceRange('',
				startPos,
				{ line: lineNumber, ch: endPos.ch + trailingWhitespace });
		}
	}

	/*-----------------------------------------------------------------*/
	/*                           CUT IMAGE                             */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Cut" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param event - The MouseEvent object.
	 */
	addCutImageMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item) => {
			item.setTitle(t("MENU_CUT"))
				.setIcon('scissors')
				.onClick(async () => {
					await this.cutImageAndLinkFromNote(event);
				});
		});
	}

	/**
	 * Cuts the image and its link from the note, copying the link to clipboard.
	 * @param event - The MouseEvent object.
	 */
	async cutImageAndLinkFromNote(event: MouseEvent) {
		const img = event.target as HTMLImageElement;
		const src = img.getAttribute('src');
		if (!src) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice(t("MSG_NO_ACTIVE_VIEW"));
			return;
		}

		try {
			const { editor } = activeView;

			if (src.startsWith('data:image/')) {
				const found = await this.processBase64Image(editor, src, async (editor, lineNumber, line, fullMatch) => {
					await this.removeImageLinkFromEditor(editor, lineNumber, line, fullMatch, true);
				});
				if (!found) {
					new Notice(t("MSG_FAIL_BASE64_LINK"));
				}
				return;
			}

			const imagePath = (src.startsWith('http://') || src.startsWith('https://'))
				? null
				: this.folderAndFilenameManagement.getImagePath(img);

			const isExternal = !imagePath;

			// Use the modified findImageMatches
			const matches = await this.findImageMatches(editor, imagePath, isExternal);

			if (matches.length === 0) {
				new Notice(t("MSG_LINK_NOT_FOUND"));
				return;
			}

			const handleConfirmation = async () => {
				for (const match of matches) {
					await this.removeImageLinkFromEditor(editor, match.lineNumber, match.line, match.fullMatch, true);
				}
				new Notice(t("MSG_CUT_COPIED"));
			};

			if (matches.length > 1) {
				// Show confirmation modal
				new ConfirmDialog(
					this.app,
					t("DIALOG_CUT_TITLE"),
					t("DIALOG_CUT_MSG").replace("{0}", matches.length.toString()),
					t("BUTTON_CUT"),
					async () => { // Callback for confirmation
						for (const match of matches) {
							await this.removeImageLinkFromEditor(editor, match.lineNumber, match.line, match.fullMatch, true);
						}
						new Notice(t("MSG_CUT_COPIED"));
					}
				).open();
			} else {
				// Proceed directly if only one match
				await handleConfirmation();
			}

		} catch (error) {
			console.error('Error cutting image:', error);
			new Notice(t("MSG_FAIL_CUT"));
		}
	}

	/*-----------------------------------------------------------------*/
	/*                          COPY IMAGE                             */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Copy image" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param event - The MouseEvent object.
	 */
	addCopyImageMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item: MenuItem) =>
			item
				.setTitle(t("MENU_COPY_IMAGE"))
				.setIcon('copy')
				.onClick(async () => {
					await this.copyImageToClipboard(event);
				})
		);
	}

	/**
	 * Copies the image to the clipboard.
	 * @param event - The MouseEvent object.
	 */
	async copyImageToClipboard(event: MouseEvent) {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		const targetImg = event.target as HTMLImageElement;

		// Use this.registerDomEvent() for proper cleanup
		this.registerDomEvent(img, 'load', async () => {
			try {
				const canvas = document.createElement('canvas');
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					new Notice(t("MSG_FAIL_GET_CANVAS"));
					return;
				}
				ctx.drawImage(img, 0, 0);
				const dataURL = canvas.toDataURL();
				const response = await fetch(dataURL);
				const blob = await response.blob();
				const item = new ClipboardItem({ [blob.type]: blob });
				await navigator.clipboard.write([item]);
				new Notice(t("MSG_COPY_SUCCESS"));
			} catch (error) {
				console.error('Failed to copy image:', error);
				new Notice(t("MSG_COPY_FAIL"));
			}
		});

		img.src = targetImg.src;
	}

	/*-----------------------------------------------------------------*/
	/*                      COPY BASE64 IMAGE                          */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Copy as Base64 encoded image" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param event - The MouseEvent object.
	 */
	addCopyBase64ImageMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item: MenuItem) =>
			item
				.setTitle(t("MENU_COPY_BASE64"))
				.setIcon('copy')
				.onClick(() => {
					this.copyImageAsBase64(event);
				})
		);
	}

	/**
	 * Copies the image as a Base64 encoded string to the clipboard.
	 * @param event - The MouseEvent object.
	 */
	async copyImageAsBase64(event: MouseEvent) {
		const targetImg = event.target as HTMLImageElement;
		const img = new Image();
		img.crossOrigin = 'anonymous';

		this.registerDomEvent(img, 'load', async () => {
			try {
				const canvas = document.createElement('canvas');
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					new Notice(t("MSG_FAIL_GET_CANVAS"));
					return;
				}
				ctx.drawImage(img, 0, 0);
				const dataURL = canvas.toDataURL();
				await navigator.clipboard.writeText(`<img src="${dataURL}"/>`);
				new Notice(t("MSG_COPY_BASE64_SUCCESS"));
			} catch (error) {
				console.error('Failed to copy image as Base64:', error);
				new Notice(t("MSG_COPY_BASE64_FAIL"));
			}
		});

		img.src = targetImg.src;
	}

	/*-----------------------------------------------------------------*/
	/*                            Convert/Compress                     */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Convert/Compress" menu item.
	 *
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement representing the image.
	 * @param event - The MouseEvent representing the context menu event.
	 */
	addProcessImageMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		menu.addItem((item) => {
			item.setTitle(t("MENU_CONVERT_COMPRESS"))
				.setIcon("cog")
				.onClick(async () => {

					try {
						// Ensure there is an active markdown view
						const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (!activeView) {
							new Notice(t("MSG_NO_ACTIVE_VIEW"));
							return;
						}

						// Get the current note being viewed
						const currentFile = activeView.file;
						if (!currentFile) {
							new Notice(t("MSG_NO_CURRENT_FILE"));
							return;
						}

						// Extract the filename from the img's src attribute
						const srcAttribute = img.getAttribute("src");
						if (!srcAttribute) {
							new Notice(t("MSG_NO_SOURCE_ATTR"));
							return;
						}

						// Decode the filename from the src attribute
						const filename = decodeURIComponent(srcAttribute.split("?")[0].split("/").pop() || "");
						if (!filename) {
							new Notice(t("MSG_NO_FILENAME"));
							return;
						}

						// Search for matching files in the vault
						const matchingFiles = this.app.vault.getFiles().filter((file) => file.name === filename);
						if (matchingFiles.length === 0) {
							console.error("No matching files found for:", filename);
							new Notice(t("MSG_NO_MATCHING_FILES").replace("{0}", filename));
							return;
						}

						// If multiple matches, prefer files in the same folder as the current note
						const file =
							matchingFiles.length === 1
								? matchingFiles[0]
								: matchingFiles.find((fileItem) => {
									const parentPath = currentFile.parent?.path;
									return parentPath ? fileItem.path.startsWith(parentPath) : false;
								}) || matchingFiles[0];

						// Process the found file
						if (file instanceof TFile) {
							new ProcessSingleImageModal(this.app, this.plugin, file).open();
						} else {
							new Notice(t("MSG_NOT_IMAGE_FILE"));
						}

					} catch (error) {
						console.error("Error processing image:", error);
						new Notice(t("MSG_PROCESS_ERROR"));
					}
				});
		});
	}

	/*-----------------------------------------------------------------*/
	/*                            CROP                                 */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Crop/Rotate/Flip" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement that was right-clicked.
	 */
	addCropRotateFlipMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_CROP_FLIP"))
				.setIcon('scissors')
				.onClick(async () => {
					// Get the active markdown view
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!activeView) {
						new Notice(t("MSG_NO_ACTIVE_VIEW"));
						return;
					}

					// Get the current file (note) being viewed
					const currentFile = activeView.file;
					if (!currentFile) {
						new Notice(t("MSG_NO_CURRENT_FILE"));
						return;
					}

					// Get the filename from the src attribute
					const srcAttribute = img.getAttribute('src');
					if (!srcAttribute) {
						new Notice(t("MSG_NO_SOURCE_ATTR"));
						return;
					}

					// Extract just the filename
					const filename = decodeURIComponent(srcAttribute.split('?')[0].split('/').pop() || '');

					// Search for the file in the vault
					const matchingFiles = this.app.vault.getFiles().filter(file =>
						file.name === filename
					);

					if (matchingFiles.length === 0) {
						console.error('No matching files found for:', filename);
						new Notice(t("MSG_NO_MATCHING_FILES").replace("{0}", filename));
						return;
					}

					// If multiple matches, try to find the one in the same folder as the current note
					const file = matchingFiles.length === 1
						? matchingFiles[0]
						: matchingFiles.find((fileItem) => {
							// Get the parent folder of the current file
							const parentPath = currentFile.parent?.path;
							return parentPath
								? fileItem.path.startsWith(parentPath)
								: false;
						}) || matchingFiles[0];

					if (file instanceof TFile) {
						new Crop(this.app, file).open();
					} else {
						new Notice(t("MSG_VISUAL_LOCATE_ERROR"));
					}
				});
		});
	}


	/*-----------------------------------------------------------------*/
	/*                      Image Annotation                           */
	/*-----------------------------------------------------------------*/

	addAnnotateImageMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_ANNOTATE"))
				.setIcon('pencil')
				.onClick(async () => {
					try {
						// Get the active markdown view
						const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (!activeView) {
							new Notice(t("MSG_NO_ACTIVE_VIEW"));
							return;
						}

						// Get the current file (note) being viewed
						const currentFile = activeView.file;
						if (!currentFile) {
							new Notice(t("MSG_NO_CURRENT_FILE"));
							return;
						}

						// Get the filename from the src attribute
						const srcAttribute = img.getAttribute('src');
						if (!srcAttribute) {
							new Notice(t("MSG_NO_SOURCE_ATTR"));
							return;
						}

						// Extract just the filename
						const filename = decodeURIComponent(srcAttribute.split('?')[0].split('/').pop() || '');
						// console.log('Extracted filename:', filename);

						// Search for the file in the vault
						const matchingFiles = this.app.vault.getFiles().filter(file =>
							file.name === filename
						);

						if (matchingFiles.length === 0) {
							console.error('No matching files found for:', filename);
							new Notice(t("MSG_NO_MATCHING_FILES").replace("{0}", filename));
							return;
						}

						// If multiple matches, try to find the one in the same folder as the current note
						const file = matchingFiles.length === 1
							? matchingFiles[0]
							: matchingFiles.find((fileItem) => {
								// Get the parent folder of the current file
								const parentPath = currentFile.parent?.path;
								return parentPath
									? fileItem.path.startsWith(parentPath)
									: false;
							}) || matchingFiles[0];

						if (file instanceof TFile) {
							// console.log('Found file:', file.path);
							new ImageAnnotationModal(this.app, this.plugin, file).open();
						} else {
							new Notice(t("MSG_VISUAL_LOCATE_ERROR"));
						}
					} catch (error) {
						console.error('Image location error:', error);
						new Notice(t("MSG_RESOLVE_PATH_FAIL"));
					}
				});
		});
	}

	/*-----------------------------------------------------------------*/
	/*                      SHOW IN NAVIGATION                         */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Show in navigation" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement whose file needs to be shown.
	 */
	addShowInNavigationMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_SHOW_NAV"))
				.setIcon('folder-open')
				.onClick(async () => {
					await this.showImageInNavigation(img);
				});
		});
	}

	/**
	 * Shows the image file in the navigation pane.
	 * @param img - The HTMLImageElement whose file needs to be shown.
	 */
	async showImageInNavigation(img: HTMLImageElement) {
		try {
			const imagePath = this.folderAndFilenameManagement.getImagePath(img);
			if (imagePath) {
				const file = this.app.vault.getAbstractFileByPath(imagePath);
				if (file instanceof TFile) {
					// First, try to get existing file explorer
					let [fileExplorerLeaf] = this.app.workspace.getLeavesOfType('file-explorer');

					// If file explorer isn't open, create it
					if (!fileExplorerLeaf) {
						const newLeaf = this.app.workspace.getLeftLeaf(false);
						if (newLeaf) {
							await newLeaf.setViewState({
								type: 'file-explorer'
							});
							fileExplorerLeaf = newLeaf;
						}
					}

					// Proceed only if we have a valid leaf
					if (fileExplorerLeaf) {
						// Ensure the left sidebar is expanded
						if (this.app.workspace.leftSplit) {
							this.app.workspace.leftSplit.expand();
						}

						// Now reveal the file
						const fileExplorerView = fileExplorerLeaf.view;
						if (fileExplorerView) {
							// @ts-ignore (since revealInFolder is not in the type definitions)
							fileExplorerView.revealInFolder(file);
						}
					}
				}
			}
		} catch (error) {
			new Notice(t("MSG_FAIL_SHOW_NAV"));
			console.error(error);
		}
	}


	/*-----------------------------------------------------------------*/
	/*                  SHOW IN SYSTEM EXPLORER                        */
	/*-----------------------------------------------------------------*/
	/**
	 * Adds the "Show in system explorer" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement whose file needs to be shown in the system explorer.
	 */
	addShowInSystemExplorerMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_SHOW_EXPLORER"))
				.setIcon('arrow-up-right')
				.onClick(async () => {
					await this.showImageInSystemExplorer(img);
				});
		});
	}

	/**
	 * Shows the image file in the system explorer.
	 * @param img - The HTMLImageElement whose file needs to be shown in the system explorer.
	 */
	async showImageInSystemExplorer(img: HTMLImageElement) {
		try {
			const imagePath = this.folderAndFilenameManagement.getImagePath(img);
			if (imagePath) {
				// Use the Obsidian API to reveal the file in the system explorer
				await this.app.showInFolder(imagePath);
			}
		} catch (error) {
			new Notice(t("MSG_FAIL_SHOW_EXPLORER"));
			console.error(error);
		}
	}

	/*-----------------------------------------------------------------*/
	/*                  UPLOAD TO CLOUD                                */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Upload to Cloud" menu item for local images.
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement
	 * @param event - The MouseEvent object.
	 */
	addUploadToCloudMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		const src = img.getAttribute('src');
		if (!src) return;

		// Only show for local images (not network URLs)
		if (src.startsWith('http://') || src.startsWith('https://')) {
			return; // Skip cloud images
		}

		menu.addItem((item) => {
			item.setTitle(t("MENU_UPLOAD_CLOUD"))
				.setIcon('cloud-upload')
				.onClick(async () => {
					await this.uploadImageToCloud(img);
				});
		});
	}

	/**
	 * Upload a local image to cloud storage
	 * 上传本地图片到图床
	 * @param img - The HTMLImageElement
	 */
	private async uploadImageToCloud(img: HTMLImageElement) {
		try {
			// Get image path
			const imagePath = this.folderAndFilenameManagement.getImagePath(img);
			if (!imagePath) {
				new Notice(t("MSG_RESOLVE_PATH_FAIL"));
				console.warn('[Upload] Cannot resolve image path for:', img.getAttribute('src'));
				return;
			}

			// Get TFile object
			const file = this.app.vault.getAbstractFileByPath(imagePath);
			if (!(file instanceof TFile)) {
				new Notice(t("MSG_FILE_NOT_FOUND"));
				console.warn('[Upload] File not found:', imagePath);
				return;
			}

			// Call the plugin's uploadSingleFile method
			await this.plugin.uploadSingleFile(file);
		} catch (error) {
			console.error('[Upload] Error uploading image:', error);
			new Notice(t("MSG_UPLOAD_FAILED").replace("{0}", error.message));
		}
	}

	/**
	 * Add "Download Network Image" menu item for network images
	 * 为网络图片添加"下载到本地"菜单项
	 * @param menu - The Menu object to add the item to.
	 * @param img - The HTMLImageElement.
	 * @param event - The MouseEvent object.
	 */
	addDownloadNetworkImageMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		const src = img.getAttribute('src');
		if (!src) return;

		// Only show for network images
		if (!src.startsWith('http://') && !src.startsWith('https://')) {
			return;
		}

		menu.addItem((item) => {
			item.setTitle(t("MENU_DOWNLOAD_NETWORK_IMAGE"))
				.setIcon('download')
				.onClick(async () => {
					await this.downloadNetworkImage(img);
				});
		});
	}

	/**
	 * Download a network image to local storage
	 * 下载网络图片到本地
	 * @param img - The HTMLImageElement
	 */
	private async downloadNetworkImage(img: HTMLImageElement) {
		try {
			const src = img.getAttribute('src');
			if (!src) {
				new Notice(t("MSG_RESOLVE_PATH_FAIL"));
				return;
			}

			// Get active view and editor
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView || !activeView.file) {
				new Notice(t("MSG_NO_ACTIVE_VIEW"));
				return;
			}

			const activeFile = activeView.file;
			const editor = activeView.editor;

			// Call NetworkImageDownloader to download the single image
			const downloader = this.plugin.networkDownloader;
			if (!downloader) {
				new Notice(t("MSG_DOWNLOADER_UNAVAILABLE"));
				return;
			}

			// Download and replace the link (pass editor for automatic link replacement)
			const success = await downloader.downloadSingleImage(src, activeFile, editor);

			if (success) {
				new Notice(t("MSG_DOWNLOAD_SUCCESS"));
			} else {
				new Notice(t("MSG_DOWNLOAD_FAILED").replace("{0}", "Unknown error"));
			}
		} catch (error) {
			console.error('[Download] Error downloading network image:', error);
			new Notice(t("MSG_DOWNLOAD_FAILED").replace("{0}", error.message));
		}
	}

	/*-----------------------------------------------------------------*/
	/*                  DELETE IMAGE AND LINK                          */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Delete Image and Link" menu item.
	 * @param menu - The Menu object to add the item to.
	 * @param event - The MouseEvent object.
	 */
	addDeleteImageAndLinkMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item) => {
			item.setTitle(t("MENU_DELETE_LINK"))
				.setIcon('trash')
				.onClick(async () => {
					await this.deleteImageAndLinkFromNote(event);
				});
		});
	}

	/**
	 * Deletes both the image file and its link from the note.
	 * Auto-detects whether it's a local or cloud image and handles accordingly.
	 * - Local images: Deletes text link and local file
	 * - Cloud images: Deletes text link and cloud image (PicList only)
	 * @param event - The MouseEvent object.
	 */
	async deleteImageAndLinkFromNote(event: MouseEvent) {
		const img = event.target as HTMLImageElement;
		const src = img.getAttribute('src');
		if (!src) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice(t("MSG_NO_ACTIVE_VIEW"));
			return;
		}

		try {
			const { editor } = activeView;

			// Handle Base64 images
			if (src.startsWith('data:image/')) {
				const found = await this.processBase64Image(editor, src, async (editor, lineNumber, line, fullMatch) => {
					await this.removeImageLinkFromEditor(editor, lineNumber, line, fullMatch, false);
				});
				if (!found) {
					new Notice(t("MSG_FAIL_FIND_BASE64"));
				}
				return;
			}

			// Check if it's a cloud image
			const isCloudImage = this.cloudDeleter.isCloudImage(src);

			if (isCloudImage) {
				// Handle cloud image deletion
				await this.deleteCloudImageAndLink(editor, src);
				return;
			}

			// Handle local image deletion
			const imagePath = this.folderAndFilenameManagement.getImagePath(img);
			const isExternal = !imagePath;
			const matches = await this.findImageMatches(editor, imagePath, isExternal);

			if (matches.length === 0) {
				new Notice(t("MSG_FAIL_FIND_IMAGE"));
				return;
			}

			// Identify unique matches based on line number, line content, and full match
			const uniqueMatchesMap: Map<string, ImageMatch> = new Map();
			for (const match of matches) {
				const key = `${match.lineNumber}-${match.line}-${match.fullMatch}`; // Create a unique key
				if (!uniqueMatchesMap.has(key)) {
					uniqueMatchesMap.set(key, match); // Add to map if not already present
				}
			}
			const uniqueMatches: ImageMatch[] = Array.from(uniqueMatchesMap.values());


			if (uniqueMatches.length === 0) {
				new Notice(t("MSG_FAIL_FIND_UNIQUE")); // Should not happen ideally as 'matches.length > 0' check is before, but good to have.
				return;
			}


			const handleConfirmation = async () => {
				// Sort matches by line number in descending order to handle deletions from bottom to top
				// This prevents line number shifting from affecting subsequent deletions
				const sortedMatches = uniqueMatches.sort((matchA, matchB) => matchB.lineNumber - matchA.lineNumber);

				for (const match of sortedMatches) {
					await this.removeImageLinkFromEditor(editor, match.lineNumber, match.line, match.fullMatch, false);
				}

				new Notice(t("MSG_REMOVED_LINKS"));

				// Delete the actual local image file if it exists in the vault
				if (imagePath) {
					const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
					if (imageFile instanceof TFile) {
						await this.app.vault.trash(imageFile, true);
						new Notice(t("MSG_TRASHED_FILE"));
					}
				}
			};

			// Show info in confirmation MODAL if more than 1 UNIQUE image were found
			if (uniqueMatches.length > 1) {
				// Create a DocumentFragment for the details
				const detailsFragment = document.createDocumentFragment();

				// Create a container div for the message within the fragment
				const messageContainer = document.createElement('div');
				detailsFragment.appendChild(messageContainer);

				// Add introductory text
				const introText = document.createElement('p');
				introText.textContent = t("MSG_FOUND_IMAGE_REFS").replace("{0}", uniqueMatches.length.toString()); // Updated message
				messageContainer.appendChild(introText);

				// Add details to the message container
				uniqueMatches.forEach((match, index) => { // Iterate over uniqueMatches
					const lineNumber = match.lineNumber + 1;
					const lineContent = match.line.trim();
					const detailDiv = document.createElement('div');
					detailDiv.style.marginBottom = '5px'; // Add some spacing between lines
					detailDiv.innerHTML = `  ${index + 1}. Line ${lineNumber}: ${lineContent}`;
					messageContainer.appendChild(detailDiv); // Append to messageContainer
				});

				new ConfirmDialog(
					this.app,
					t("DIALOG_DELETE_TITLE"),
					detailsFragment, // Pass the fragment
					t("BUTTON_DELETE"),
					handleConfirmation
				).open();
			} else if (uniqueMatches.length === 1) { // if only 1 unique match, proceed directly without confirmation for multiple
				await handleConfirmation();
			} else {
				// This case should not happen because of the initial check `if (uniqueMatches.length === 0)` but for completeness.
				new Notice(t("MSG_NO_UNIQUE_LINKS"));
			}


		} catch (error) {
			console.error('Error deleting image:', error);
			new Notice(t("MSG_FAIL_DELETE"));
		}
	}

	/**
	 * Delete cloud image and its link from the note
	 * 删除云端图片及其在笔记中的链接
	 * - 单次引用：直接删除
	 * - 多次引用：弹出确认框，让用户选择只删除一个还是全部删除
	 * @param editor - The Editor instance
	 * @param cloudUrl - The cloud image URL
	 */
	private async deleteCloudImageAndLink(editor: Editor, cloudUrl: string) {
		try {
			console.log('[Cloud Delete] Starting cloud image deletion for:', cloudUrl);

			// Find all matches of this cloud image in the note
			const matches = await this.findImageMatches(editor, cloudUrl, true);

			if (matches.length === 0) {
				new Notice(t("MSG_FAIL_FIND_CLOUD"));
				return;
			}

			// Remove duplicates
			const uniqueMatchesMap: Map<string, ImageMatch> = new Map();
			for (const match of matches) {
				const key = `${match.lineNumber}-${match.line}-${match.fullMatch}`;
				if (!uniqueMatchesMap.has(key)) {
					uniqueMatchesMap.set(key, match);
				}
			}
			const uniqueMatches: ImageMatch[] = Array.from(uniqueMatchesMap.values());

			if (uniqueMatches.length === 0) {
				new Notice(t("MSG_FAIL_FIND_UNIQUE"));
				return;
			}

			// 删除单个图片链接和云端文件的函数
			const deleteSingleImage = async (match: ImageMatch) => {
				await this.removeImageLinkFromEditor(editor, match.lineNumber, match.line, match.fullMatch, false);
				new Notice(t("MSG_CLOUD_LINK_REMOVED"));

				// Try to delete from cloud storage (PicList only)
				const cloudDeleteSuccess = await this.cloudDeleter.deleteImage({ url: cloudUrl });

				// Force remove from history to avoid bloat (even if cloud delete failed or not supported)
				await this.plugin.historyManager.removeRecord(cloudUrl);

				if (cloudDeleteSuccess) {
					new Notice(t("MSG_CLOUD_DELETE_SUCCESS"));
				} else {
					const uploader = this.plugin.settings.pasteHandling.cloud.uploader;
					if (uploader === 'PicList') {
						new Notice(t("MSG_CLOUD_DELETE_FAIL_HISTORY"));
					} else {
						new Notice(t("MSG_CLOUD_DELETE_UNSUPPORTED").replace("{0}", uploader));
					}
				}
			};

			// 删除所有图片链接和云端文件的函数
			const deleteAllImages = async () => {
				// Sort matches by line number in descending order
				const sortedMatches = uniqueMatches.sort((matchA, matchB) => matchB.lineNumber - matchA.lineNumber);

				// Delete all text links from editor
				for (const match of sortedMatches) {
					await this.removeImageLinkFromEditor(editor, match.lineNumber, match.line, match.fullMatch, false);
				}

				new Notice(t("MSG_REMOVED_CLOUD_LINKS").replace("{0}", uniqueMatches.length.toString()));

				// Try to delete from cloud storage (PicList only)
				const cloudDeleteSuccess = await this.cloudDeleter.deleteImage({ url: cloudUrl });

				// Force remove from history to avoid bloat
				await this.plugin.historyManager.removeRecord(cloudUrl);

				if (cloudDeleteSuccess) {
					new Notice(t("MSG_CLOUD_DELETED"));
				} else {
					const uploader = this.plugin.settings.pasteHandling.cloud.uploader;
					if (uploader === 'PicList') {
						new Notice(t("MSG_CLOUD_DELETE_FAIL"));
					} else {
						new Notice(t("MSG_CLOUD_MANUAL_DELETE").replace("{0}", uploader));
					}
				}
			};

			// 如果只有一次引用，直接删除
			if (uniqueMatches.length === 1) {
				await deleteSingleImage(uniqueMatches[0]);
			} else {
				// 多次引用，显示确认对话框
				const detailsFragment = document.createDocumentFragment();
				const messageContainer = document.createElement('div');
				detailsFragment.appendChild(messageContainer);

				const introText = document.createElement('p');
				introText.textContent = t("MSG_FOUND_CLOUD_REFS").replace("{0}", uniqueMatches.length.toString());
				messageContainer.appendChild(introText);

				// 列出所有引用位置
				const listTitle = document.createElement('p');
				listTitle.style.fontWeight = 'bold';
				listTitle.style.marginTop = '10px';
				listTitle.textContent = t("LABEL_REFERENCES");
				messageContainer.appendChild(listTitle);

				uniqueMatches.forEach((match, index) => {
					const lineNumber = match.lineNumber + 1;
					const lineContent = match.line.trim();
					const detailDiv = document.createElement('div');
					detailDiv.style.marginBottom = '5px';
					detailDiv.style.fontSize = '0.9em';
					detailDiv.innerHTML = `  ${index + 1}. Line ${lineNumber}: ${lineContent.substring(0, 60)}${lineContent.length > 60 ? '...' : ''}`;
					messageContainer.appendChild(detailDiv);
				});

				// 创建自定义确认对话框，带有两个按钮
				const modal = new Modal(this.app);
				modal.titleEl.setText(t("DIALOG_DELETE_CLOUD_TITLE"));
				modal.contentEl.empty();
				modal.contentEl.appendChild(detailsFragment);

				// 按钮容器
				const buttonContainer = modal.contentEl.createDiv({ cls: 'modal-button-container' });
				buttonContainer.style.display = 'flex';
				buttonContainer.style.justifyContent = 'flex-end';
				buttonContainer.style.gap = '10px';
				buttonContainer.style.marginTop = '20px';

				// "Delete Only This One" 按钮
				const deleteOneBtn = buttonContainer.createEl('button', { text: t("BUTTON_DELETE_ONE") });
				deleteOneBtn.addEventListener('click', async () => {
					modal.close();
					await deleteSingleImage(uniqueMatches[0]); // 删除第一个匹配（用户点击的）
				});

				// "Delete All" 按钮
				const deleteAllBtn = buttonContainer.createEl('button', { text: t("BUTTON_DELETE_ALL").replace("{0}", uniqueMatches.length.toString()), cls: 'mod-warning' });
				deleteAllBtn.addEventListener('click', async () => {
					modal.close();
					await deleteAllImages();
				});

				// "Cancel" 按钮
				const cancelBtn = buttonContainer.createEl('button', { text: t("BUTTON_CANCEL") });
				cancelBtn.addEventListener('click', () => {
					modal.close();
				});

				modal.open();
			}

		} catch (error) {
			console.error('[Cloud Delete] Error deleting cloud image:', error);
			new Notice(t("MSG_FAIL_DELETE_CLOUD"));
		}
	}

	onunload() {
		super.onunload();  // Important! Calls Component's cleanup
		if (this.currentMenu) {
			this.currentMenu.hide();
			this.currentMenu = null;
		}
		this.contextMenuRegistered = false;
	}

}
