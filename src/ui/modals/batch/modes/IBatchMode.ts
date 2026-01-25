import { BatchTask, BatchItemResult, BatchResult, BatchMode } from "../../../../types/BatchTypes";

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
    loadTasks(): Promise<BatchTask[]>;

    /**
     * Process a single task
     */
    processTask(task: BatchTask): Promise<BatchItemResult>;

    /**
     * Get available actions for the review stage
     */
    getReviewActions(): ReviewAction[];

    /**
     * Handle a triggering of a review action
     */
    handleReviewAction(action: string, result: BatchResult): Promise<void>;
}
