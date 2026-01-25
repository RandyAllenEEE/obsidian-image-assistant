import { TFile } from 'obsidian';

/**
 * Shared types for unified batch processing.
 */

// ============ Result Types ============

export interface BatchItemResult<T> {
    success: boolean;
    item: T;
    result?: any;
    error?: string;
}

export interface BatchResult<T> {
    successful: BatchItemResult<T>[];
    failed: BatchItemResult<T>[];
    skipped: BatchItemResult<T>[];
    cancelled: boolean;
}

// ============ Task Types ============

export interface BatchTask<TInput = TFile> {
    input: TInput;
    name: string;
    execute: () => Promise<{ success: boolean; result?: any; error?: string }>;
}

// ============ Progress Types ============

export interface BatchProgressInfo {
    current: number;
    total: number;
    currentItem: string;
    elapsedMs: number;
    phase: 'collecting' | 'validating' | 'executing' | 'finalizing';
}

export interface BatchProgressCallback {
    onProgress?: (info: BatchProgressInfo) => void;
    onComplete?: (result: BatchResult<any>) => void;
    onError?: (error: Error, item?: any) => void;
    onCancel?: () => void;
}

// ============ Confirm Dialog Types ============

export interface MultiRefItem {
    name: string;
    vaultReferences: number;
    currentNoteReferences: number;
    otherNotesReferences: number;
}

export interface BatchConfirmOptions {
    title: string;
    totalCount: number;
    multiRefItems: MultiRefItem[];
    scopePath: string; // Note path or folder path
    actions: BatchAction[];
    mode: 'local' | 'cloud';
}

export type BatchAction =
    | 'replace-current'      // Replace links in current note only
    | 'replace-all'          // Replace links in all notes
    | 'replace-all-delete'   // Replace all and delete source
    | 'process-only'         // Process/Upload only, no link replacement
    | 'cancel';              // Cancel operation

// ============ Executor Options ============

export interface BatchExecutorOptions {
    concurrency: number;
    continueOnError: boolean;
    collectErrors: boolean;
    showProgress: boolean;
    progressCallback?: BatchProgressCallback;
}

// ============ File Collector Options ============

export interface FileCollectorOptions {
    recursive: boolean;
    skipFormats: string[];
    skipAlreadyProcessed: boolean;
    validateExists: boolean;
    filterCallback?: (file: TFile) => boolean;
}

export interface CollectedFiles {
    files: TFile[];
    skipped: { file: TFile; reason: string }[];
    errors: { path: string; error: string }[];
}
