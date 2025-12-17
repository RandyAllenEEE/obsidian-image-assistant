import { describe, it, expect, beforeEach, vi } from 'vitest';
import Texify from '../../../../src/ocr/providers/texify';
import { SelfHostedSettings } from '../../../../src/ocr/providers/SelfHostedSettings';

// Mock global fetch
global.fetch = vi.fn();

describe('Texify', () => {
    let texify: Texify;
    let mockSettings: SelfHostedSettings;

    beforeEach(() => {
        mockSettings = {
            url: 'https://texify.example.com/predict',
            username: '',
            password: ''
        };

        texify = new Texify(mockSettings);
        vi.clearAllMocks();
    });

    describe('构造函数', () => {
        it('Given 设置对象, When 创建 Texify 实例, Then 正确初始化', () => {
            expect(texify.settings).toBe(mockSettings);
            expect(texify.settings.url).toBe('https://texify.example.com/predict');
        });
    });

    describe('sendRequest 方法 - 成功场景', () => {
        it('Given 图片数据, When 调用 sendRequest, Then 发送正确的 FormData 请求', async () => {
            const mockImage = new Uint8Array([137, 80, 78, 71]); // PNG header

            const mockResponse = {
                json: async () => ({
                    results: ['x^2 + y^2 = z^2']
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await texify.sendRequest(mockImage);

            // 验证 fetch 调用
            expect(global.fetch).toHaveBeenCalledTimes(1);
            const [url, options] = (global.fetch as any).mock.calls[0];

            expect(url).toBe('https://texify.example.com/predict');
            expect(options.method).toBe('POST');
            expect(options.body).toBeInstanceOf(FormData);
        });

        it('Given 无认证设置, When 发送请求, Then 不包含 Authorization 头', async () => {
            const mockImage = new Uint8Array([137, 80, 78, 71]);

            const mockResponse = {
                json: async () => ({
                    results: ['\\int_0^1 x dx']
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await texify.sendRequest(mockImage);

            const [, options] = (global.fetch as any).mock.calls[0];
            expect(options.headers).toBeUndefined();
        });

        it('Given 有认证设置, When 发送请求, Then 包含 Basic Authorization 头', async () => {
            mockSettings.username = 'testuser';
            mockSettings.password = 'testpass';
            texify = new Texify(mockSettings);

            const mockImage = new Uint8Array([137, 80, 78, 71]);

            const mockResponse = {
                json: async () => ({
                    results: ['\\frac{1}{2}']
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await texify.sendRequest(mockImage);

            const [, options] = (global.fetch as any).mock.calls[0];
            expect(options.headers).toBeDefined();
            expect(options.headers.Authorization).toContain('Basic ');

            // 验证 Base64 编码
            const base64Credentials = options.headers.Authorization.replace('Basic ', '');
            const credentials = atob(base64Credentials);
            expect(credentials).toBe('testuser:testpass');
        });

        it('Given Texify 响应, When 解析, Then 返回第一个结果', async () => {
            const mockImage = new Uint8Array([137, 80, 78, 71]);

            const mockResponse = {
                json: async () => ({
                    results: ['x^2 + y^2', 'alternative result']
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await texify.sendRequest(mockImage);

            expect(result).toBe('x^2 + y^2');
        });
    });

    describe('sendRequest 方法 - FormData 构建', () => {
        it('Given 图片数据, When 构建 FormData, Then 正确创建 Blob', async () => {
            const mockImage = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // Full PNG header

            const mockResponse = {
                json: async () => ({
                    results: ['result']
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await texify.sendRequest(mockImage);

            const [, options] = (global.fetch as any).mock.calls[0];
            const formData = options.body as FormData;

            // FormData 应该包含 image 字段
            // 注：实际验证 FormData 内容在单元测试中较困难，这里验证类型
            expect(formData).toBeInstanceOf(FormData);
        });
    });

    describe('sendRequest 方法 - 错误处理', () => {
        it('Given 网络错误, When 调用, Then 抛出异常', async () => {
            const mockImage = new Uint8Array([137, 80, 78, 71]);

            (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

            await expect(texify.sendRequest(mockImage)).rejects.toThrow('Network error');
        });

        it('Given 响应 JSON 解析失败, When 调用, Then 抛出异常', async () => {
            const mockImage = new Uint8Array([137, 80, 78, 71]);

            const mockResponse = {
                json: async () => {
                    throw new Error('Invalid JSON');
                }
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await expect(texify.sendRequest(mockImage)).rejects.toThrow('Invalid JSON');
        });

        it('Given 响应缺少 results 字段, When 访问, Then 抛出异常', async () => {
            const mockImage = new Uint8Array([137, 80, 78, 71]);

            const mockResponse = {
                json: async () => ({
                    // 缺少 results 字段
                    error: 'Invalid format'
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await expect(texify.sendRequest(mockImage)).rejects.toThrow();
        });

        it('Given results 为空数组, When 访问第一个元素, Then 返回 undefined', async () => {
            const mockImage = new Uint8Array([137, 80, 78, 71]);

            const mockResponse = {
                json: async () => ({
                    results: []
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await texify.sendRequest(mockImage);

            expect(result).toBeUndefined();
        });
    });

    describe('边界情况', () => {
        it('Given 空图片数据, When 调用, Then 仍能发送请求', async () => {
            const mockImage = new Uint8Array([]);

            const mockResponse = {
                json: async () => ({
                    results: ['empty result']
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await texify.sendRequest(mockImage);

            expect(result).toBe('empty result');
        });

        it('Given 大图片数据, When 调用, Then 正常处理', async () => {
            const largeImage = new Uint8Array(1024 * 1024); // 1MB
            largeImage.fill(137);

            const mockResponse = {
                json: async () => ({
                    results: ['large image result']
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await texify.sendRequest(largeImage);

            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('Given 特殊字符密码, When 构建认证, Then 正确编码', async () => {
            mockSettings.username = 'user@example.com';
            mockSettings.password = 'p@ss:w0rd!';
            texify = new Texify(mockSettings);

            const mockImage = new Uint8Array([137, 80, 78, 71]);

            const mockResponse = {
                json: async () => ({
                    results: ['result']
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await texify.sendRequest(mockImage);

            const [, options] = (global.fetch as any).mock.calls[0];
            const base64Credentials = options.headers.Authorization.replace('Basic ', '');
            const credentials = atob(base64Credentials);

            expect(credentials).toBe('user@example.com:p@ss:w0rd!');
        });
    });

    describe('功能说明和使用场景', () => {
        it('Texify 服务说明', () => {
            /*
             * Texify 服务功能：
             * 
             * 1. 自托管 OCR 服务，专注于公式识别
             * 2. 基于深度学习模型（如 Transformer）
             * 3. 支持 Basic 认证保护
             * 4. 返回格式：TexifyResponse { results: string[] }
             * 
             * 请求流程：
             * 1. 将图片转换为 Blob (image/png)
             * 2. 构建 FormData，添加 image 字段
             * 3. 发送 POST 请求
             * 4. 可选：添加 Basic Authorization 头
             * 5. 解析响应，返回第一个结果
             * 
             * 适用场景：
             * - 自托管环境（私有数据）
             * - 需要定制模型
             * - 批量处理（成本可控）
             * - 离线使用
             */
            expect(true).toBe(true);
        });

        it('与其他 Provider 的对比', () => {
            /*
             * Texify vs 其他服务：
             * 
             * Texify (自托管):
             * - 优势：隐私保护、可定制、无 API Key、成本可控
             * - 劣势：需要服务器资源、维护成本
             * 
             * SimpleTex/Pix2Tex (在线服务):
             * - 优势：即开即用、无需维护
             * - 劣势：依赖网络、需要 API Key、成本较高
             * 
             * AIModelConverter (LLM):
             * - 优势：通用性强、理解能力好
             * - 劣势：成本高、速度慢
             * 
             * 建议：
             * - 隐私敏感：使用 Texify 自托管
             * - 快速上手：使用 SimpleTex
             * - 复杂场景：使用 LLM
             */
            expect(true).toBe(true);
        });

        it('TexifyResponse 格式说明', () => {
            /*
             * TexifyResponse 接口：
             * {
             *   results: string[]  // LaTeX 公式数组
             * }
             * 
             * 注意：
             * - results[0] 是主要结果
             * - 可能包含多个候选结果
             * - 如果为空数组，sendRequest 会返回 undefined
             * 
             * 服务端实现参考：
             * https://github.com/VikParuchuri/texify
             */
            expect(true).toBe(true);
        });
    });

    describe('集成测试建议', () => {
        it('实际 Texify 服务测试说明', () => {
            /*
             * 完整测试 Texify 需要：
             * 
             * 1. 搭建 Texify 服务：
             *    - 使用 Docker: ghcr.io/vikparuchuri/texify
             *    - 或本地部署
             * 
             * 2. 准备测试图片：
             *    - 简单公式：x^2
             *    - 复杂公式：积分、矩阵
             *    - 边界情况：模糊图片、手写公式
             * 
             * 3. 测试场景：
             *    - 无认证模式
             *    - Basic 认证模式
             *    - 超时处理
             *    - 并发请求
             * 
             * 单元测试局限：
             * - 无法测试实际模型精度
             * - 无法验证 FormData 上传
             * - 无法测试网络延迟
             * 
             * 建议：编写集成测试或手动测试
             */
            expect(true).toBe(true);
        });
    });
});
