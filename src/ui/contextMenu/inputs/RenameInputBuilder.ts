import {
    App,
    Component,
    Modal,
    Notice,
    setIcon
} from "obsidian";
import { t } from "../../../lang/helpers";
import type ImageConverterPlugin from "../../../main";
import type { AlignType } from "../../../utils/PipeSyntaxParser";
import type {
    ImageContextMenuContext,
    ImagePropertiesFormModel,
    ImagePropertyChanges,
    ImagePropertyUpdateResult
} from "../types";
import { OperationResultModal } from "../../modals/OperationResultModal";
import { inspectDrawingFile, stripDrawingCompoundSuffix } from "../../../drawing/DrawingFileSemantics";

type ApplyProperties = (
    changes: ImagePropertyChanges
) => Promise<ImagePropertyUpdateResult>;

let nextFormId = 0;

/** Opens the shared image-properties form in a lifecycle-managed modal. */
export class RenameInputBuilder extends Component {
    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin
    ) {
        super();
    }

    openModal(
        context: ImageContextMenuContext,
        onApply: ApplyProperties
    ): void {
        new ImagePropertiesModal(
            this.app,
            context.ownerDocument,
            this.createModel(context),
            onApply
        ).open();
    }

    createModel(context: ImageContextMenuContext): ImagePropertiesFormModel {
        if (context.sourceKind !== "local" && context.sourceKind !== "url") {
            throw new Error("Image properties require a local or URL source.");
        }
        const state = context.image
            ? this.plugin.imageStateManager?.getImageState(context.image)
            : null;
        const pipeData = context.descriptor?.pipeData;
        const file = context.localFile;
        const drawing = file ? inspectDrawingFile(this.plugin, file) : null;
        return Object.freeze({
            sourceKind: context.sourceKind,
            fileName: file
                ? drawing
                    ? stripDrawingCompoundSuffix(file.name, drawing)
                    : file.basename
                : "",
            directory: file?.parent?.path || "/",
            caption: state?.caption
                ?? pipeData?.alt?.replace(/\\\|/g, "|").trim()
                ?? "",
            width: state?.width ?? pipeData?.size?.width ?? null,
            height: state?.height ?? pipeData?.size?.height ?? null,
            alignment: (state?.align === "none"
                ? null
                : state?.align ?? pipeData?.align ?? null) as AlignType
        });
    }
}

class ImagePropertiesModal extends Modal {
    private applying = false;
    private formScope: Component | null = null;

    constructor(
        app: App,
        private readonly ownerDocument: Document,
        private readonly model: ImagePropertiesFormModel,
        private readonly onApply: ApplyProperties
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText(t("MENU_EDIT_IMAGE_PROPERTIES"));
        this.contentEl.empty();
        this.formScope?.unload();
        this.formScope = new Component();
        this.formScope.load();
        const form = createPropertiesForm(
            this.contentEl.ownerDocument ?? this.ownerDocument,
            this.model,
            this.formScope
        );
        this.contentEl.appendChild(form.container);
        this.formScope.registerDomEvent(form.confirmButton, "click", () => {
            if (this.applying) return;
            const changes = form.getChanges();
            if (!changes) return;
            this.applying = true;
            form.confirmButton.disabled = true;
            void this.onApply(changes).then(result => {
                showPropertyResult(this.app, result);
                if (result.complete || result.fileMoved) this.close();
            }).finally(() => {
                this.applying = false;
                form.confirmButton.disabled = false;
            });
        });
    }

    onClose(): void {
        this.formScope?.unload();
        this.formScope = null;
        this.contentEl.empty();
    }
}

