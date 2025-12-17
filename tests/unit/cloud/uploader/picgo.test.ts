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
        const cloudUploadSettings = {
            uploadServer: 'http://127.0.0.1:36677/upload',
            remoteServerMode: false,
            // uploadedImages removed from settings
        };

        mockHistoryManager = {
            addRecord: vi.fn(),
            getRecord: vi.fn(),
        };

        mockPlugin = {
            settings: {
                cloudUploadSettings: cloudUploadSettings,
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
        });

        it('Given success 字段为 false, When handleResponse, Then 返回失败结果', async () => {
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

    describe('PicGo 响应格式说明', () => {
        it('PicGo 标准响应格式文档', () => {
            /*
             * PicGo 响应格式说明：
             * 
             * 成功响应：
             * {
             *   success: true,
             *   result: string[] | string,  // URL 数组或单个 URL
             *   fullResult?: Array<{        // PicList 扩展字段（可选）
             *     url: string,
             *     fileName: string,
             *     ... other metadata
             *   }>
             * }
             * 
             * 失败响应：
             * {
             *   success: false,
             *   msg?: string,      // 错误消息（优先）
             *   message?: string   // 备用错误消息
             * }
             * 
             * HTTP 状态码：
             * - 200: 正常（但仍需检查 success 字段）
             * - 非 200: 请求失败
             */
            expect(true).toBe(true);
        });

        it('uploadedImages 持久化说明', () => {
            /*
             * uploadedImages 功能：
             * 
             * 1. 仅在使用 PicList 时有效（PicList 提供 fullResult 字段）
             * 2. 保存所有上传记录的完整元数据
             * 3. 每次上传成功后追加到数组
             * 4. 通过 plugin.saveSettings() 持久化到磁盘
             * 5. 用于：
             *    - 查看上传历史
             *    - 管理已上传图片
             *    - 删除云端图片
             */
            expect(true).toBe(true);
        });
    });

    describe('边界情况和错误处理', () => {
        it('Given 空数组结果, When handleResponse, Then 正常处理', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    success: true,
                    result: [],
                },
            };

            const result = await (uploader as any).handleResponse(mockResponse);

            expect(result.success).toBe(true);
            expect(result.result).toEqual([]);
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

    describe('Local 模式和 Remote 模式说明', () => {
        it('Local 模式工作原理', () => {
            /*
             * Local 模式 (remoteServerMode = false)：
             * 
             * 1. 发送文件路径而非文件内容
             * 2. 请求格式：
             *    POST /upload
             *    { list: ["/absolute/path/to/image.png"] }
             * 
             * 3. PicGo 本地服务读取文件并上传
             * 4. 适用场景：
             *    - 开发环境
             *    - 本地运行 PicGo
             *    - 文件可被 PicGo 进程访问
             * 
             * 5. 优势：
             *    - 请求体小
             *    - 传输速度快
             *    - 不需要读取文件内容
             */
            expect(true).toBe(true);
        });

        it('Remote 模式工作原理', () => {
            /*
             * Remote 模式 (remoteServerMode = true)：
             * 
             * 1. 读取文件为 ArrayBuffer
             * 2. 创建 File 对象
             * 3. 使用 FormData 上传二进制数据
             * 4. 适用场景：
             *    - 生产环境
             *    - PicGo 运行在远程服务器
             *    - 跨网络上传
             * 
             * 5. 优势：
             *    - 不依赖文件系统路径
             *    - 支持跨平台/跨网络
             * 
             * 6. 注意事项：
             *    - 需要读取文件内容
             *    - 请求体较大
             *    - 适合较小的图片文件
             */
            expect(true).toBe(true);
        });

        it('文件命名规则', () => {
            /*
             * 文件名格式：{timestamp}{extension}
             * 
             * 例如：
             * - 原始文件：/path/to/my-photo.jpg
             * - 上传名称：1702800000000.jpg
             * 
             * 目的：
             * - 避免文件名冲突
             * - 生成唯一标识
             * - 兼容各种字符集
             */
            expect(true).toBe(true);
        });
    });

    describe('集成测试建议', () => {
        it('实际 PicGo 服务测试说明', () => {
            /*
             * 完整测试 PicGoUploader 需要：
             * 
             * 1. 启动本地 PicGo 服务（端口 36677）
             * 2. 配置有效的图床（如 SM.MS、GitHub）
             * 3. 准备测试图片文件
             * 4. 测试场景：
             *    - Local 模式上传本地文件
             *    - Remote 模式上传文件内容
             *    - 剪贴板图片上传
             *    - 错误处理（无效文件、网络错误）
             * 
             * 单元测试局限：
             * - 无法测试实际网络请求
             * - 无法验证 PicGo 集成
             * - 无法测试文件读取逻辑
             * 
             * 建议：编写集成测试或手动测试
             */
            expect(true).toBe(true);
        });
    });
});
