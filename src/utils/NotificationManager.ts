import { Notice } from "obsidian";

/**
 * Batch operation error information
 * 批量操作错误信息
 */
export interface BatchOperationError {
    fileName: string;
    url?: string;
    error: string;
    timestamp: number;
}

/**
 * Notification Manager for batch operations
 * Collects errors and displays consolidated notifications
 * 批量操作通知管理器，收集错误并显示汇总通知
 */
export class NotificationManager {
    private errors: BatchOperationError[] = [];

    /**
     * Collect a batch operation error
     * 收集批量操作错误
     * 
     * @param fileName - The file name that encountered the error
     * @param error - The error message
     * @param url - Optional URL associated with the error
     */
    collectError(fileName: string, error: string, url?: string): void {
        this.errors.push({
            fileName,
            url,
            error,
            timestamp: Date.now()
        });
    }

    /**
     * Get all collected errors
     * 获取所有收集的错误
     */
    getErrors(): BatchOperationError[] {
        return [...this.errors];
    }

    /**
     * Get the number of errors collected
     * 获取收集的错误数量
     */
    getErrorCount(): number {
        return this.errors.length;
    }

    /**
     * Display batch operation summary notification
     * 显示批量操作汇总通知
     * 
     * @param totalCount - Total number of items processed
     * @param successCount - Number of successful operations
     * @param operationType - Type of operation (e.g., "图片下载", "批量上传")
     * @param extraInfo - Optional extra information to display
     */
    showBatchSummary(
        totalCount: number,
        successCount: number,
        operationType: string,
        extraInfo?: string
    ): void {
        const failedCount = this.errors.length;

        // All succeeded - short success message
        if (failedCount === 0) {
            let message = `✅ ${operationType}完成: ${successCount}/${totalCount} 成功`;
            if (extraInfo) {
                message += `\n${extraInfo}`;
            }
            new Notice(message, 3000);
            return;
        }

        // Build summary message with error details
        let message = `⚠️ ${operationType}完成:\n`;
        message += `成功: ${successCount}/${totalCount}\n`;
        message += `失败: ${failedCount}/${totalCount}`;

        if (extraInfo) {
            message += `\n${extraInfo}`;
        }

        // Show first 5 errors in the notification
        if (failedCount <= 5) {
            message += `\n\n失败详情:`;
            this.errors.forEach(err => {
                message += `\n• ${err.fileName}: ${err.error}`;
            });
        } else {
            message += `\n\n失败详情（显示前5个）:`;
            this.errors.slice(0, 5).forEach(err => {
                message += `\n• ${err.fileName}: ${err.error}`;
            });
            message += `\n\n更多错误详情请查看控制台日志`;
        }

        // Display notification with longer duration for errors
        new Notice(message, 8000);

        // Log complete error list to console if more than 5 errors
        if (failedCount > 5) {
            console.group(`[${operationType}] 完整错误列表 (${failedCount})`);
            this.errors.forEach((err, index) => {
                console.error(
                    `${index + 1}. ${err.fileName}: ${err.error}`,
                    err.url ? `URL: ${err.url}` : ''
                );
            });
            console.groupEnd();
        }
    }

    /**
     * Display a simple progress notification
     * 显示简单的进度通知
     * 
     * @param current - Current item number
     * @param total - Total number of items
     * @param itemName - Name of the current item
     */
    showProgress(current: number, total: number, itemName?: string): void {
        // Only show progress at certain intervals to avoid notification spam
        // 仅在特定间隔显示进度，避免通知刷屏
        const shouldShow = current === 1 || current === total || current % 5 === 0;
        
        if (shouldShow) {
            const message = itemName 
                ? `🔄 处理中 (${current}/${total}): ${itemName}`
                : `🔄 处理中 (${current}/${total})`;
            new Notice(message, 1000);
        }
    }

    /**
     * Reset and clear all collected errors
     * 重置并清空所有收集的错误
     */
    reset(): void {
        this.errors = [];
    }
}
