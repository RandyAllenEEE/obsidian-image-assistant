import { BatchTask, BatchItemResult, BatchResult, BatchMode, BatchTaskDiscoveryResult } from "../../../../types/BatchTypes";

export interface ReviewAction {
    id: string;
    label: string;
    style?: 'primary' | 'danger' | 'default';
}

export interface IBatchMode {
    id: BatchMode;
    name: string;

    /**
     * Render mode-specific settings into the container
     */
    renderSettings(container: HTMLElement): void;

    /**
     * Load tasks relevant to this mode from the target scope
     */
    loadTasks(): Promise<BatchTaskDiscoveryResult>;

    /** Resolve any execution-wide choices before workers start. */
    prepareExecution?(tasks: BatchTask[]): Promise<boolean>;

    /**
     * Process a single task
     */
    processTask(task: BatchTask): Promise<BatchItemResult>;

    /**
     * Get available actions for the review stage
     */
    getReviewActions(): ReviewAction[];

    /**
     * Return false when the user rejects a destructive confirmation. The
     * review modal remains open so its result details stay available.
     */
    handleReviewAction(action: string, result: BatchResult): Promise<boolean | void>;

    /** Release transient resources retained for a completed item, such as undo backups. */
    disposeItemResult?(result: BatchItemResult): void;
}
