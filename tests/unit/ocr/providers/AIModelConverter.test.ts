import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIModelConverter } from '../../../../src/ocr/providers/AIModelConverter';
import { OCRSettings } from '../../../../src/ocr/OCRSettings';
import { App } from 'obsidian';

// Mock global fetch
global.fetch = vi.fn();

function pngImage(): Uint8Array {
    return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
}

describe('AIModelConverter', () => {
    let converter: AIModelConverter;
    let mockSettings: OCRSettings;
    let mockApp: App;

    beforeEach(() => {
        mockApp = {
            secretStorage: {
                getSecret: vi.fn().mockResolvedValue('test-api-key')
            }
        } as any;

        mockSettings = {
            latexProvider: 'LLM',
            markdownProvider: 'LLM',
            simpleTex: {
                appIdSecretId: '',
                appSecretSecretId: '',
                tokenSecretId: ''
            },
            texify: { url: '', username: '', passwordSecretId: '' },
            pix2tex: { url: '', username: '', passwordSecretId: '' },
            aiModel: {
                providerType: 'openai' as const,
                endpoint: 'https://api.openai.com/v1/chat/completions',
                model: 'gpt-4o',
                maxTokens: 1000,
                apiKeySecretId: 'test-secret-id',
                prompts: {
                    latex: 'Convert this image to LaTeX',
                    markdown: 'Convert this image to Markdown'
                }
            }
        };

        vi.clearAllMocks();
    });

    describe('构造函数和初始化', () => {
        it('Given LaTeX 单行模式, When 创建转换器, Then 正确初始化', () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');

            expect((converter as any).isMultiline).toBe(false);
            expect((converter as any).promptType).toBe('latex');
            expect((converter as any).settings).toBe(mockSettings);
        });

        it('Given LaTeX 多行模式, When 创建转换器, Then 正确初始化', () => {
            converter = new AIModelConverter(mockApp, true, mockSettings, 'latex');

            expect((converter as any).isMultiline).toBe(true);
            expect((converter as any).promptType).toBe('latex');
        });

        it('Given Markdown 模式, When 创建转换器, Then 正确初始化', () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'markdown');

            expect((converter as any).promptType).toBe('markdown');
        });
    });

    describe('sendRequest 方法 - 成功场景', () => {
        it('Given 图片数据, When 调用 sendRequest, Then 发送正确的 API 请求', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: 'x^2 + y^2 = z^2'
                        }
                    }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await converter.sendRequest(mockImage);

            // 验证 fetch 调用
            expect(global.fetch).toHaveBeenCalledTimes(1);
            const [url, options] = (global.fetch as any).mock.calls[0];

            expect(url).toBe('https://api.openai.com/v1/chat/completions');
            expect(options.method).toBe('POST');
            expect(options.headers['Content-Type']).toBe('application/json');
            expect(options.headers['Authorization']).toBe('Bearer test-api-key');
        });

        it('Given LaTeX 单行模式, When 收到响应, Then 包裹为单行公式', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: 'x^2 + y^2 = z^2'
                        }
                    }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await converter.sendRequest(mockImage);

            expect(result).toBe('$x^2 + y^2 = z^2$');
        });

        it('Given LaTeX 多行模式, When 收到响应, Then 包裹为多行公式', async () => {
            converter = new AIModelConverter(mockApp, true, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: '\\int_0^1 x^2 dx'
                        }
                    }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await converter.sendRequest(mockImage);

            expect(result).toBe('$$\n\\int_0^1 x^2 dx\n$$');
        });

        it('Given Markdown 模式, When 收到响应, Then 直接返回内容', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'markdown');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: 'This is a diagram showing...'
                        }
                    }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await converter.sendRequest(mockImage);

            expect(result).toBe('This is a diagram showing...');
        });
    });

    describe('sendRequest 方法 - 数据清洗', () => {
        it('Given 响应包含 markdown 代码块, When 清洗, Then 移除代码块标记', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: '```latex\nx^2 + y^2\n```'
                        }
                    }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await converter.sendRequest(mockImage);

            expect(result).toBe('$x^2 + y^2$');
        });

        it('Given 响应已包含 $ 包裹, When 清洗, Then 移除外层 $ 符号', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: '$x^2 + y^2$'
                        }
                    }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await converter.sendRequest(mockImage);

            // 应该移除原有的 $，然后重新包裹
            expect(result).toBe('$x^2 + y^2$');
        });

        it('Given 响应已包含 $$ 包裹, When 清洗, Then 移除外层 $$ 符号', async () => {
            converter = new AIModelConverter(mockApp, true, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: '$$\n\\int_0^1 x dx\n$$'
                        }
                    }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await converter.sendRequest(mockImage);

            expect(result).toBe('$$\n\\int_0^1 x dx\n$$');
        });

        it('Given 响应包含多余空白, When 清洗, Then 正确 trim', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: '  x^2 + y^2  '
                        }
                    }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await converter.sendRequest(mockImage);

            expect(result).toBe('$x^2 + y^2$');
        });
    });

    describe('sendRequest 方法 - 错误处理', () => {
        it('Given API 返回错误状态, When 调用, Then 抛出异常', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: false,
                status: 401,
                statusText: 'Unauthorized'
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await expect(converter.sendRequest(mockImage)).rejects.toThrow();
        });

        it('includes a bounded provider error body for a failed request', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            (global.fetch as any).mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: async () => `quota exceeded ${'x'.repeat(500)}`
            });

            const error = await converter.sendRequest(pngImage()).then(
                () => null,
                value => value as Error
            );

            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('429: quota exceeded');
            expect((error as Error).message.length).toBeLessThan(360);
        });

        it('Given 网络错误, When 调用, Then 抛出异常', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

            await expect(converter.sendRequest(mockImage)).rejects.toThrow('Network error');
        });

        it('Given API 响应格式错误, When 调用, Then 抛出异常', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    // 缺少 choices 字段
                    error: 'Invalid response'
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await expect(converter.sendRequest(mockImage)).rejects.toThrow();
        });
    });

    describe('请求载荷构建', () => {
        it('Given 图片数据, When 构建请求, Then Base64 编码正确', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'x^2' } }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await converter.sendRequest(mockImage);

            const [, options] = (global.fetch as any).mock.calls[0];
            const payload = JSON.parse(options.body);

            // 验证 payload 结构
            expect(payload.model).toBe('gpt-4o');
            expect(payload.max_tokens).toBe(1000);
            expect(payload.messages).toHaveLength(1);
            expect(payload.messages[0].role).toBe('user');
            expect(payload.messages[0].content).toHaveLength(2);

            // 验证文本内容
            expect(payload.messages[0].content[0].type).toBe('text');
            expect(payload.messages[0].content[0].text).toBe('Convert this image to LaTeX');

            // 验证图片 Base64
            expect(payload.messages[0].content[1].type).toBe('image_url');
            expect(payload.messages[0].content[1].image_url.url).toContain('data:image/png;base64,');
        });

        it('Given WebP 图片, When 构建请求, Then data URL 使用 image/webp', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
            (global.fetch as any).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'x' } }] })
            });

            await converter.sendRequest(webp);

            const [, options] = (global.fetch as any).mock.calls[0];
            const payload = JSON.parse(options.body);
            expect(payload.messages[0].content[1].image_url.url).toContain('data:image/webp;base64,');
        });

        it('Given Markdown 模式, When 构建请求, Then 使用 Markdown prompt', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'markdown');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'text' } }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await converter.sendRequest(mockImage);

            const [, options] = (global.fetch as any).mock.calls[0];
            const payload = JSON.parse(options.body);

            expect(payload.messages[0].content[0].text).toBe('Convert this image to Markdown');
        });
    });

    describe('边界情况和注意事项', () => {
        it('Given 空图片数据, When 调用, Then 拒绝发送请求', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = new Uint8Array([]);

            await expect(converter.sendRequest(mockImage)).rejects.toThrow('not a recognized image');
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('Given 特殊字符响应, When 清洗, Then 保留 LaTeX 语法', async () => {
            converter = new AIModelConverter(mockApp, false, mockSettings, 'latex');
            const mockImage = pngImage();

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: '\\frac{1}{2} \\times \\sqrt{3}'
                        }
                    }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await converter.sendRequest(mockImage);

            expect(result).toBe('$\\frac{1}{2} \\times \\sqrt{3}$');
        });
    });

});
