import {
	Menu,
	View,
	TFile,
	Platform,
	Component,
	App,
	MarkdownView,
} from 'obsidian';
import { t } from '../lang/helpers';

import ImageConverterPlugin from "../main";
import { FolderAndFilenameManagement } from '../local/FolderAndFilenameManagement';
import { VariableProcessor } from '../local/VariableProcessor';
import { CloudImageDeleter } from '../cloud/CloudImageDeleter';

// Import handlers
import { DeleteHandler } from './contextMenu/handlers/DeleteHandler';
import { UploadDownloadHandler } from './contextMenu/handlers/UploadDownloadHandler';
import { ClipboardHandler } from './contextMenu/handlers/ClipboardHandler';
import { ProcessingHandler } from './contextMenu/handlers/ProcessingHandler';
import { NavigationHandler } from './contextMenu/handlers/NavigationHandler';
import { RenameHandler } from './contextMenu/handlers/RenameHandler';

// Import utils
import { ImagePathUtils } from './contextMenu/utils/ImagePathUtils';
import { ImageMatchFinder } from './contextMenu/utils/ImageMatchFinder';
import { EditorLinkRemover } from './contextMenu/utils/EditorLinkRemover';

// Import input builders
import { RenameInputBuilder } from './contextMenu/inputs/RenameInputBuilder';

export class ContextMenu extends Component {
	private contextMenuRegistered = false;
	private currentMenu: Menu | null = null;
	private cloudDeleter: CloudImageDeleter;

	// Handlers
	private deleteHandler: DeleteHandler;
	private uploadDownloadHandler: UploadDownloadHandler;
	private clipboardHandler: ClipboardHandler;
	private processingHandler: ProcessingHandler;
	private navigationHandler: NavigationHandler;
	private renameHandler: RenameHandler;

	// Utils
	private imageMatchFinder: ImageMatchFinder;
	private linkRemover: EditorLinkRemover;

	// Input builders
	private renameInputBuilder: RenameInputBuilder;

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

		// Initialize cloud deleter
		this.cloudDeleter = new CloudImageDeleter(plugin);

		// Initialize utils
		this.imageMatchFinder = new ImageMatchFinder(app);
		this.linkRemover = new EditorLinkRemover();

		// Initialize handlers
		this.deleteHandler = new DeleteHandler(
			app,
			plugin,
			folderAndFilenameManagement,
			this.imageMatchFinder,
			this.linkRemover,
			this.cloudDeleter
		);

		this.uploadDownloadHandler = new UploadDownloadHandler(
			app,
			plugin,
			folderAndFilenameManagement
		);

		this.clipboardHandler = new ClipboardHandler(
			app,
			folderAndFilenameManagement,
			this.imageMatchFinder,
			this.linkRemover
		);

		this.processingHandler = new ProcessingHandler(
			app,
			plugin
		);

		this.navigationHandler = new NavigationHandler(
			app,
			folderAndFilenameManagement
		);

		this.renameHandler = new RenameHandler(
			app,
			plugin,
			folderAndFilenameManagement,
			variableProcessor
		);

