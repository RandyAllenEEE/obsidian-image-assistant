import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import PicGoUploader from '../../../../src/cloud/uploader/picgo';
import ImageAssistantPlugin from '../../../../src/main';

// Mock Obsidian API
vi.mock('obsidian', () => ({
    requestUrl: vi.fn(),
    Notice: vi.fn(),
}));

describe('PicGoUploader', () => {
    let uploader: PicGoUploader;
    let mockPlugin: any;
    let mockSettings: any;
    let mockHistoryManager: any;

    beforeEach(() => {
        const cloudSettings = {
            uploader: 'PicGo',
            uploadServer: 'http://127.0.0.1:36677/upload',
            deleteServer: 'http://127.0.0.1:36677/delete',
            picgoCorePath: '',
            remoteServerMode: false,
            imageSizeWidth: undefined,
            imageSizeHeight: undefined,
            imageSizeSource: 'settings' as const,
            workOnNetWork: false,
            newWorkBlackDomains: '',
            applyImage: true,
            uploadConcurrency: 3,
            cloudLinkFormat: 'markdown' as const,
        };

        mockHistoryManager = {
            addRecord: vi.fn(),
            getRecord: vi.fn(),
        };

        mockPlugin = {
            settings: {
                pasteHandling: {
                    mode: 'cloud' as const,
                    cursorLocation: 'back' as const,
                    neverProcessFilenames: '',
                    cloud: cloudSettings,
                },
            },
            saveSettings: vi.fn(),
            historyManager: mockHistoryManager,
        };

        uploader = new PicGoUploader(mockPlugin);
        mockSettings = (uploader as any).settings;
        vi.clearAllMocks();
    });

    describe('handleResponse 方法 - 成功响应处理', () => {
        it('Given 成功的 PicGo 响应, When handleResponse, Then 返回成功结果', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    success: true,
                    result: ['https://example.com/image1.png', 'https://example.com/image2.png'],
                },
            };

            const result = await (uploader as any).handleResponse(mockResponse);

            expect(result.success).toBe(true);
            expect(result.msg).toBe('success');
            expect(result.result).toEqual(['https://example.com/image1.png', 'https://example.com/image2.png']);
        });

        it('Given 单个 URL 字符串结果, When handleResponse, Then 转换为数组', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    success: true,
                    result: 'https://example.com/single-image.png',
                },
            };

            const result = await (uploader as any).handleResponse(mockResponse);

            expect(result.success).toBe(true);
            expect(result.result).toEqual(['https://example.com/single-image.png']);
        });

        it('Given PicList 响应包含 fullResult, When handleResponse, Then 保存上传记录', async () => {
            const fullResult = [
                { url: 'https://example.com/img1.png', fileName: 'img1.png' },
                { url: 'https://example.com/img2.png', fileName: 'img2.png' },
            ];

            const mockResponse = {
                status: 200,
                json: {
                    success: true,
                    result: ['https://example.com/img1.png', 'https://example.com/img2.png'],
                    fullResult: fullResult,
                },
            };

            await (uploader as any).handleResponse(mockResponse);

            expect(mockHistoryManager.addRecord).toHaveBeenCalledTimes(2);
            expect(mockHistoryManager.addRecord).toHaveBeenCalledWith(fullResult[0]);
            expect(mockHistoryManager.addRecord).toHaveBeenCalledWith(fullResult[1]);
        });

        it('Given 已有上传记录, When handleResponse 新增记录, Then 追加而不是覆盖', async () => {
            const newRecord = [
                { url: 'https://example.com/new.png', fileName: 'new.png' },
            ];

            const mockResponse = {
                status: 200,
                json: {
                    success: true,
                    result: ['https://example.com/new.png'],
                    fullResult: newRecord,
                },
            };

            await (uploader as any).handleResponse(mockResponse);

            expect(mockHistoryManager.addRecord).toHaveBeenCalledWith(newRecord[0]);
        });
    });

    describe('handleResponse 方法 - 错误响应处理', () => {
        it('Given HTTP 状态码非 200, When handleResponse, Then 返回失败结果', async () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            try {
                const mockResponse = {
                    status: 500,
                    json: {
                        success: false,
                        msg: 'Server error',
                    },
                };

                const result = await (uploader as any).handleResponse(mockResponse);

                expect(result.success).toBe(false);
                expect(result.msg).toBe('Server error');
                expect(result.result).toEqual([]);
                expect(error).toHaveBeenCalledWith(
                    '[Image Assistant] Cloud upload failed (http-status, HTTP 500).'
                );
                expect(error.mock.calls.flat().join(' ')).not.toContain('Server error');
            } finally {
                error.mockRestore();
            }
        });

        it('Given success 字段为 false, When handleResponse, Then 返回失败结果', async () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            try {
                const mockResponse = {
                    status: 200,
                    json: {
                        success: false,
                        message: 'Upload failed: invalid file type',
                    },
                };

                const result = await (uploader as any).handleResponse(mockResponse);

                expect(result.success).toBe(false);
                expect(result.msg).toBe('Upload failed: invalid file type');
                expect(error).toHaveBeenCalledWith(
                    '[Image Assistant] Cloud upload failed (service-response, HTTP 200).'
                );
                expect(error.mock.calls.flat().join(' ')).not.toContain('invalid file type');
            } finally {
                error.mockRestore();
            }
        });

        it('Given 响应同时包含 msg 和 message, When handleResponse, Then 优先使用 msg', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    success: false,
                    msg: 'Error from msg',
                    message: 'Error from message',
                },
            };

            const result = await (uploader as any).handleResponse(mockResponse);

            expect(result.msg).toBe('Error from msg');
        });

        it('Given 错误响应无 fullResult, When handleResponse, Then 不修改 uploadedImages', async () => {
            const mockResponse = {
                status: 500,
                json: {
                    success: false,
                    msg: 'Error',
                },
            };

            await (uploader as any).handleResponse(mockResponse);

            expect(mockHistoryManager.addRecord).not.toHaveBeenCalled();
            expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
        });
    });

    describe('边界情况和错误处理', () => {
        it('Given an empty result array, When handling the response, Then returns a usable failure result', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    success: true,
                    result: [],
                },
            };

            const result = await (uploader as any).handleResponse(mockResponse);

            expect(result.success).toBe(false);
            expect(result.result).toEqual([]);
        });

        it('Given a malformed success response, When handling it, Then returns a failure instead of throwing', async () => {
            const result = await (uploader as any).handleResponse({
                status: 200,
                json: { success: true, result: { unexpected: true } },
            });

            expect(result).toEqual({
                success: false,
                msg: 'Cloud upload returned no image URL',
                result: [],
            });
        });

        it('rejects non-HTTP upload results and does not persist them to history', async () => {
            const result = await (uploader as any).handleResponse({
                status: 200,
                json: {
                    success: true,
                    result: ['not-a-url', 'file:///tmp/image.png'],
                    fullResult: [{ url: 'javascript:alert(1)' }],
                },
            });

            expect(result).toEqual({
                success: false,
                msg: 'Cloud upload returned no image URL',
                result: [],
            });
            expect(mockHistoryManager.addRecord).not.toHaveBeenCalled();
        });

        it('keeps a successful upload result when PicList history persistence fails', async () => {
            mockHistoryManager.addRecord.mockRejectedValueOnce(new Error('history disk full'));
            vi.spyOn(console, 'error').mockImplementation(() => undefined);

            const result = await (uploader as any).handleResponse({
                status: 200,
                json: {
                    success: true,
                    result: ['https://example.com/image.png'],
                    fullResult: [{ url: 'https://example.com/image.png' }],
                },
            });

            expect(result.success).toBe(true);
            expect(result.result).toEqual(['https://example.com/image.png']);
        });

        it('Given 结果包含特殊字符 URL, When handleResponse, Then 原样返回', async () => {
            const specialUrl = 'https://example.com/图片-测试_123.png?token=abc&size=100';
            const mockResponse = {
                status: 200,
                json: {
                    success: true,
                    result: [specialUrl],
                },
            };

            const result = await (uploader as any).handleResponse(mockResponse);

            expect(result.result[0]).toBe(specialUrl);
        });

        it('Given uploadedImages 字段不存在, When 处理 fullResult, Then 初始化为空数组', async () => {
            // Note: Since we are mocking historyManager, detecting "uploadedImages field missing" 
            // is less relevant as we don't init it on settings anymore.
            // But we should verify it handles it gracefully or calls historyManager correctly.

            // If settings.uploadedImages refers to old settings, PicGo should ignore it.
            // The logic: if (data.fullResult) -> addRecord().

            const mockResponse = {
                status: 200,
                json: {
                    success: true,
                    result: ['https://example.com/new.png'],
                    fullResult: [{ url: 'https://example.com/new.png', fileName: 'new.png' }],
                },
            };

            await (uploader as any).handleResponse(mockResponse);

            expect(mockHistoryManager.addRecord).toHaveBeenCalledTimes(1);
        });

        it('Given 响应中 success 字段缺失但状态码 200, When handleResponse, Then 视为成功', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    result: ['https://example.com/image.png'],
                },
            };

            const result = await (uploader as any).handleResponse(mockResponse);

            // success 为 undefined，但状态码 200
            // 根据代码逻辑：success === false 才失败，undefined 不等于 false
            expect(result.success).toBe(true);
        });
    });

});
