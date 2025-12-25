import { TFile } from "obsidian";

/**
 * Result of a single file operation in a batch
 */
export interface BatchItemResult {
    success: boolean;
    item: TFile | string; // TFile for local/upload, URL string for download
    error?: string;
    output?: any; // e.g. Cloud URL, Local Path
}

/**
 * Result of a complete batch operation
 */
export interface BatchResult {
    successful: BatchItemResult[];
    failed: BatchItemResult[];
    cancelled: boolean;
}

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
    source: any; // TFile or original URL string
    selected: boolean;
    status: 'pending' | 'processing' | 'success' | 'error';
    message?: string;
}
