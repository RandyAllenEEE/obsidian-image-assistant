import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIModelConverter } from '../../../../src/ocr/providers/AIModelConverter';
import { OCRSettings } from '../../../../src/ocr/OCRSettings';

// Mock global fetch
global.fetch = vi.fn();

describe('AIModelConverter', () => {
    let converter: AIModelConverter;
    let mockSettings: OCRSettings;

    beforeEach(() => {
        mockSettings = {
            simpleTexToken: '',
            simpleTexAppId: '',
            simpleTexAppSecret: '',
            latexProvider: 'LLM',
            markdownProvider: 'LLM',
            aiModel: {
                endpoint: 'https://api.openai.com/v1/chat/completions',
                apiKey: 'test-api-key',
                model: 'gpt-4o',
                maxTokens: 1000,
                prompts: {
                    latex: 'Convert this image to LaTeX',
                    markdown: 'Convert this image to Markdown'
                }
            },
            texify: { url: '', username: '', password: '' },
            pix2tex: { url: '', username: '', password: '' }
        };

        vi.clearAllMocks();
    });

    describe('构造函数和初始化', () => {
        it('Given LaTeX 单行模式, When 创建转换器, Then 正确初始化', () => {
            converter = new AIModelConverter(false, mockSettings, 'latex');

            expect((converter as any).isMultiline).toBe(false);
            expect((converter as any).promptType).toBe('latex');
            expect((converter as any).settings).toBe(mockSettings);
        });

        it('Given LaTeX 多行模式, When 创建转换器, Then 正确初始化', () => {
            converter = new AIModelConverter(true, mockSettings, 'latex');

            expect((converter as any).isMultiline).toBe(true);
            expect((converter as any).promptType).toBe('latex');
        });

        it('Given Markdown 模式, When 创建转换器, Then 正确初始化', () => {
            converter = new AIModelConverter(false, mockSettings, 'markdown');

            expect((converter as any).promptType).toBe('markdown');
        });
    });

    describe('sendRequest 方法 - 成功场景', () => {
        it('Given 图片数据, When 调用 sendRequest, Then 发送正确的 API 请求', async () => {
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]); // PNG header

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
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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
            converter = new AIModelConverter(true, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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
            converter = new AIModelConverter(false, mockSettings, 'markdown');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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
            converter = new AIModelConverter(true, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

            const mockResponse = {
                ok: false,
                status: 401,
                statusText: 'Unauthorized'
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await expect(converter.sendRequest(mockImage)).rejects.toThrow();
        });

        it('Given 网络错误, When 调用, Then 抛出异常', async () => {
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 76, 71]);

            (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

            await expect(converter.sendRequest(mockImage)).rejects.toThrow('Network error');
        });

        it('Given API 响应格式错误, When 调用, Then 抛出异常', async () => {
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]); // PNG header

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

        it('Given Markdown 模式, When 构建请求, Then 使用 Markdown prompt', async () => {
            converter = new AIModelConverter(false, mockSettings, 'markdown');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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
        it('Given 空图片数据, When 调用, Then 仍能正常处理', async () => {
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([]);

            const mockResponse = {
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'empty' } }]
                })
            };
            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await converter.sendRequest(mockImage);

            expect(result).toBe('$empty$');
        });

        it('Given 特殊字符响应, When 清洗, Then 保留 LaTeX 语法', async () => {
            converter = new AIModelConverter(false, mockSettings, 'latex');
            const mockImage = new Uint8Array([137, 80, 78, 71]);

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

    describe('功能说明和使用场景', () => {
        it('AIModelConverter 功能说明', () => {
            /*
             * AIModelConverter 功能：
             * 
             * 1. 支持任何 OpenAI 兼容的 API
             * 2. 可配置不同的模型（GPT-4o, Claude, 本地模型等）
             * 3. 自动处理图片 Base64 编码
             * 4. 智能清洗响应数据：
             *    - 移除 markdown 代码块标记
             *    - 移除多余的 $ 符号
             *    - Trim 空白字符
             * 5. 根据模式自动包裹结果：
             *    - 单行模式：$...$
             *    - 多行模式：$$...$$
             *    - Markdown 模式：原样返回
             * 
             * 使用场景：
             * - OCR 公式识别（LaTeX）
             * - OCR 文本识别（Markdown）
             * - 图片内容描述生成
             */
            expect(true).toBe(true);
        });

        it('与其他 Provider 的对比', () => {
            /*
             * AIModelConverter vs 其他 Provider：
             * 
             * SimpleTex/Pix2Tex/Texify：
             * - 专用 OCR 服务，针对公式优化
             * - 速度快，成本低
             * - 但灵活性较低
             * 
             * AIModelConverter (LLM)：
             * - 通用 AI 模型，理解能力强
             * - 可处理复杂图表、混合内容
             * - 可自定义 prompt
             * - 成本较高，速度较慢
             * - 需要 API Key
             * 
             * 建议：
             * - 简单公式：使用 SimpleTex/Texify
             * - 复杂图表：使用 LLM
             * - 成本敏感：使用专用服务
             */
            expect(true).toBe(true);
        });
    });
});
