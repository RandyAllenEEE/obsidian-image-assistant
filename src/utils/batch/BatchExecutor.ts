import { TFile } from 'obsidian';
import { ConcurrentQueue } from '../AsyncLock';
import { NotificationManager } from '../NotificationManager';
import { BatchProgressManager } from './BatchProgressManager';
import {
    BatchResult,
    BatchTask,
    BatchExecutorOptions,
    BatchProgressCallback
} from './types';

/**
 * BatchExecutor - Unified batch execution engine.
 * Handles concurrent execution, error collection, and progress reporting.
 */
export class BatchExecutor<T = TFile> {
    private queue: ConcurrentQueue;
    private notificationManager: NotificationManager;
    private options: BatchExecutorOptions;
    private cancelled: boolean = false;

    constructor(options?: Partial<BatchExecutorOptions>) {
        this.options = {
            concurrency: options?.concurrency || 3,
            continueOnError: options?.continueOnError ?? true,
            collectErrors: options?.collectErrors ?? true,
            showProgress: options?.showProgress ?? true,
            progressCallback: options?.progressCallback
        };

        this.queue = new ConcurrentQueue(this.options.concurrency);
        this.notificationManager = new NotificationManager();
    }

    /**
     * Execute batch tasks with progress tracking.
     */
    async execute(
        tasks: BatchTask<T>[],
        progressManager?: BatchProgressManager
    ): Promise<BatchResult<T>> {
        const result: BatchResult<T> = {
            successful: [],
            failed: [],
            skipped: [],
            cancelled: false
        };

        if (tasks.length === 0) return result;

        this.cancelled = false;
        let processedCount = 0;
        const total = tasks.length;

        progressManager?.setPhase('executing');

        const taskFunctions = tasks.map(task => async () => {
            if (this.cancelled) {
                result.skipped.push({
                    success: false,
                    item: task.input,
                    error: 'Cancelled'
                });
                return;
            }

            try {
                const execResult = await task.execute();
                processedCount++;

                if (execResult.success) {
                    result.successful.push({
                        success: true,
                        item: task.input,
                        result: execResult.result
                    });
                } else {
                    result.failed.push({
                        success: false,
                        item: task.input,
                        error: execResult.error || 'Unknown error'
                    });

                    if (this.options.collectErrors) {
                        this.notificationManager.collectError(
                            task.name,
                            execResult.error || 'Processing failed'
                        );
                    }
                }

                // Update progress
                progressManager?.update(processedCount, total, task.name);
                this.options.progressCallback?.onProgress?.({
                    current: processedCount,
                    total,
                    currentItem: task.name,
                    elapsedMs: progressManager?.getElapsedMs() || 0,
                    phase: 'executing'
                });

            } catch (error) {
                processedCount++;
                const errorMessage = error instanceof Error ? error.message : String(error);

                result.failed.push({
                    success: false,
                    item: task.input,
                    error: errorMessage
                });

                if (this.options.collectErrors) {
                    this.notificationManager.collectError(task.name, errorMessage);
                }

                progressManager?.error(
                    error instanceof Error ? error : new Error(errorMessage),
                    task.input
                );

                if (!this.options.continueOnError) {
                    this.cancel();
                }
            }
        });

        // Execute with concurrent queue using runSettled for robust handling
        await this.queue.run(taskFunctions);

        result.cancelled = this.cancelled;

        return result;
    }

    /**
     * Cancel execution.
     */
    cancel(): void {
        this.cancelled = true;
    }

    /**
     * Check if cancelled.
     */
    isCancelled(): boolean {
        return this.cancelled;
    }

    /**
     * Get notification manager for error reporting.
     */
    getNotificationManager(): NotificationManager {
        return this.notificationManager;
    }

    /**
     * Show batch summary notification.
     */
    showSummary(total: number, successCount: number, operation: string): void {
        this.notificationManager.showBatchSummary(total, successCount, operation);
    }

    /**
     * Get error count.
     */
    getErrorCount(): number {
        return this.notificationManager.getErrorCount();
    }

    /**
     * Create tasks from files with a processor function.
     */
    static createTasks<T, R>(
        items: T[],
        nameGetter: (item: T) => string,
        processor: (item: T) => Promise<{ success: boolean; result?: R; error?: string }>
    ): BatchTask<T>[] {
        return items.map(item => ({
            input: item,
            name: nameGetter(item),
            execute: () => processor(item)
        }));
    }
}