function createPropertiesForm(
    ownerDocument: Document,
    model: ImagePropertiesFormModel,
    scope: Component
): {
    container: HTMLElement;
    confirmButton: HTMLButtonElement;
    getChanges(): ImagePropertyChanges | null;
} {
    const formId = `image-assistant-properties-${nextFormId++}`;
    const container = ownerDocument.createElement("div");
    container.className = "image-converter-contextmenu-info-container";
    const controls: Array<HTMLInputElement | HTMLButtonElement> = [];

    const nameInput = createTextInput(
        ownerDocument,
        container,
        "file-text",
        t("LABEL_NAME"),
        `${formId}-name`,
        model.fileName,
        t("PLACEHOLDER_NAME"),
        "image-converter-contextmenu-name-input"
    );
    const pathInput = createTextInput(
        ownerDocument,
        container,
        "folder",
        t("LABEL_FOLDER_CONTEXT"),
        `${formId}-path`,
        model.directory,
        t("PLACEHOLDER_PATH"),
        "image-converter-contextmenu-path-input"
    );
    if (model.sourceKind === "url") {
        nameInput.group.remove();
        pathInput.group.remove();
    } else {
        controls.push(nameInput.input, pathInput.input);
    }

    const captionInput = createTextInput(
        ownerDocument,
        container,
        "subtitles",
        t("LABEL_CAPTION"),
        `${formId}-caption`,
        model.caption,
        t("PLACEHOLDER_CAPTION"),
        "image-converter-contextmenu-caption-input"
    );
    controls.push(captionInput.input);

    const dimensionGroup = createGroup(
        ownerDocument,
        "aspect-ratio",
        t("LABEL_SIZE"),
        `${formId}-width`
    );
    const dimensionInputs = ownerDocument.createElement("div");
    dimensionInputs.className = "image-converter-contextmenu-dimension-inputs";
    const widthInput = createNumberInput(
        ownerDocument,
        `${formId}-width`,
        model.width,
        t("PLACEHOLDER_WIDTH")
    );
    const heightInput = createNumberInput(
        ownerDocument,
        `${formId}-height`,
        model.height,
        t("PLACEHOLDER_HEIGHT")
    );
    dimensionInputs.append(
        widthInput,
        ownerDocument.createTextNode("x"),
        heightInput
    );
    dimensionGroup.appendChild(dimensionInputs);
    container.appendChild(dimensionGroup);
    controls.push(widthInput, heightInput);

    const alignment = createAlignmentControl(
        ownerDocument,
        model.alignment,
        scope
    );
    container.appendChild(alignment.group);

    const confirmButton = ownerDocument.createElement("button");
    confirmButton.type = "button";
    confirmButton.className =
        "image-converter-contextmenu-button image-converter-contextmenu-confirm";
    confirmButton.title = t("BUTTON_APPLY");
    confirmButton.setAttribute("aria-label", t("BUTTON_APPLY"));
    setIcon(confirmButton, "check");
    container.appendChild(confirmButton);
    controls.push(confirmButton);

    for (const control of controls) {
        for (const eventName of ["mousedown", "click", "keydown"] as const) {
            scope.registerDomEvent(control, eventName, event => {
                event.stopPropagation();
            });
        }
    }

    return {
        container,
        confirmButton,
        getChanges: () => {
            const width = readPositiveInteger(widthInput);
            const height = readPositiveInteger(heightInput);
            if (width === undefined || height === undefined) {
                new Notice(t("MSG_DIMENSIONS_POSITIVE"));
                return null;
            }
            return {
                ...(model.sourceKind === "local"
                    ? {
                        fileName: nameInput.input.value,
                        directory: pathInput.input.value
                    }
                    : {}),
                caption: captionInput.input.value.trim(),
                width,
                height,
                alignment: alignment.getAlignment()
            };
        }
    };
}

function createTextInput(
    ownerDocument: Document,
    container: HTMLElement,
    iconName: string,
    labelText: string,
    id: string,
    value: string,
    placeholder: string,
    className: string
): { group: HTMLElement; input: HTMLInputElement } {
    const group = createGroup(ownerDocument, iconName, labelText, id);
    const input = ownerDocument.createElement("input");
    input.type = "text";
    input.id = id;
    input.value = value;
    input.placeholder = placeholder;
    input.className = className;
    group.appendChild(input);
    container.appendChild(group);
    return { group, input };
}

function createGroup(
    ownerDocument: Document,
    iconName: string,
    labelText: string,
    inputId?: string
): HTMLElement {
    const group = ownerDocument.createElement("div");
    group.className = "image-converter-contextmenu-input-group";
    const icon = ownerDocument.createElement("div");
    icon.className = "image-converter-contextmenu-icon-container";
    setIcon(icon, iconName);
    group.appendChild(icon);
    const label = ownerDocument.createElement("label");
    label.textContent = labelText;
    if (inputId) label.htmlFor = inputId;
    group.appendChild(label);
    return group;
}

