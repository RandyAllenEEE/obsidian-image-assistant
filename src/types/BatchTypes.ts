import { TFile } from "obsidian";

/**
 * Result of a single file operation in a batch
 */
export interface BatchSuccessItemResult<T = TFile | string, O = unknown> {
    status: "success";
    success: true;
    item: T;
    output?: O;
}

export interface BatchFailedItemResult<T = TFile | string> {
    status: "failed";
    success: false;
    item: T;
    error: string;
    details?: string[];
}

export interface BatchSkippedItemResult<T = TFile | string> {
    status: "skipped";
    success: false;
    skipped: true;
    item: T;
    error?: string;
    details?: string[];
}

export type BatchItemResult<T = TFile | string, O = unknown> =
    | BatchSuccessItemResult<T, O>
    | BatchFailedItemResult<T>
    | BatchSkippedItemResult<T>;

/**
 * Result of a complete batch operation
 */
export interface BatchResult<T = TFile | string, O = unknown> {
    successful: BatchSuccessItemResult<T, O>[];
    failed: BatchFailedItemResult<T>[];
    skipped: BatchSkippedItemResult<T>[];
    cancelled: boolean;
    discovery?: BatchDiscoveryDiagnostics;
}

export interface BatchDiscoveryDiagnostics {
    complete: boolean;
    failedFiles: string[];
    uncertainFiles: string[];
}

export interface BatchTaskDiscoveryResult extends BatchDiscoveryDiagnostics {
    tasks: BatchTask[];
}

export type BatchDownloadConflictPolicy = "single-copy" | "per-target-folder";

/**
 * Defines the scope of the batch operation
 */
export type BatchScope = "note" | "folder" | "vault";

/**
 * Defines the mode of operation
 */
export type BatchMode = "local_process" | "upload" | "download";

/**
 * Represents a task to be processed
 */
export interface BatchTask {
    id: string;
    name: string;
    path: string; // TFile path or URL
    source: unknown; // Mode-specific source, narrowed by the owning batch mode.
    selected: boolean;
    status: 'pending' | 'processing' | 'success' | 'error' | 'skipped';
    message?: string;
}
