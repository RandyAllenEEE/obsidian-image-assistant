import type { TFile } from "obsidian";

export const DRAWING_VIEW_TYPE = "image-assistant-drawing-view";

export type DiagramExportFormat = "xml" | "xmlsvg" | "svg" | "png";

export interface DiagramRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface DiagramViewMetadata {
    readonly currentPage: number | null;
    readonly bounds: DiagramRect | null;
    readonly scale: number | null;
}

export interface DiagramExportOptions {
    /** Restricts rendered exports to the page that is active in Draw.io. */
    readonly currentPage?: boolean;
}

export interface DiagramExportResult {
    readonly data: string;
    readonly metadata: DiagramViewMetadata;
}

export interface DrawingAiAttachment {
    readonly id: string;
    readonly kind: "image" | "pdf" | "text" | "url" | "canvas";
    readonly name: string;
    readonly mediaType: string;
    readonly size: number;
    readonly dataUrl?: string;
    readonly extractedText?: string;
    readonly sourceUrl?: string;
}

export interface DrawingAiUserInput {
    readonly text: string;
    readonly attachments: readonly DrawingAiAttachment[];
}

export interface DiagramEditorPort {
    mount(container: HTMLElement): Promise<void>;
    load(source: string): Promise<DiagramViewMetadata>;
    export(format: DiagramExportFormat, options?: DiagramExportOptions): Promise<DiagramExportResult>;
    getViewMetadata(): DiagramViewMetadata;
    onDirty(listener: (xml: string, metadata: DiagramViewMetadata) => void): () => void;
    destroy(): void;
}

export interface DrawioEditorProviderAdapter {
    readonly id: "drawio";
    supports(file: TFile): boolean;
    createEditor(ownerDocument?: Document): DiagramEditorPort;
    getAppearanceKey?(ownerDocument?: Document): string;
}

export interface DrawingAiAssistant {
    send(input: DrawingAiUserInput): Promise<void>;
    retry(): Promise<void>;
    stop(): void;
    clear(): void;
    destroy(): void;
}