function createNumberInput(
    ownerDocument: Document,
    id: string,
    value: number | null,
    placeholder: string
): HTMLInputElement {
    const input = ownerDocument.createElement("input");
    input.type = "number";
    input.min = "1";
    input.id = id;
    input.value = value?.toString() ?? "";
    input.placeholder = placeholder;
    input.className = "image-converter-contextmenu-dimension-input";
    return input;
}

function createAlignmentControl(
    ownerDocument: Document,
    initial: AlignType,
    scope: Component
): { group: HTMLElement; getAlignment(): AlignType } {
    const group = createGroup(
        ownerDocument,
        "align-center",
        t("LABEL_ALIGNMENT")
    );
    group.classList.add("image-converter-alignment-group");
    const buttonContainer = ownerDocument.createElement("div");
    buttonContainer.className = "image-converter-alignment-buttons";
    let alignment = initial;
    const buttons: HTMLElement[] = [];
    const options: Array<{ id: Exclude<AlignType, null>; icon: string; title: string }> = [
        { id: "left", icon: "align-left", title: t("ALIGN_LEFT") },
        { id: "left-wrap", icon: "wrap-text", title: t("ALIGN_LEFT_WRAP") },
        { id: "center", icon: "align-center", title: t("ALIGN_CENTER") },
        { id: "right-wrap", icon: "wrap-text", title: t("ALIGN_RIGHT_WRAP") },
        { id: "right", icon: "align-right", title: t("ALIGN_RIGHT") }
    ];
    for (const option of options) {
        const button = ownerDocument.createElement("button");
        button.type = "button";
        button.className = "image-converter-alignment-button";
        button.classList.toggle("active", alignment === option.id);
        button.title = option.title;
        button.setAttribute("aria-label", option.title);
        setIcon(button, option.icon);
        scope.registerDomEvent(button, "click", event => {
            event.preventDefault();
            event.stopPropagation();
            alignment = alignment === option.id ? null : option.id;
            for (const candidate of buttons) {
                candidate.classList.toggle(
                    "active",
                    candidate === button && alignment === option.id
                );
            }
        });
        buttons.push(button);
        buttonContainer.appendChild(button);
    }
    group.appendChild(buttonContainer);
    return { group, getAlignment: () => alignment };
}

function readPositiveInteger(input: HTMLInputElement): number | null | undefined {
    const value = input.value.trim();
    if (!value) return null;
    if (!/^\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function showPropertyResult(
    app: App,
    result: ImagePropertyUpdateResult
): void {
    if (result.complete) {
        new Notice(t("MSG_CAPTION_UPDATED"));
        return;
    }
    if (result.fileMoved) {
        new OperationResultModal(app, {
            title: t("MSG_IMAGE_PROPERTIES_MOVED_PARTIAL_TITLE"),
            summary: t("MSG_IMAGE_PROPERTIES_MOVED_PARTIAL_SUMMARY", [
                result.targetPath ?? t("MSG_UNKNOWN_ERROR"),
                result.compatibilityCopyPreserved
                    ? t("MSG_IMAGE_PROPERTIES_COMPAT_PRESERVED")
                    : t("MSG_IMAGE_PROPERTIES_COMPAT_NOT_NEEDED")
            ]),
            successful: [
                t("MSG_IMAGE_PROPERTIES_FILE_MOVED", [
                    result.targetPath ?? ""
                ]),
                ...(result.repairedReferences
                    ? [t("MSG_IMAGE_PROPERTIES_REFERENCES_REPAIRED", [
                        result.repairedReferences
                    ])]
                    : [])
            ],
            failed: [
                ...(result.error ? [result.error] : []),
                ...(result.failedFiles ?? [])
            ],
            uncertain: [...(result.uncertainFiles ?? [])]
        }).open();
        return;
    }
    if (result.linkUpdated) {
        new Notice(t("MSG_IMAGE_PROPERTIES_PARTIAL", [
            result.error ?? t("MSG_UNKNOWN_ERROR")
        ]));
        return;
    }
    new Notice(t("MSG_IMAGE_PROPERTIES_FAILED", [
        result.error ?? t("MSG_UNKNOWN_ERROR")
    ]));
}
