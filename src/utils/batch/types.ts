import { TFile } from 'obsidian';
export type { BatchItemResult, BatchResult } from '../../types/BatchTypes';

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
