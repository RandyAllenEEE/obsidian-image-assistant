import { Notice } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { BatchProgressInfo, BatchProgressCallback } from './types';

/**
 * BatchProgressManager - Unified progress display for batch operations.
 * Supports StatusBar and Notice-based progress reporting.
 */
export class BatchProgressManager {
    private statusBarItem: HTMLElement | null = null;
    private startTime: number = 0;
    private currentPhase: BatchProgressInfo['phase'] = 'collecting';
    private callback?: BatchProgressCallback;

    constructor(
        private plugin: ImageConverterPlugin,
        options?: { callback?: BatchProgressCallback }
    ) {
        this.callback = options?.callback;
    }

    /**
     * Start progress tracking.
     */
    start(phase: BatchProgressInfo['phase'] = 'collecting'): void {
        this.startTime = Date.now();
        this.currentPhase = phase;
        this.statusBarItem = this.plugin.addStatusBarItem();
    }

    /**
     * Update progress.
     */
    update(current: number, total: number, currentItem: string): void {
        const elapsedMs = Date.now() - this.startTime;
        const elapsedSec = (elapsedMs / 1000).toFixed(2);

        const info: BatchProgressInfo = {
            current,
            total,
            currentItem,
            elapsedMs,
            phase: this.currentPhase
        };

        // Update StatusBar
        if (this.statusBarItem) {
            const phaseLabel = this.getPhaseLabel(this.currentPhase);
            this.statusBarItem.setText(
                `${phaseLabel} ${current}/${total}, elapsed: ${elapsedSec}s`
            );
        }

        // Call callback
        this.callback?.onProgress?.(info);
    }

    /**
     * Set current phase.
     */
    setPhase(phase: BatchProgressInfo['phase']): void {
        this.currentPhase = phase;
    }

    /**
     * Complete progress tracking with success message.
     */
    complete(processedCount: number, message?: string): void {
        const elapsedMs = Date.now() - this.startTime;
        const elapsedSec = (elapsedMs / 1000).toFixed(2);

        const defaultMessage = `Finished processing ${processedCount} items, total time: ${elapsedSec}s`;
        const finalMessage = message || defaultMessage;

        if (this.statusBarItem) {
            this.statusBarItem.setText(finalMessage);
            window.setTimeout(() => {
                this.statusBarItem?.remove();
                this.statusBarItem = null;
            }, 5000);
        }

        new Notice(finalMessage);
    }

    /**
     * Cancel and cleanup.
     */
    cancel(): void {
        if (this.statusBarItem) {
            this.statusBarItem.remove();
            this.statusBarItem = null;
        }
        this.callback?.onCancel?.();
    }

    /**
     * Report error.
     */
    error(error: Error, item?: any): void {
        this.callback?.onError?.(error, item);
    }

    /**
     * Get elapsed time in milliseconds.
     */
    getElapsedMs(): number {
        return Date.now() - this.startTime;
    }

    private getPhaseLabel(phase: BatchProgressInfo['phase']): string {
        switch (phase) {
            case 'collecting': return 'Collecting';
            case 'validating': return 'Validating';
            case 'executing': return 'Processing';
            case 'finalizing': return 'Finalizing';
            default: return 'Processing';
        }
    }
}
