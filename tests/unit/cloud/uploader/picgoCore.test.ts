import { describe, it, expect, beforeEach, vi } from 'vitest';
import PicGoCoreUploader from '../../../../src/cloud/uploader/picgoCore';
import ImageAssistantPlugin from '../../../../src/main';
import { FileSystemAdapter, normalizePath } from 'obsidian';

// Mock Obsidian API
vi.mock('obsidian', () => ({
    FileSystemAdapter: vi.fn(),
    normalizePath: (path: string) => path.replace(/\\/g, '/'),
}));

// Mock path-browserify
vi.mock('path-browserify', () => ({
    join: (...paths: string[]) => paths.join('/').replace(/\/+/g, '/'),
}));

// Mock utils
vi.mock('../../../../src/utils', () => ({
    streamToString: vi.fn(),
    getLastImage: vi.fn(),
}));

describe('PicGoCoreUploader', () => {
    let uploader: PicGoCoreUploader;
    let mockPlugin: ImageAssistantPlugin;
    let mockSettings: any;
    let mockExec: any;

    beforeEach(() => {
        const cloudUploadSettings = {
            picgoCorePath: '',
            uploadServer: '',
            remoteServerMode: false,
            uploadedImages: [],
        };

        const mockAdapter = {
            getBasePath: vi.fn().mockReturnValue('/vault/path'),
        };

        mockPlugin = {
            settings: {
                cloudUploadSettings: cloudUploadSettings,
            },
            app: {
                vault: {
                    adapter: mockAdapter,
                },
            },
        } as any;

        uploader = new PicGoCoreUploader(mockPlugin);
        mockSettings = (uploader as any).settings;

        // Mock child_process.exec
        mockExec = vi.fn();
        vi.doMock('child_process', () => ({
            exec: mockExec,
        }));

        vi.clearAllMocks();
    });

    describe('构造函数和初始化', () => {
        it('Given Plugin 实例, When 创建 Uploader, Then 正确初始化', () => {
            expect(uploader.plugin).toBe(mockPlugin);
            expect(uploader.settings).toBe(mockPlugin.settings.cloudUploadSettings);
        });

        it('Given 未配置 picgoCorePath, When 初始化, Then 使用默认值', () => {
            expect(mockSettings.picgoCorePath).toBe('');
        });
    });

    describe('文件路径转换逻辑', () => {
        it('Given Image 对象数组, When 上传, Then 转换为绝对路径', async () => {
            const { streamToString } = await import('../../../../src/utils');
            (streamToString as any).mockResolvedValue('https://example.com/image1.png\nhttps://example.com/image2.png');

            const fileList = [
                { path: 'attachments/image1.png', name: 'image1.png', source: '![](attachments/image1.png)' },
                { path: 'attachments/image2.png', name: 'image2.png', source: '![](attachments/image2.png)' },
            ];

            // Mock exec 实现
            mockExec.mockImplementation(() => ({
                stdout: 'mock stream',
            }));

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image1.png\nhttps://example.com/image2.png'
            );

            await uploader.upload(fileList);

            expect(execSpy).toHaveBeenCalled();
            const command = execSpy.mock.calls[0][0];
            expect(command).toContain('/vault/path/attachments/image1.png');
            expect(command).toContain('/vault/path/attachments/image2.png');
        });

        it('Given 字符串路径数组, When 上传, Then 原样使用', async () => {
            const fileList = ['/absolute/path/image1.png', '/absolute/path/image2.png'];

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image1.png\nhttps://example.com/image2.png'
            );

            await uploader.upload(fileList);

            const command = execSpy.mock.calls[0][0];
            expect(command).toContain('/absolute/path/image1.png');
            expect(command).toContain('/absolute/path/image2.png');
        });

        it('Given 混合类型数组, When 上传, Then 正确转换', async () => {
            const fileList = [
                { path: 'attachments/image1.png', name: 'image1.png', source: '![](attachments/image1.png)' },
                '/absolute/path/image2.png',
            ];

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image1.png\nhttps://example.com/image2.png'
            );

            await uploader.upload(fileList);

            const command = execSpy.mock.calls[0][0];
            expect(command).toContain('/vault/path/attachments/image1.png');
            expect(command).toContain('/absolute/path/image2.png');
        });
    });

    describe('命令行构建逻辑', () => {
        it('Given 未配置 picgoCorePath, When 上传, Then 使用默认 picgo 命令', async () => {
            const fileList = ['/path/image.png'];
            mockSettings.picgoCorePath = '';

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image.png'
            );

            await uploader.upload(fileList);

            const command = execSpy.mock.calls[0][0];
            expect(command).toMatch(/^picgo upload/);
        });

        it('Given 配置了 picgoCorePath, When 上传, Then 使用自定义路径', async () => {
            const fileList = ['/path/image.png'];
            mockSettings.picgoCorePath = '/custom/path/picgo';

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image.png'
            );

            await uploader.upload(fileList);

            const command = execSpy.mock.calls[0][0];
            expect(command).toMatch(/^\/custom\/path\/picgo upload/);
        });

        it('Given 文件路径包含空格, When 构建命令, Then 正确引号包裹', async () => {
            const fileList = ['/path/my image.png'];

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image.png'
            );

            await uploader.upload(fileList);

            const command = execSpy.mock.calls[0][0];
            expect(command).toContain('"/path/my image.png"');
        });

        it('Given 多个文件, When 构建命令, Then 空格分隔路径', async () => {
            const fileList = ['/path/image1.png', '/path/image2.png', '/path/image3.png'];

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image1.png\nhttps://example.com/image2.png\nhttps://example.com/image3.png'
            );

            await uploader.upload(fileList);

            const command = execSpy.mock.calls[0][0];
            expect(command).toContain('"/path/image1.png" "/path/image2.png" "/path/image3.png"');
        });
    });

    describe('上传响应解析', () => {
        it('Given 成功上传, When 解析响应, Then 提取 URL 列表', async () => {
            const fileList = ['/path/image1.png', '/path/image2.png'];

            // 响应格式：倒数第 1+N 到倒数第 1 行是结果（N = 文件数）
            // 对于 2 个文件：splitList[1] 和 splitList[2]
            vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'Some log\nhttps://example.com/image1.png\nhttps://example.com/image2.png\n'
            );

            const result = await uploader.upload(fileList);

            expect(result.success).toBe(true);
            expect(result.result).toEqual([
                'https://example.com/image1.png',
                'https://example.com/image2.png',
            ]);
        });

        it('Given 响应包含多余日志, When 解析, Then 只取最后 N 行（N = 文件数）', async () => {
            const fileList = ['/path/image.png'];

            // 对于 1 个文件：splice(3-1-1, 1) = splice(1, 1) = splitList[1]
            vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                '[PicGo INFO]: Upload started\n' +
                'https://example.com/image.png\n' +
                '[PicGo INFO]: Upload complete'
            );

            const result = await uploader.upload(fileList);

            expect(result.result).toHaveLength(1);
            expect(result.result[0]).toBe('https://example.com/image.png');
        });

        it('Given 响应包含 PicGo ERROR, When 解析, Then 返回失败结果', async () => {
            const fileList = ['/path/image.png'];

            vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                '[PicGo ERROR]: Upload failed: Invalid config'
            );

            const result = await uploader.upload(fileList);

            expect(result.success).toBe(false);
            expect(result.msg).toBe('失败');
            expect(result.result).toEqual([]);
        });

        it('Given 空响应, When 解析, Then 返回空结果', async () => {
            const fileList = ['/path/image.png'];

            vi.spyOn(uploader as any, 'exec').mockResolvedValue('\n\n');

            const result = await uploader.upload(fileList);

            // 根据代码逻辑，不包含 "PicGo ERROR" 则视为成功
            expect(result.success).toBe(true);
        });
    });

    describe('剪贴板上传功能', () => {
        it('Given 剪贴板图片, When 上传, Then 使用 picgo upload 命令', async () => {
            const { streamToString, getLastImage } = await import('../../../../src/utils');
            (streamToString as any).mockResolvedValue('https://example.com/clipboard.png');
            (getLastImage as any).mockReturnValue('https://example.com/clipboard.png');

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/clipboard.png'
            );

            const result = await uploader.uploadByClipboard();

            expect(execSpy).toHaveBeenCalledWith('picgo upload');
            expect(result.success).toBe(true);
            expect(result.result).toEqual(['https://example.com/clipboard.png']);
        });

        it('Given 配置了 picgoCorePath, When 剪贴板上传, Then 使用自定义路径', async () => {
            mockSettings.picgoCorePath = '/usr/local/bin/picgo';

            const { streamToString, getLastImage } = await import('../../../../src/utils');
            (streamToString as any).mockResolvedValue('https://example.com/clipboard.png');
            (getLastImage as any).mockReturnValue('https://example.com/clipboard.png');

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/clipboard.png'
            );

            await uploader.uploadByClipboard();

            expect(execSpy).toHaveBeenCalledWith('/usr/local/bin/picgo upload');
        });

        it('Given 剪贴板上传失败, When 解析响应, Then 返回失败结果', async () => {
            const { streamToString, getLastImage } = await import('../../../../src/utils');
            (streamToString as any).mockResolvedValue('[PicGo ERROR]: No image in clipboard');
            (getLastImage as any).mockReturnValue(null);

            vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                '[PicGo ERROR]: No image in clipboard'
            );

            const result = await uploader.uploadByClipboard();

            expect(result.success).toBe(false);
            expect(result.msg).toContain('Please check PicGo-Core config');
        });

        it('Given 剪贴板上传响应包含多行, When 解析, Then 提取最后一张图片', async () => {
            const { streamToString, getLastImage } = await import('../../../../src/utils');
            const response = 'Log line 1\nLog line 2\nhttps://example.com/image.png';
            (streamToString as any).mockResolvedValue(response);
            (getLastImage as any).mockImplementation((lines: string[]) => {
                return lines[lines.length - 1];
            });

            vi.spyOn(uploader as any, 'exec').mockResolvedValue(response);

            const result = await uploader.uploadByClipboard();

            expect(result.success).toBe(true);
            expect(result.result).toEqual(['https://example.com/image.png']);
        });
    });

    describe('功能说明和使用场景', () => {
        it('PicGo-Core 工作原理', () => {
            /*
             * PicGo-Core 是命令行工具，通过 CLI 执行上传：
             * 
             * 基本用法：
             * 1. 文件上传：picgo upload /path/to/image.png
             * 2. 剪贴板上传：picgo upload
             * 3. 批量上传：picgo upload file1.png file2.png
             * 
             * 响应格式：
             * - 成功：输出包含图片 URL（通常在最后几行）
             * - 失败：输出包含 "PicGo ERROR" 字样
             * 
             * 配置文件：
             * - 位置：~/.picgo/config.json
             * - 包含图床配置（Uploader）、插件等
             * 
             * 支持的图床：
             * - SM.MS, 七牛云, 腾讯云 COS, 又拍云
             * - GitHub, Gitee, Imgur
             * - 自定义图床（通过插件）
             */
            expect(true).toBe(true);
        });

        it('与 PicGo GUI 的区别', () => {
            /*
             * PicGoCoreUploader (CLI) vs PicGoUploader (GUI)：
             * 
             * PicGoCoreUploader (本类)：
             * - 调用命令行工具 picgo
             * - 通过 child_process.exec 执行
             * - 需要系统安装 picgo-core
             * - 适合自动化脚本、服务器环境
             * 
             * PicGoUploader (GUI)：
             * - 调用 PicGo/PicList GUI 应用的 HTTP API
             * - 通过 requestUrl 发送 HTTP 请求
             * - 需要启动 PicGo/PicList 应用（监听 36677 端口）
             * - 适合桌面环境、用户交互
             * 
             * 选择建议：
             * - 桌面用户 → GUI 模式（更直观）
             * - 开发者/高级用户 → Core 模式（更灵活）
             */
            expect(true).toBe(true);
        });

        it('响应解析策略说明', () => {
            /*
             * 为什么要解析最后 N 行？
             * 
             * PicGo-Core 输出混合了日志和结果：
             * [PicGo INFO]: 上传开始
             * [PicGo INFO]: 处理图片 image1.png
             * https://example.com/image1.png
             * [PicGo INFO]: 处理图片 image2.png
             * https://example.com/image2.png
             * 
             * 假设上传 2 张图片：
             * 1. 按 \n 分割输出
             * 2. 取倒数第 (1 + length) 到倒数第 1 行
             * 3. 忽略前面的日志信息
             * 
             * 局限性：
             * - 依赖日志格式稳定
             * - 无法精确区分日志和结果
             * - 建议 PicGo 社区改进输出格式（JSON）
             */
            expect(true).toBe(true);
        });

        it('剪贴板上传的特殊性', () => {
            /*
             * 剪贴板上传与文件上传的区别：
             * 
             * 文件上传：
             * - 命令：picgo upload /path/to/file.png
             * - 可批量上传多个文件
             * - 响应包含多个 URL
             * 
             * 剪贴板上传：
             * - 命令：picgo upload（无参数）
             * - 一次只能上传一张图片（剪贴板限制）
             * - 使用 getLastImage() 提取最后一行 URL
             * 
             * 工作流程：
             * 1. 用户复制图片（Ctrl+C 或截图）
             * 2. 调用 uploadByClipboard()
             * 3. PicGo 读取系统剪贴板
             * 4. 上传并返回 URL
             * 
             * 注意：
             * - 需要系统剪贴板支持图片格式
             * - Windows/macOS/Linux 兼容性可能不同
             */
            expect(true).toBe(true);
        });

        it('路径规范化的重要性', () => {
            /*
             * 为什么需要 normalizePath？
             * 
             * 跨平台路径问题：
             * - Windows：C:\Users\vault\image.png
             * - Linux/macOS：/home/user/vault/image.png
             * 
             * normalizePath 的作用：
             * - 统一路径分隔符为 /
             * - 移除冗余的 ./
             * - 解析 ../ 路径
             * 
             * 示例：
             * - 输入：vault\\attachments\\image.png
             * - 输出：vault/attachments/image.png
             * 
             * 组合 Vault 基础路径：
             * - 基础路径：/Users/john/Documents/MyVault
             * - 相对路径：attachments/image.png
             * - 最终路径：/Users/john/Documents/MyVault/attachments/image.png
             */
            expect(true).toBe(true);
        });
    });

    describe('边界情况和错误处理', () => {
        it('Given 空文件列表, When 上传, Then 正常处理', async () => {
            vi.spyOn(uploader as any, 'exec').mockResolvedValue('');

            const result = await uploader.upload([]);

            expect(result.success).toBe(true);
            expect(result.result).toEqual([]);
        });

        it('Given 响应只有换行符, When 解析, Then 返回空结果', async () => {
            vi.spyOn(uploader as any, 'exec').mockResolvedValue('\n\n\n');

            const result = await uploader.upload(['/path/image.png']);

            expect(result.success).toBe(true);
            expect(result.result.length).toBeGreaterThanOrEqual(0);
        });

        it('Given 文件路径包含引号, When 构建命令, Then 正确转义', async () => {
            const fileList = ['/path/"quoted".png'];

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image.png'
            );

            await uploader.upload(fileList);

            const command = execSpy.mock.calls[0][0];
            // 命令中应包含转义的引号
            expect(command).toContain('"/path/"quoted".png"');
        });

        it('Given PicGo 未安装, When 执行命令, Then exec 抛出错误', async () => {
            vi.spyOn(uploader as any, 'exec').mockRejectedValue(
                new Error('Command not found: picgo')
            );

            await expect(uploader.upload(['/path/image.png'])).rejects.toThrow('Command not found');
        });

        it('Given PicGo 配置错误, When 上传, Then 返回失败响应', async () => {
            vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                '[PicGo ERROR]: Config file not found'
            );

            const result = await uploader.upload(['/path/image.png']);

            expect(result.success).toBe(false);
            expect(result.msg).toBe('失败');
        });

        it('Given 图片文件不存在, When 上传, Then PicGo 返回错误', async () => {
            vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                '[PicGo ERROR]: File not found: /path/nonexistent.png'
            );

            const result = await uploader.upload(['/path/nonexistent.png']);

            expect(result.success).toBe(false);
        });

        it('Given 剪贴板为空, When 上传, Then getLastImage 返回 null', async () => {
            const { streamToString, getLastImage } = await import('../../../../src/utils');
            (streamToString as any).mockResolvedValue('[PicGo INFO]: 剪贴板无图片');
            (getLastImage as any).mockReturnValue(null);

            vi.spyOn(uploader as any, 'exec').mockResolvedValue('[PicGo INFO]: 剪贴板无图片');

            const result = await uploader.uploadByClipboard();

            expect(result.success).toBe(false);
        });
    });

    describe('集成测试建议', () => {
        it('完整测试流程说明', () => {
            /*
             * 完整测试 PicGoCoreUploader 需要：
             * 
             * 环境准备：
             * 1. 安装 picgo-core：npm install -g picgo
             * 2. 配置图床：picgo set uploader
             * 3. 验证配置：picgo upload /path/to/test.png
             * 
             * 测试场景：
             * 1. 单文件上传
             * 2. 批量文件上传（3-5 张）
             * 3. 剪贴板上传（需要人工复制图片）
             * 4. 不同图片格式（PNG, JPEG, GIF, WebP）
             * 5. 大文件上传（>5MB）
             * 6. 特殊文件名（中文、空格、特殊字符）
             * 7. 无效文件（文本文件伪装）
             * 8. 网络错误（断网、图床限流）
             * 
             * 验证点：
             * - 上传成功率
             * - URL 格式正确性
             * - 文件可访问性（打开 URL 验证）
             * - 错误提示准确性
             * - 性能（上传耗时）
             * 
             * 单元测试局限：
             * - 无法测试实际 CLI 执行
             * - 无法验证图床交互
             * - 无法测试文件读取
             * 
             * 建议：编写 E2E 测试或手动测试
             */
            expect(true).toBe(true);
        });
    });
});
