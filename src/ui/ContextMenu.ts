import {
	Menu,
	TFile,
	Platform,
	Component,
	App,
	MarkdownView,
	Notice,
	View,
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
import { ImageViewContextResolver } from './contextMenu/utils/ImageViewContextResolver';
import { isHttpUrl } from '../utils/NetworkPolicy';
import { getErrorMessage } from '../utils/ErrorUtils';

// Import input builders
import { RenameInputBuilder } from './contextMenu/inputs/RenameInputBuilder';

export class ContextMenu extends Component {
	private contextMenuRegistered = false;
	private currentMenu: Menu | null = null;
	private cloudDeleter: CloudImageDeleter;
	private contextMenuDocumentScopes = new Map<Document, Component>();

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
	private imageViewContextResolver: ImageViewContextResolver;

	// Input builders
	private renameInputBuilder: RenameInputBuilder;

	private readonly documentClickHandler = (event: MouseEvent) => {
		const target = event.target;
		if (!(target instanceof Element) && !(target as any)?.instanceOf?.(Element)) {
			this.closeCurrentMenu();
			return;
		}

		const element = target as Element;
		if (!element.closest('.image-converter-contextmenu-info-container') &&
			!element.closest('.menu-item')) {
			this.closeCurrentMenu();
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
		this.imageViewContextResolver = new ImageViewContextResolver(app);

		// Initialize handlers
		this.deleteHandler = new DeleteHandler(
			app,
			plugin,
			folderAndFilenameManagement,
			this.imageMatchFinder,
			this.linkRemover,
			this.cloudDeleter,
			this.imageViewContextResolver
		);

		this.uploadDownloadHandler = new UploadDownloadHandler(
			app,
			plugin,
			folderAndFilenameManagement,
			this.imageViewContextResolver
		);

		this.clipboardHandler = new ClipboardHandler(
			app,
			folderAndFilenameManagement,
			this.imageMatchFinder,
			this.linkRemover,
			this.imageViewContextResolver
		);

		this.processingHandler = new ProcessingHandler(
			app,
			plugin,
			folderAndFilenameManagement
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

	private closeCurrentMenu(): void {
		const menu = this.currentMenu;
		if (!menu) return;

		this.currentMenu = null;
		menu.hide?.();
	}

	private registerContextMenuListenerForDocument(ownerDocument: Document): void {
		if (this.contextMenuDocumentScopes.has(ownerDocument)) {
			return;
		}

		const scope = this.addChild(new Component());
		scope.registerDomEvent(
			ownerDocument,
			'contextmenu',
			this.handleContextMenuEvent,
			true
		);
		scope.registerDomEvent(
			ownerDocument,
			'click',
			this.documentClickHandler
		);
		this.contextMenuDocumentScopes.set(ownerDocument, scope);
	}

	private unregisterContextMenuListenerForDocument(ownerDocument: Document): void {
		const scope = this.contextMenuDocumentScopes.get(ownerDocument);
		if (!scope) return;

		this.contextMenuDocumentScopes.delete(ownerDocument);
		this.removeChild(scope);
	}

	private registerContextMenuListenersForWorkspaceDocuments(): void {
		this.registerContextMenuListenerForDocument(document);

		const workspaceDocument = this.app.workspace.containerEl?.ownerDocument;
		if (workspaceDocument) {
			this.registerContextMenuListenerForDocument(workspaceDocument);
		}

		this.app.workspace.iterateAllLeaves?.((leaf) => {
			const leafDocument = leaf.view?.containerEl?.ownerDocument;
			if (leafDocument) {
				this.registerContextMenuListenerForDocument(leafDocument);
			}
		});
	}

	/**
	 * Registers context menu listeners on every known Obsidian document.
	 */
	registerContextMenuListener() {
		if (this.contextMenuRegistered) {
			return;
		}

		this.registerContextMenuListenersForWorkspaceDocuments();
		this.registerEvent(
			this.app.workspace.on('window-open' as any, (_workspaceWindow: unknown, win: Window) => {
				if (win?.document) {
					this.registerContextMenuListenerForDocument(win.document);
				}
			})
		);
		this.registerEvent(
			this.app.workspace.on('window-close' as any, (_workspaceWindow: unknown, win: Window) => {
				if (win?.document) {
					this.unregisterContextMenuListenerForDocument(win.document);
				}
			})
		);
		this.contextMenuRegistered = true;
	}

	private isElement(target: EventTarget | null): target is HTMLElement {
		return !!target && (
			target instanceof HTMLElement ||
			typeof (target as any).instanceOf === 'function' && (target as any).instanceOf(HTMLElement)
		);
	}

	private isImageElement(target: Element | null): target is HTMLImageElement {
		return !!target && (
			target instanceof HTMLImageElement ||
			typeof (target as any).instanceOf === 'function' && (target as any).instanceOf(HTMLImageElement)
		);
	}

	private resolveImageFromTarget(target: HTMLElement): HTMLImageElement | null {
		if (this.isImageElement(target)) {
			return target;
		}

		const directImage = target.closest('img');
		if (this.isImageElement(directImage)) {
			return directImage;
		}

		const wrapper = target.closest('.image-wrapper, .image-embed, .image-resize-container');
		if (!wrapper) {
			return null;
		}

		const image = wrapper.querySelector('.image-resize-container img, img');
		return this.isImageElement(image) ? image : null;
	}

	/**
	 * Handles the context menu event.
	 * This function is called when the context menu is triggered on an image.
	 * @param event - The MouseEvent object.
	 */
	handleContextMenuEvent = (event: MouseEvent) => {
		if (event.defaultPrevented) {
			return;
		}

		if (!this.isElement(event.target)) {
			return;
		}

		const target = event.target;
		const img = this.resolveImageFromTarget(target);
		if (!img) {
			return;
		}

		// Skip Excalidraw images
		if (this.plugin.supportedImageFormats.isExcalidrawImage(img)) {
			return;
		}

		const ownerContext = this.imageViewContextResolver.resolveOwner(img);
		const activeView = this.app.workspace.getActiveViewOfType(View);
		if (activeView?.getViewType() === 'canvas' && !ownerContext) {
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

		this.closeCurrentMenu();
		const menu = new Menu();
		this.currentMenu = menu;
		(menu as any).onHide?.(() => {
			if (this.currentMenu === menu) {
				this.currentMenu = null;
			}
		});
		let activeFile = ownerContext?.file
			?? this.app.workspace.getActiveFile();
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
			let applying = false;
			inputs.confirmButton.addEventListener('click', () => {
				if (applying) return;
				applying = true;
				inputs.confirmButton.disabled = true;

				void (async () => {
					if (inputs.isImageResolvable && !isNetwork) {
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

					if (inputs.isImageResolvable || isNetwork) {
						await this.renameHandler.handleDimensionsAndCaptionUpdate(
							menu,
							inputs.captionInput,
							inputs.widthInput,
							inputs.heightInput,
							inputs.getAlignment(),
							img,
							activeFile,
							inputs.isImageResolvable || isNetwork
						);
					}
				})().catch(error => {
					console.error("Failed to apply image menu changes:", error);
					new Notice(getErrorMessage(error));
				}).finally(() => {
					applying = false;
					inputs.confirmButton.disabled = false;
				});
			});
		}


		// 2. MIDDLE SECTION: Tools & Management (Consolidated)
		// =========================================================

		if (!Platform.isMobile) {
			this.addOpenInNewWindowMenuItem(menu, img);
			menu.addSeparator();

			// Start of Consolidated Tool Block (No internal separators)
			this.addCutImageMenuItem(menu, img, event);
			this.addCutAllImageLinksMenuItem(menu, img);
		} else {
			// Mobile start of tool block
		}

		// Hide Copy operations for network images (CORS issues)
		if (!isNetwork) {
			this.addCopyImageMenuItem(menu, img, event);
			this.addCopyBase64ImageMenuItem(menu, img, event);
		}

		// Network images: only show download option
		// Local images: show all processing options and upload
		if (isNetwork) {
			this.addDownloadNetworkImageMenuItem(menu, img, event);
		} else {
			this.addProcessImageMenuItem(menu, img, event);
			if (this.processingHandler.canEditImage(img)) {
				this.addCropRotateFlipMenuItem(menu, img);
				this.addAnnotateImageMenuItem(menu, img);
			}
			this.addUploadToCloudMenuItem(menu, img, event);
		}

		// Delete option (Moved to Middle Section, end of tool block)
		this.addDeleteImageAndLinkMenuItem(menu, img, event);
		this.addDeleteAllImageLinksMenuItem(menu, img, event);

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
	addCutImageMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		menu.addItem((item) => {
			item.setTitle(t("MENU_CUT"))
				.setIcon('scissors')
				.onClick(async () => {
					await this.clipboardHandler.cutImageAndLink(event, img);
				});
		});
	}

	addCutAllImageLinksMenuItem(menu: Menu, img: HTMLImageElement) {
		menu.addItem((item) => {
			item.setTitle(t("MENU_CUT_ALL_MATCHES"))
				.setIcon('copy-minus')
				.onClick(async () => {
					await this.clipboardHandler.cutAllMatchingImageLinks(img);
				});
		});
	}

	/**
	 * Adds the "Copy image" menu item.
	 */
	addCopyImageMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		menu.addItem((item) =>
			item
				.setTitle(t("MENU_COPY_IMAGE"))
				.setIcon('copy')
				.onClick(async () => {
					await this.clipboardHandler.copyImage(event, img);
				})
		);
	}

	/**
	 * Adds the "Copy as Base64 encoded image" menu item.
	 */
	addCopyBase64ImageMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		menu.addItem((item) =>
			item
				.setTitle(t("MENU_COPY_BASE64"))
				.setIcon('copy')
				.onClick(() => {
					this.clipboardHandler.copyImageAsBase64(event, img);
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
		if (isHttpUrl(src)) {
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
		if (!isHttpUrl(src)) {
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
	addDeleteImageAndLinkMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_DELETE_LINK"))
				.setIcon('trash')
				.onClick(async () => {
					await this.deleteHandler.deleteImageAndLink(event, img);
				});
		});
	}

	addDeleteAllImageLinksMenuItem(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		menu.addItem((item) => {
			item
				.setTitle(t("MENU_DELETE_ALL_MATCHES"))
				.setIcon('trash-2')
				.onClick(async () => {
					await this.deleteHandler.deleteAllMatchingImageLinks(event, img);
				});
		});
	}

	/*-----------------------------------------------------------------*/
	/*                          CLEANUP                                */
	/*-----------------------------------------------------------------*/

	onunload() {
		// Clean up handlers that extend Component
		this.closeCurrentMenu();
		this.clipboardHandler?.onunload();
		this.renameInputBuilder?.onunload();
		this.contextMenuRegistered = false;
		super.onunload();
	}
}
