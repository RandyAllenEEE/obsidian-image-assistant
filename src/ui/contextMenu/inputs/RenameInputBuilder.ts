import { Menu, Platform, TFile, setIcon, Component } from 'obsidian';
import * as path from 'path';
import { t } from '../../../lang/helpers';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';
import ImageConverterPlugin from '../../../main';
import { ImageState } from '../../ImageStateManager';

export interface RenameInputs {
    nameInput: HTMLInputElement;
    pathInput: HTMLInputElement;
    captionInput: HTMLInputElement;
    widthInput: HTMLInputElement;
    heightInput: HTMLInputElement;
    confirmButton: HTMLDivElement;
    fileNameWithoutExt: string;
    directoryPath: string;
    fileExtension: string;
    obsidianVaultPathForRename: string | undefined;
    file: TFile | File;
    isImageResolvable: boolean;
    getAlignment: () => string;
}

/**
 * Builds UI input fields for rename/move/caption/dimension editing
 */
export class RenameInputBuilder extends Component {
    private readonly stopPropagationHandler = (e: Event) => e.stopPropagation();
    private documentClickHandler: ((e: MouseEvent) => void) | null = null;

    // ... constructor ... (implicit from context)

    constructor(
        private app: any,
        private plugin: ImageConverterPlugin,
        private folderManagement: FolderAndFilenameManagement
    ) {
        super();
    }

    /**
     * Adds input fields for renaming and moving the image to the context menu.
     * @param menu - The Menu object to add the input fields to.
     * @param img - The HTMLImageElement that was right-clicked.
     * @param activeFile - The currently active TFile.
     * @param isNetwork - Whether the image is a network image.
     * @returns RenameInputs object if inputs were created, null if skipped
     */
    buildInputs(menu: Menu, img: HTMLImageElement, activeFile: TFile, isNetwork: boolean = false): RenameInputs | null {
        // ... (lines 46-73: check native menus, resolve basic info) ...
        const isNativeMenus = (this.app.vault as any).getConfig('nativeMenus');

        if (!isNativeMenus && !Platform.isMobile) {
            const imagePath = (this.folderManagement && typeof (this.folderManagement as any).getImagePath === 'function')
                ? (this.folderManagement as any).getImagePath(img)
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

            // Create all input elements
            const { container, inputs } = this.createInputElements(
                isImageResolvable,
                isNetwork,
                fileNameWithoutExt,
                directoryPath,
                img
            );

            // Add to menu
            menu.addItem((item) => {
                const menuItem = item as any;

                // Register event listeners
                [inputs.nameInput, inputs.pathInput, inputs.captionInput, inputs.widthInput, inputs.heightInput].forEach(input => {
                    this.registerDomEvent(input, 'mousedown', this.stopPropagationHandler);
                    this.registerDomEvent(input, 'click', this.stopPropagationHandler);
                    this.registerDomEvent(input, 'keydown', this.stopPropagationHandler);
                });

                this.registerDomEvent(document, 'click', this.documentClickHandler!);

                // Clear and set the menu item content
                const maybeDom: any = (menuItem as any).dom;
                if (maybeDom && typeof maybeDom.appendChild === 'function') {
                    if (typeof maybeDom.empty === 'function') {
                        maybeDom.empty();
                    } else {
                        try { maybeDom.innerHTML = ''; } catch (e) { void e; }
                    }
                    maybeDom.appendChild(container);
                } else {
                    (menuItem as any).setTitle?.(t("MENU_IMAGE_TOOLS"));
                }
            });

            return {
                ...inputs,
                fileNameWithoutExt,
                directoryPath,
                fileExtension,
                obsidianVaultPathForRename,
                file: file!,
                isImageResolvable
            };
        }

        return null;
    }

