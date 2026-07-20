import type { TFile } from "obsidian";
import type { ImageSourceDescriptor } from "../../utils/MarkdownSourceContext";
import type { AlignType } from "../../utils/PipeSyntaxParser";
import type {
	ImageViewContext,
	ImageViewOwnerContext
} from "./utils/ImageViewContextResolver";

export interface ImageMatch {
	lineNumber: number;
	line: string;
	fullMatch: string;
	index: number;
}

export type ImageContextMenuSourceKind =
	| "local"
	| "url"
	| "data"
	| "blob"
	| "unresolved";

export type ImageContextResolution = "resolved" | "pending" | "unresolved";

export type OfficialImageMenuHint =
	| { readonly kind: "editor" }
	| { readonly kind: "file" }
	| { readonly kind: "url"; readonly url: string };

export interface PendingImageMenuSeed {
	readonly context: ImageContextMenuContext;
	readonly createdAt: number;
	readonly generation: number;
}

export interface ImageDataReferenceContext {
	readonly owner: ImageViewOwnerContext;
	readonly match: ImageMatch;
}

export interface ImageContextMenuContext {
	readonly image: HTMLImageElement;
	readonly ownerDocument: Document;
	readonly ownerWindow: Window | null;
	readonly renderedSrc: string;
	readonly sourceKind: ImageContextMenuSourceKind;
	readonly resolution: ImageContextResolution;
	readonly owner: ImageViewOwnerContext | null;
	readonly viewContext: ImageViewContext | null;
	readonly descriptor: ImageSourceDescriptor | null;
	readonly localFile: TFile | null;
	readonly url: string | null;
	readonly dataReference: ImageDataReferenceContext | null;
}

export type ImageContextMenuItemId =
	| "properties"
	| "open"
	| "cut"
	| "copy"
	| "copy-base64"
	| "process"
	| "crop"
	| "annotate"
	| "upload"
	| "download"
	| "delete"
	| "show-navigation"
	| "show-explorer";

export type ImageContextMenuGroupId =
	| "properties"
	| "clipboard"
	| "processing"
	| "delete"
	| "navigation";

export interface ImageContextMenuGroup {
	readonly id: ImageContextMenuGroupId;
	readonly items: readonly ImageContextMenuItemId[];
}

export interface ImageContextMenuCapabilities {
	readonly properties: boolean;
	readonly open: boolean;
	readonly cut: boolean;
	readonly copy: boolean;
	readonly copyBase64: boolean;
	readonly process: boolean;
	readonly crop: boolean;
	readonly annotate: boolean;
	readonly upload: boolean;
	readonly download: boolean;
	readonly delete: boolean;
	readonly showNavigation: boolean;
	readonly showExplorer: boolean;
}

export interface ImagePropertiesFormModel {
	readonly sourceKind: Extract<ImageContextMenuSourceKind, "local" | "url">;
	readonly fileName: string;
	readonly directory: string;
	readonly caption: string;
	readonly width: number | null;
	readonly height: number | null;
	readonly alignment: AlignType;
}

export interface ImagePropertyChanges {
	readonly fileName?: string;
	readonly directory?: string;
	readonly caption: string;
	readonly width: number | null;
	readonly height: number | null;
	readonly alignment: AlignType;
}

export interface ImagePropertyUpdateResult {
	readonly complete: boolean;
	readonly linkUpdated: boolean;
	readonly fileMoved: boolean;
	readonly sourcePath?: string;
	readonly targetPath?: string;
	readonly compatibilityCopyPreserved?: boolean;
	readonly repairedReferences?: number;
	readonly failedFiles?: readonly string[];
	readonly uncertainFiles?: readonly string[];
	readonly error?: string;
}