		// Initialize input builders
		this.renameInputBuilder = new RenameInputBuilder(
			app,
			plugin,
			folderAndFilenameManagement
		);

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
		);
		if (!isImageInSupportedContainer) {
			if (target.closest('.map-view-main')) {
				return;
			}
			return;
		}

		event.preventDefault();
		event.stopPropagation();

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
		const isNetwork = ImagePathUtils.isNetworkImage(img);

		// 1. TOP SECTION: Inputs & Pipe Syntax Controls
		// =========================================================

		// Build rename/move/caption/dimension inputs
		const inputs = this.renameInputBuilder.buildInputs(menu, img, activeFile, isNetwork);

		// If inputs were created, add event handler to confirm button
		if (inputs) {
			inputs.confirmButton.addEventListener('click', async () => {
				if (inputs.isImageResolvable && !isNetwork) {
					// Handle rename and move for local resolvable images
					await this.renameHandler.handleRenameAndMove(
						menu,
						inputs.nameInput,
						inputs.pathInput,
						img,
						inputs.isImageResolvable,
						inputs.fileNameWithoutExt,
						inputs.fileExtension,
						inputs.obsidianVaultPathForRename,
						inputs.file,
						activeFile
					);
				}

				// Handle caption and dimensions update for any editable image type
				if (inputs.isImageResolvable || isNetwork) {
					await this.renameHandler.handleDimensionsAndCaptionUpdate(
						menu,
						inputs.captionInput,
						inputs.widthInput,
						inputs.heightInput,
						inputs.getAlignment(), // Pass alignment
						img,
						activeFile,
						inputs.isImageResolvable || isNetwork
					);
				}
			});
		}


		// 2. MIDDLE SECTION: Tools & Management (Consolidated)
		// =========================================================

		if (!Platform.isMobile) {
			this.addOpenInNewWindowMenuItem(menu, img);
			menu.addSeparator();

			// Start of Consolidated Tool Block (No internal separators)
			this.addCutImageMenuItem(menu, event);
		} else {
			// Mobile start of tool block
		}

		// Hide Copy operations for network images (CORS issues)
		if (!isNetwork) {
			this.addCopyImageMenuItem(menu, event);
			this.addCopyBase64ImageMenuItem(menu, event);
		}

		// Network images: only show download option
		// Local images: show all processing options and upload
		if (isNetwork) {
			this.addDownloadNetworkImageMenuItem(menu, img, event);
		} else {
			this.addProcessImageMenuItem(menu, img, event);
			this.addCropRotateFlipMenuItem(menu, img);
			this.addAnnotateImageMenuItem(menu, img);
			this.addUploadToCloudMenuItem(menu, img, event);
		}

		// Delete option (Moved to Middle Section, end of tool block)
		this.addDeleteImageAndLinkMenuItem(menu, event);

		menu.addSeparator();


		// 3. BOTTOM SECTION: Navigation
		// =========================================================

		if (!Platform.isMobile && !isNetwork) {
			this.addShowInNavigationMenuItem(menu, img);
			this.addShowInSystemExplorerMenuItem(menu, img);
		}

		return true;
	}


	/*-----------------------------------------------------------------*/
	/*                       MENU ITEM ADDERS                          */
	/*-----------------------------------------------------------------*/

	/**
	 * Adds the "Open in new window" menu item.
	 */
	addOpenInNewWindowMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_OPEN_NEW_WINDOW"))
				.setIcon('external-link')
				.onClick(() => {
					const currentSrc = img.src;
					if (currentSrc) {
						window.open(currentSrc, '_blank');
					}
				});
		});
	}

	/**
	 * Adds the "Cut" menu item.
	 */
	addCutImageMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item) => {
			item.setTitle(t("MENU_CUT"))
				.setIcon('scissors')
				.onClick(async () => {
					await this.clipboardHandler.cutImageAndLink(event);
				});
		});
	}

	/**
	 * Adds the "Copy image" menu item.
	 */
	addCopyImageMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item) =>
			item
				.setTitle(t("MENU_COPY_IMAGE"))
				.setIcon('copy')
				.onClick(async () => {
					await this.clipboardHandler.copyImage(event);
				})
		);
	}

	/**
	 * Adds the "Copy as Base64 encoded image" menu item.
	 */
	addCopyBase64ImageMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item) =>
			item
				.setTitle(t("MENU_COPY_BASE64"))
				.setIcon('copy')
				.onClick(() => {
					this.clipboardHandler.copyImageAsBase64(event);
				})
		);
	}

	/**
	 * Adds the "Convert/Compress" menu item.
	 */
	addProcessImageMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		menu.addItem((item) => {
			item.setTitle(t("MENU_CONVERT_COMPRESS"))
				.setIcon("cog")
				.onClick(async () => {
					await this.processingHandler.processImage(img);
				});
		});
	}

	/**
	 * Adds the "Crop/Rotate/Flip" menu item.
	 */
	addCropRotateFlipMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_CROP_FLIP"))
				.setIcon('scissors')
				.onClick(async () => {
					await this.processingHandler.cropRotateFlip(img);
				});
		});
	}

	/**
	 * Adds the "Annotate" menu item.
	 */
	addAnnotateImageMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_ANNOTATE"))
				.setIcon('pencil')
				.onClick(async () => {
					await this.processingHandler.annotateImage(img);
				});
		});
	}

	/**
	 * Adds the "Show in navigation" menu item.
	 */
	addShowInNavigationMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_SHOW_NAV"))
				.setIcon('folder-open')
				.onClick(async () => {
					await this.navigationHandler.showImageInNavigation(img);
				});
		});
	}

	/**
	 * Adds the "Show in system explorer" menu item.
	 */
	addShowInSystemExplorerMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_SHOW_EXPLORER"))
				.setIcon('arrow-up-right')
				.onClick(async () => {
					await this.navigationHandler.showImageInSystemExplorer(img);
				});
		});
	}

	/**
	 * Adds the "Upload to Cloud" menu item for local images.
	 */
	addUploadToCloudMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		const src = img.getAttribute('src');
		if (!src) return;

		// Only show for local images (not network URLs)
		if (src.startsWith('http://') || src.startsWith('https://')) {
			return;
		}

		menu.addItem((item) => {
			item.setTitle(t("MENU_UPLOAD_CLOUD"))
				.setIcon('cloud-upload')
				.onClick(async () => {
					await this.uploadDownloadHandler.uploadImageToCloud(img);
				});
		});
	}

	/**
	 * Add "Download Network Image" menu item for network images.
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
					await this.uploadDownloadHandler.downloadNetworkImage(img);
				});
		});
	}

	/**
	 * Adds the "Delete Image and Link" menu item.
	 */
	addDeleteImageAndLinkMenuItem(menu: Menu, event: MouseEvent) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_DELETE_LINK"))
				.setIcon('trash')
				.onClick(async () => {
					await this.deleteHandler.deleteImageAndLink(event);
				});
		});
	}

	/*-----------------------------------------------------------------*/
	/*                          CLEANUP                                */
	/*-----------------------------------------------------------------*/

	onunload() {
		// Clean up handlers that extend Component
		this.clipboardHandler?.onunload();
		this.renameInputBuilder?.onunload();
	}
}
