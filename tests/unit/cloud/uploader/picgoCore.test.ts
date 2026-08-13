import { describe, it, expect, beforeEach, vi } from 'vitest';
import PicGoCoreUploader from '../../../../src/cloud/uploader/picgoCore';
import ImageAssistantPlugin from '../../../../src/main';
import { FileSystemAdapter, normalizePath } from 'obsidian';
import { EventEmitter } from 'events';
import crossSpawn from 'cross-spawn';

vi.mock('cross-spawn', () => ({ default: vi.fn() }));

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
    getLastImage: vi.fn(),
}));

describe('PicGoCoreUploader', () => {
    let uploader: PicGoCoreUploader;
    let mockPlugin: ImageAssistantPlugin;
    let mockSettings: any;
    let mockExec: any;

    beforeEach(() => {
        const cloudSettings = {
            uploader: 'PicGo-Core',
            picgoCorePath: '',
            uploadServer: '',
            deleteServer: '',
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

        const mockAdapter = {
            getBasePath: vi.fn().mockReturnValue('/vault/path'),
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
            expect(uploader.settings).toBe(mockPlugin.settings.pasteHandling.cloud);
        });

        it('Given 未配置 picgoCorePath, When 初始化, Then 使用默认值', () => {
            expect(mockSettings.picgoCorePath).toBe('');
        });
    });

    describe('文件路径转换逻辑', () => {
        it('Given Image 对象数组, When 上传, Then 转换为绝对路径', async () => {
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
            const args = execSpy.mock.calls[0][1];
            expect(args).toEqual(['upload', '/vault/path/attachments/image1.png', '/vault/path/attachments/image2.png']);
        });

        it('Given 字符串路径数组, When 上传, Then 原样使用', async () => {
            const fileList = ['/absolute/path/image1.png', '/absolute/path/image2.png'];

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image1.png\nhttps://example.com/image2.png'
            );

            await uploader.upload(fileList);

            const args = execSpy.mock.calls[0][1];
            expect(args).toEqual(['upload', '/absolute/path/image1.png', '/absolute/path/image2.png']);
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

            const args = execSpy.mock.calls[0][1];
            expect(args).toEqual(['upload', '/vault/path/attachments/image1.png', '/absolute/path/image2.png']);
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

            expect(execSpy).toHaveBeenCalledWith('picgo', ['upload', '/path/image.png']);
        });

        it('Given 配置了 picgoCorePath, When 上传, Then 使用自定义路径', async () => {
            const fileList = ['/path/image.png'];
            mockSettings.picgoCorePath = '/custom/path/picgo';

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image.png'
            );

            await uploader.upload(fileList);

            expect(execSpy).toHaveBeenCalledWith('/custom/path/picgo', ['upload', '/path/image.png']);
        });

        it('Given 文件路径包含空格, When 构建命令, Then 正确引号包裹', async () => {
            const fileList = ['/path/my image.png'];

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image.png'
            );

            await uploader.upload(fileList);

            expect(execSpy).toHaveBeenCalledWith('picgo', ['upload', '/path/my image.png']);
        });

        it('Given 多个文件, When 构建命令, Then 空格分隔路径', async () => {
            const fileList = ['/path/image1.png', '/path/image2.png', '/path/image3.png'];

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image1.png\nhttps://example.com/image2.png\nhttps://example.com/image3.png'
            );

            await uploader.upload(fileList);

            expect(execSpy).toHaveBeenCalledWith('picgo', [
                'upload',
                '/path/image1.png',
                '/path/image2.png',
                '/path/image3.png'
            ]);
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

            expect(result.success).toBe(false);
        });
    });

    describe('剪贴板上传功能', () => {
        it('Given 剪贴板图片, When 上传, Then 使用 picgo upload 命令', async () => {
            const { getLastImage } = await import('../../../../src/utils');
            (getLastImage as any).mockReturnValue('https://example.com/clipboard.png');

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/clipboard.png'
            );

            const result = await uploader.uploadByClipboard();

            expect(execSpy).toHaveBeenCalledWith('picgo', ['upload']);
            expect(result.success).toBe(true);
            expect(result.result).toEqual(['https://example.com/clipboard.png']);
        });

        it('Given 配置了 picgoCorePath, When 剪贴板上传, Then 使用自定义路径', async () => {
            mockSettings.picgoCorePath = '/usr/local/bin/picgo';

            const { getLastImage } = await import('../../../../src/utils');
            (getLastImage as any).mockReturnValue('https://example.com/clipboard.png');

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/clipboard.png'
            );

            await uploader.uploadByClipboard();

            expect(execSpy).toHaveBeenCalledWith('/usr/local/bin/picgo', ['upload']);
        });

        it('Given 剪贴板上传失败, When 解析响应, Then 返回失败结果', async () => {
            const { getLastImage } = await import('../../../../src/utils');
            (getLastImage as any).mockReturnValue(null);

            vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                '[PicGo ERROR]: No image in clipboard'
            );

            const result = await uploader.uploadByClipboard();

            expect(result.success).toBe(false);
            expect(result.msg).toContain('Please check PicGo-Core config');
        });

        it('Given 剪贴板上传响应包含多行, When 解析, Then 提取最后一张图片', async () => {
            const { getLastImage } = await import('../../../../src/utils');
            const response = 'Log line 1\nLog line 2\nhttps://example.com/image.png';
            (getLastImage as any).mockImplementation((lines: string[]) => {
                return lines[lines.length - 1];
            });

            vi.spyOn(uploader as any, 'exec').mockResolvedValue(response);

            const result = await uploader.uploadByClipboard();

            expect(result.success).toBe(true);
            expect(result.result).toEqual(['https://example.com/image.png']);
        });
    });

    describe('边界情况和错误处理', () => {
        it('terminates a PicGo-Core process that exceeds the upload timeout', async () => {
            vi.useFakeTimers();
            try {
                const child = new EventEmitter() as EventEmitter & {
                    stdout: EventEmitter;
                    stderr: EventEmitter;
                    kill: ReturnType<typeof vi.fn>;
                };
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                child.kill = vi.fn();
                vi.mocked(crossSpawn).mockReturnValue(child as any);

                const execution = expect((uploader as any).exec('picgo', ['upload', '/path/image.png']))
                    .rejects.toThrow('timed out after 60 seconds');
                await vi.advanceTimersByTimeAsync(60_000);

                await execution;
                expect(child.kill).toHaveBeenCalledOnce();
            } finally {
                vi.useRealTimers();
            }
        });

        it('Given 空文件列表, When 上传, Then 返回失败且不启动进程', async () => {
            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue('');

            const result = await uploader.upload([]);

            expect(result.success).toBe(false);
            expect(result.msg).toContain('No files');
            expect(result.result).toEqual([]);
            expect(execSpy).not.toHaveBeenCalled();
        });

        it('Given 响应只有换行符, When 解析, Then 返回空结果', async () => {
            vi.spyOn(uploader as any, 'exec').mockResolvedValue('\n\n\n');

            const result = await uploader.upload(['/path/image.png']);

            expect(result.success).toBe(false);
            expect(result.result).toEqual([]);
        });

        it('Given 文件路径包含引号, When 构建命令, Then 正确转义', async () => {
            const fileList = ['/path/"quoted".png'];

            const execSpy = vi.spyOn(uploader as any, 'exec').mockResolvedValue(
                'https://example.com/image.png'
            );

            await uploader.upload(fileList);

            expect(execSpy).toHaveBeenCalledWith('picgo', ['upload', '/path/"quoted".png']);
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
            const { getLastImage } = await import('../../../../src/utils');
            (getLastImage as any).mockReturnValue(null);

            vi.spyOn(uploader as any, 'exec').mockResolvedValue('[PicGo INFO]: 剪贴板无图片');

            const result = await uploader.uploadByClipboard();

            expect(result.success).toBe(false);
        });
    });

});