    private createInputElements(
        isImageResolvable: boolean,
        isNetwork: boolean,
        fileNameWithoutExt: string,
        directoryPath: string,
        img: HTMLImageElement
    ) {
        // ... (lines 131-253: name, path, caption, dimensions setup) ...
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
        dimensionInputsContainer.appendChild(document.createTextNode('×'));
        dimensionInputsContainer.appendChild(heightInput);

        dimensionsGroup.appendChild(dimensionInputsContainer);

        // Load dimensions via StateManager
        const currentStateSize = this.plugin.imageStateManager?.getImageState(img);
        if (currentStateSize) {
            widthInput.value = currentStateSize.width?.toString() || "";
            heightInput.value = currentStateSize.height?.toString() || "";
        }

        // --- NEW: Create Alignment Control ---
        const { group: alignmentGroup, getAlignment } = this.createAlignmentControl(img);

        // Add all groups to container
        if (!isNetwork) {
            inputContainer.appendChild(nameGroup);
            inputContainer.appendChild(pathGroup);
        }
        inputContainer.appendChild(captionGroup);
        inputContainer.appendChild(dimensionsGroup);
        inputContainer.appendChild(alignmentGroup); // Add alignment group

        // Add single confirm button
        const confirmButton = document.createElement('div');
        confirmButton.className = 'image-converter-contextmenu-button image-converter-contextmenu-confirm';
        setIcon(confirmButton, 'check');
        inputContainer.appendChild(confirmButton);

        // Load caption via StateManager
        const currentState = this.plugin.imageStateManager?.getImageState(img);
        if (currentState) {
            captionInput.value = currentState.caption || "";
        }
        captionInput.placeholder = t("PLACEHOLDER_CAPTION");

        return {
            container: inputContainer,
            inputs: {
                nameInput,
                pathInput,
                captionInput,
                widthInput,
                heightInput,
                confirmButton,
                getAlignment
            },
            isImageResolvable // Ensure this is returned at the top level of RenameInputs
        };
    }

    private createAlignmentControl(img: HTMLImageElement): { group: HTMLElement, getAlignment: () => string } {
        const group = document.createElement('div');
        group.className = 'image-converter-contextmenu-input-group image-converter-alignment-group';

        // Icon for label
        const icon = document.createElement('div');
        icon.className = 'image-converter-contextmenu-icon-container';
        setIcon(icon, 'align-center');
        group.appendChild(icon);

        // Label
        const label = document.createElement('label');
        label.textContent = t("LABEL_ALIGNMENT");
        group.appendChild(label);

        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'image-converter-alignment-buttons';

        const alignOptions = [
            { id: 'left', icon: 'align-left', title: t("ALIGN_LEFT") },
            { id: 'left-wrap', icon: 'wrap-text', title: t("ALIGN_LEFT") + ' (Wrap)' },
            { id: 'center', icon: 'align-center', title: t("ALIGN_CENTER") },
            { id: 'right-wrap', icon: 'wrap-text', title: t("ALIGN_RIGHT") + ' (Wrap)' },
            { id: 'right', icon: 'align-right', title: t("ALIGN_RIGHT") },
        ];

        // Get current alignment
        let currentAlign = this.plugin.imageStateManager?.getImageState(img)?.align || 'none';

        const buttons: HTMLElement[] = [];

        alignOptions.forEach(opt => {
            const btn = document.createElement('div');
            btn.className = `image-converter-alignment-button ${currentAlign === opt.id ? 'active' : ''}`;
            btn.title = opt.title;
            setIcon(btn, opt.icon);

            // Click Handler
            btn.addEventListener('click', (e) => {
                e.stopPropagation();

                // Toggle Logic
                if (currentAlign === opt.id) {
                    // Deselect if already selected
                    currentAlign = 'none';
                    btn.classList.remove('active');
                } else {
                    // Select new option
                    currentAlign = opt.id as ImageState['align'];
                    buttons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
            });

            buttons.push(btn);
            buttonsContainer.appendChild(btn);
        });

        group.appendChild(buttonsContainer);

        return {
            group,
            getAlignment: () => currentAlign
        };
    }
}
