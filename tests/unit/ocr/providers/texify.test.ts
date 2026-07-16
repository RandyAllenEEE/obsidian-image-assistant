import { describe, it, expect, beforeEach, vi } from 'vitest';
import Texify from '../../../../src/ocr/providers/texify';
import { SelfHostedSettings } from '../../../../src/ocr/providers/SelfHostedSettings';

// Mock global fetch
global.fetch = vi.fn();

function pngImage(): Uint8Array {
    return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
}

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
            const mockImage = pngImage();

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
            const mockImage = pngImage();

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

            const mockImage = pngImage();

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

        it('reads the Basic Auth password from Obsidian Secret Storage', async () => {
            mockSettings.username = 'secret-user';
            mockSettings.password = undefined;
            mockSettings.passwordSecretId = 'image-assistant-texify-password';
            texify = new Texify(mockSettings, {
                secretStorage: { getSecret: vi.fn(() => 'stored-password') }
            } as any);
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({ results: ['x'] })
            });

            await texify.sendRequest(pngImage());

            const [, options] = (global.fetch as any).mock.calls[0];
            expect(atob(options.headers.Authorization.replace('Basic ', '')))
                .toBe('secret-user:stored-password');
        });

        it('Given Texify 响应, When 解析, Then 返回第一个结果', async () => {
            const mockImage = pngImage();

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
            const mockImage = pngImage();

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

        it('Given JPEG bytes, When 构建 FormData, Then 使用真实 MIME 和扩展名', async () => {
            (global.fetch as any).mockResolvedValueOnce({
                json: async () => ({ results: ['result'] })
            });

            await texify.sendRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

            const [, options] = (global.fetch as any).mock.calls[0];
            const image = (options.body as FormData).get('image') as File;
            expect(image.type).toBe('image/jpeg');
            expect(image.name).toBe('image.jpg');
        });
    });

    describe('sendRequest 方法 - 错误处理', () => {
        it('Given 网络错误, When 调用, Then 抛出异常', async () => {
            const mockImage = pngImage();

            (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

            await expect(texify.sendRequest(mockImage)).rejects.toThrow('Network error');
        });

        it('Given 响应 JSON 解析失败, When 调用, Then 抛出异常', async () => {
            const mockImage = pngImage();

            const mockResponse = {
                json: async () => {
                    throw new Error('Invalid JSON');
                }
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await expect(texify.sendRequest(mockImage)).rejects.toThrow('malformed JSON');
        });

        it('Given 响应缺少 results 字段, When 访问, Then 抛出异常', async () => {
            const mockImage = pngImage();

            const mockResponse = {
                json: async () => ({
                    // 缺少 results 字段
                    error: 'Invalid format'
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await expect(texify.sendRequest(mockImage)).rejects.toThrow();
        });

        it('Given results 为空数组, When 访问第一个元素, Then 抛出可读错误', async () => {
            const mockImage = pngImage();

            const mockResponse = {
                json: async () => ({
                    results: []
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await expect(texify.sendRequest(mockImage)).rejects.toThrow('returned no result');
        });
    });

    describe('边界情况', () => {
        it('Given 空图片数据, When 调用, Then 拒绝发送请求', async () => {
            const mockImage = new Uint8Array([]);

            await expect(texify.sendRequest(mockImage)).rejects.toThrow('not a recognized image');
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('Given 大图片数据, When 调用, Then 正常处理', async () => {
            const largeImage = new Uint8Array(1024 * 1024); // 1MB
            largeImage.set(pngImage());

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

            const mockImage = pngImage();

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

});
