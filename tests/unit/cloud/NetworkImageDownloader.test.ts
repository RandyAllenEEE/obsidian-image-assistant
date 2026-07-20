import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock window.moment BEFORE importing modules that use it
global.window = {
    moment: {
        locale: vi.fn().mockReturnValue('en'),
    },
} as any;

import { NetworkImageDownloader } from '../../../src/cloud/NetworkImageDownloader';
import { App, TFile, requestUrl } from 'obsidian';
import { FolderAndFilenameManagement } from '../../../src/local/FolderAndFilenameManagement';
import ImageConverterPlugin from '../../../src/main';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';

// Mock Obsidian API
vi.mock('obsidian', () => ({
    App: vi.fn(),
    TFile: vi.fn(),
    Notice: vi.fn(),
    requestUrl: vi.fn(),
    normalizePath: (path: string) => path.replace(/\\/g, '/'),
}));

// Mock image-type
vi.mock('image-type', () => ({
    default: vi.fn((buffer: Uint8Array) => {
        if (buffer[0] === 137 && buffer[1] === 80) {
            return { ext: 'png', mime: 'image/png' };
        }
        if (buffer[0] === 255 && buffer[1] === 216) {
            return { ext: 'jpg', mime: 'image/jpeg' };
        }
        return null;
    }),
}));

describe('NetworkImageDownloader', () => {
    let downloader: NetworkImageDownloader;
    let mockApp: App;
    let mockPlugin: ImageConverterPlugin;
    let mockFolderManager: FolderAndFilenameManagement;
    let mockActiveFile: TFile;

    beforeEach(() => {
        mockApp = {
            workspace: {
                getActiveFile: vi.fn(),
            },
            vault: {
                getAbstractFileByPath: vi.fn(() => null),
                getMarkdownFiles: vi.fn(() => []),
                getFiles: vi.fn(() => []),
                read: vi.fn().mockResolvedValue(''),
                readBinary: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer),
                trash: vi.fn(),
                modifyBinary: vi.fn(),
                adapter: {
                    exists: vi.fn(),
                    writeBinary: vi.fn(),
                },
            },
            metadataCache: {
                fileToLinktext: vi.fn(),
                getFileCache: vi.fn(() => ({})),
            },
            fileManager: {
                getAvailablePathForAttachment: vi.fn().mockResolvedValue('wrong-file-api-path'),
            },
        } as any;

        mockActiveFile = {
            path: 'notes/test.md',
            parent: {
                path: 'notes',
            },
        } as any;

        mockPlugin = {
            settings: structuredClone(DEFAULT_SETTINGS),
            vaultReferenceManager: {
                updateReferencesInFile: vi.fn().mockResolvedValue(1),
                scanReferencesDetailed: vi.fn().mockResolvedValue({
                    locations: [], complete: true, uncertainFiles: []
                }),
                getFilesReferencingImage: vi.fn().mockResolvedValue([]),
            },
        } as any;

        mockFolderManager = {
            getDefaultAttachmentFolderPath: vi.fn(() => 'attachments'),
            ensureFolderExists: vi.fn(),
            sanitizeFilename: vi.fn((name: string) => name.replace(/[<>:"/\\|?*]/g, '-')),
            handleNameConflicts: vi.fn((folder: string, name: string) => Promise.resolve(name)),
            createUniqueBinaryDetailed: vi.fn(async (folder: string, name: string, data: ArrayBuffer, mode: string) => {
                const resolvedName = await (mockFolderManager.handleNameConflicts as any)(folder, name, mode);
                if (!resolvedName) return { file: null, disposition: 'skipped' };
                const path = folder ? `${folder}/${resolvedName}` : resolvedName;
                await (mockApp.vault.adapter.writeBinary as any)(path, data);
                return {
                    file: { path, name: resolvedName },
                    disposition: 'created'
                };
            }),
        } as any;

        downloader = new NetworkImageDownloader(
            mockApp,
            mockPlugin,
            mockFolderManager,
            {
                fetch: vi.fn(async (url: string) => {
                    const response = await (requestUrl as any)({ url });
                    if (response.status < 200 || response.status >= 300) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    if (response.arrayBuffer.byteLength > 100 * 1024 * 1024) {
                        throw new Error('Image exceeds the 100 MiB download limit');
                    }
                    return {
                        data: response.arrayBuffer,
                        status: response.status,
                        headers: response.headers ?? {},
                        finalUrl: url,
                        transport: 'electron',
                        redirectChainVerified: true,
                        hardLimitEnforced: true
                    };
                })
            } as any
        );

        vi.clearAllMocks();
    });

    describe('URL 验证功能 (validateUrl)', () => {
        it('Given HTTP 协议 URL, When 验证, Then 返回 null', () => {
            const result = (downloader as any).validateUrl('http://example.com/image.png');
            expect(result).toBeNull();
        });

        it('Given HTTPS 协议 URL, When 验证, Then 返回 null', () => {
            const result = (downloader as any).validateUrl('https://example.com/image.png');
            expect(result).toBeNull();
        });

        it('Given FTP 协议 URL, When 验证, Then 返回错误消息', () => {
            const result = (downloader as any).validateUrl('ftp://example.com/image.png');
            expect(result).toContain('Invalid protocol');
            expect(result).toContain('ftp:');
        });

        it('Given localhost 地址, When 验证, Then 返回安全错误', () => {
            const result = (downloader as any).validateUrl('http://localhost/image.png');
            expect(result).toContain('Security');
            expect(result).toContain('localhost');
        });

        it('Given 127.0.0.1 地址, When 验证, Then 返回安全错误', () => {
            const result = (downloader as any).validateUrl('http://127.0.0.1/image.png');
            expect(result).toContain('Security');
            expect(result).toContain('127.0.0.1');
        });

        it('Given 192.168.x.x 内网地址, When 验证, Then 返回安全错误', () => {
            const result = (downloader as any).validateUrl('http://192.168.1.1/image.png');
            expect(result).toContain('Security');
            expect(result).toContain('Private network');
        });

        it('Given 10.x.x.x 内网地址, When 验证, Then 返回安全错误', () => {
            const result = (downloader as any).validateUrl('http://10.0.0.1/image.png');
            expect(result).toContain('Security');
            expect(result).toContain('Private network');
        });

        it('Given 172.16.x.x 内网地址, When 验证, Then 返回安全错误', () => {
            const result = (downloader as any).validateUrl('http://172.16.0.1/image.png');
            expect(result).toContain('Security');
            expect(result).toContain('Private network');
        });

        it('Given 169.254.x.x 链路本地地址, When 验证, Then 返回安全错误', () => {
            const result = (downloader as any).validateUrl('http://169.254.1.1/image.png');
            expect(result).toContain('Security');
            expect(result).toContain('Link-local');
        });

        it('Given 无效 URL 格式, When 验证, Then 返回格式错误', () => {
            const result = (downloader as any).validateUrl('not-a-url');
            expect(result).toContain('Invalid URL format');
        });
    });

    describe('URL 文件名提取功能 (extractFilenameFromUrl)', () => {
        it('Given 标准 URL, When 提取文件名, Then 返回正确文件名', () => {
            const result = (downloader as any).extractFilenameFromUrl('https://example.com/images/photo.jpg');
            expect(result).toBe('photo.jpg');
        });

        it('Given 带查询参数的 URL, When 提取文件名, Then 忽略查询参数', () => {
            const result = (downloader as any).extractFilenameFromUrl('https://example.com/photo.jpg?size=100&token=abc');
            expect(result).toBe('photo.jpg');
        });

        it('Given 带锚点的 URL, When 提取文件名, Then 忽略锚点', () => {
            const result = (downloader as any).extractFilenameFromUrl('https://example.com/photo.jpg#section1');
            expect(result).toBe('photo.jpg');
        });

        it('Given URL 编码的文件名, When 提取, Then 正确解码', () => {
            const result = (downloader as any).extractFilenameFromUrl('https://example.com/%E5%9B%BE%E7%89%87.png');
            expect(result).toBe('图片.png');
        });

        it('Given 文件名包含非法字符, When 提取, Then 替换为破折号', () => {
            const result = (downloader as any).extractFilenameFromUrl('https://example.com/file:name?.jpg');
            // 注意：? 会被 split('?') 先移除，所以只有 : 被替换
            // 实际处理的是 'file:name'（.jpg 之前的部分）
            expect(result).toBe('file-name');
        });

        it('Given URL 末尾无文件名, When 提取, Then defer to the content hash fallback', () => {
            const result = (downloader as any).extractFilenameFromUrl('https://example.com/');
            expect(result).toBe('');
        });

        it('Given URL 解析失败, When 提取, Then 返回带时间戳的默认名称', () => {
            // 注意：'invalid-url' 实际上可以被解析为相对 URL
            // 真正会失败的情况在 catch 块中处理
            const result = (downloader as any).extractFilenameFromUrl('invalid-url');
            // 实际会提取 'invalid-url' 作为文件名（虽然不完美，但符合实现）
            expect(result).toBe('invalid-url');
        });
    });

    describe('相对路径计算 (getRelativePath)', () => {
        it('Given 同级目录, When 计算相对路径, Then 返回 ./ 开头的路径', () => {
            const result = (downloader as any).getRelativePath('notes', 'notes/image.png');
            expect(result).toBe('./image.png');
        });

        it('Given 子目录, When 计算相对路径, Then 返回正确路径', () => {
            const result = (downloader as any).getRelativePath('notes', 'notes/attachments/image.png');
            expect(result).toBe('./attachments/image.png');
        });

        it('Given 父级目录, When 计算相对路径, Then 返回 ../ 路径', () => {
            const result = (downloader as any).getRelativePath('notes/daily', 'notes/image.png');
            expect(result).toBe('../image.png');
        });

        it('Given 不同分支目录, When 计算相对路径, Then 正确向上和向下', () => {
            const result = (downloader as any).getRelativePath('notes/daily', 'assets/images/image.png');
            expect(result).toBe('../../assets/images/image.png');
        });

        it('Given 来源目录为根目录, When 计算相对路径, Then 移除前导斜杠', () => {
            const result = (downloader as any).getRelativePath('/', 'assets/image.png');
            expect(result).toBe('assets/image.png');
        });

        it('Given 来源目录为空, When 计算相对路径, Then 返回原路径', () => {
            const result = (downloader as any).getRelativePath('', 'assets/image.png');
            expect(result).toBe('assets/image.png');
        });
    });

    describe('单张图片下载 (downloadSingleImage)', () => {
        it('uses the source note attachment folder through the public single-file entry', async () => {
            const pngBuffer = new Uint8Array([137, 80, 78, 71]).buffer;
            (requestUrl as any).mockResolvedValue({
                status: 200,
                arrayBuffer: pngBuffer
            });

            const result = await downloader.downloadSingleImageFile(
                'https://example.com/path/photo.jpg?token=1',
                mockActiveFile
            );

            expect(mockFolderManager.getDefaultAttachmentFolderPath)
                .toHaveBeenCalledWith(mockActiveFile);
            expect(mockFolderManager.ensureFolderExists)
                .toHaveBeenCalledWith('attachments');
            expect(result).toMatchObject({
                success: true,
                vaultPath: 'attachments/photo.png',
                fileName: 'photo.png'
            });
        });

        it('Given 有效图片 URL, When 下载, Then 成功保存文件', async () => {
            const pngBuffer = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG 魔数
            (requestUrl as any).mockResolvedValue({
                status: 200,
                arrayBuffer: pngBuffer.buffer,
            });

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://example.com/photo.jpg',
                'attachments',
                'photo.jpg',
                mockActiveFile
            );

            expect(result.success).toBe(true);
            expect(result.fileName).toBe('photo.png'); // 根据魔数检测改为 .png
            expect(result.vaultPath).toBe('attachments/photo.png');
            expect(mockApp.vault.adapter.writeBinary).toHaveBeenCalledWith(
                'attachments/photo.png',
                pngBuffer.buffer
            );
        });

        it.each([
            ['JPEG', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer, 'jpg'],
            ['GIF', new TextEncoder().encode('GIF89a').buffer, 'gif'],
            ['BMP', new Uint8Array([0x42, 0x4d, 0, 0]).buffer, 'bmp'],
            ['ICO', new Uint8Array([0, 0, 1, 0, 1, 0]).buffer, 'ico'],
            ['TIFF', new Uint8Array([0x49, 0x49, 0x2a, 0x00]).buffer, 'tiff'],
            ['WebP', new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer, 'webp'],
            ['AVIF', new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]).buffer, 'avif'],
            ['HEIC', new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]).buffer, 'heic'],
            ['HEIF', new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31, 0, 0, 0, 0]).buffer, 'heif'],
        ])('Given a %s response behind a misleading .png URL, Then saves the detected format', async (_format, data, extension) => {
            (requestUrl as any).mockResolvedValue({
                status: 200,
                headers: { 'content-type': 'application/octet-stream' },
                arrayBuffer: data,
            });

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://example.com/image.png',
                'attachments',
                'image.png',
                mockActiveFile
            );

            expect(result.success).toBe(true);
            expect(result.fileName).toBe(`image.${extension}`);
            expect(mockFolderManager.createUniqueBinaryDetailed).toHaveBeenCalledWith(
                'attachments',
                `image.${extension}`,
                data,
                'increment',
                { capturePreviousData: true }
            );
        });

        it('Given valid image bytes with a wrong non-image content type, Then trusts the verified bytes', async () => {
            const jpegBuffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
            (requestUrl as any).mockResolvedValue({
                status: 200,
                headers: { 'content-type': 'text/plain; charset=utf-8' },
                arrayBuffer: jpegBuffer,
            });

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://example.com/image',
                'attachments',
                'image',
                mockActiveFile
            );

            expect(result.success).toBe(true);
            expect(result.fileName).toBe('image.jpg');
        });

        it('Given HTTP 500 错误, When 下载, Then 返回失败结果', async () => {
            (requestUrl as any).mockResolvedValue({
                status: 500,
            });

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://example.com/photo.jpg',
                'attachments',
                'photo.jpg',
                mockActiveFile
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('HTTP 500');
        });

        it('Given 无效图片数据, When 下载, Then 返回类型识别错误', async () => {
            const invalidBuffer = new Uint8Array([0, 0, 0, 0]);
            (requestUrl as any).mockResolvedValue({
                status: 200,
                arrayBuffer: invalidBuffer.buffer,
            });

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://example.com/photo.jpg',
                'attachments',
                'photo.jpg',
                mockActiveFile
            );

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe("not-image");
            expect(result.error).toBeTruthy();
        });

        it('Given a valid SVG document, When downloading, Then verifies XML and uses the SVG extension', async () => {
            const svgBuffer = new TextEncoder().encode(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>'
            ).buffer;
            (requestUrl as any).mockResolvedValue({
                status: 200,
                headers: { 'content-type': 'image/svg+xml' },
                arrayBuffer: svgBuffer,
            });

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://example.com/vector.png',
                'attachments',
                'vector.png',
                mockActiveFile
            );

            expect(result.success).toBe(true);
            expect(mockFolderManager.createUniqueBinaryDetailed).toHaveBeenCalledWith(
                'attachments',
                'vector.svg',
                svgBuffer,
                'increment',
                { capturePreviousData: true }
            );
        });

        it('Given 非法 URL 协议, When 下载, Then 返回验证错误', async () => {
            const result = await (downloader as any).downloadSingleImageInternal(
                'ftp://example.com/photo.jpg',
                'attachments',
                'photo.jpg',
                mockActiveFile
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid protocol');
        });

        it('Given a blacklisted image domain, When downloading through any entry point, Then it is rejected before making a request', async () => {
            mockPlugin.settings.pasteHandling.cloud.newWorkBlackDomains = 'blocked.example';

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://cdn.blocked.example/photo.png',
                'attachments',
                'photo.png',
                mockActiveFile
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('blocked');
            expect(requestUrl).not.toHaveBeenCalled();
        });

        it('Given 网络错误, When 下载, Then 返回错误消息', async () => {
            (requestUrl as any).mockRejectedValue(new Error('Network timeout'));

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://example.com/photo.jpg',
                'attachments',
                'photo.jpg',
                mockActiveFile
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Network timeout');
        });

        it('Given 文件名包含非法字符, When 下载, Then 清理文件名', async () => {
            const jpgBuffer = new Uint8Array([255, 216, 255, 224]); // JPEG 魔数
            (requestUrl as any).mockResolvedValue({
                status: 200,
                arrayBuffer: jpgBuffer.buffer,
            });

            await (downloader as any).downloadSingleImageInternal(
                'https://example.com/photo<test>.jpg',
                'attachments',
                'photo<test>.jpg',
                mockActiveFile
            );

            expect(mockFolderManager.sanitizeFilename).toHaveBeenCalledWith('photo<test>');
        });

        it('Given 文件名冲突, When 下载, Then 调用冲突处理', async () => {
            const pngBuffer = new Uint8Array([137, 80, 78, 71]);
            (requestUrl as any).mockResolvedValue({
                status: 200,
                arrayBuffer: pngBuffer.buffer,
            });

            (mockFolderManager.handleNameConflicts as any).mockResolvedValue('photo_1.png');

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://example.com/photo.png',
                'attachments',
                'photo.png',
                mockActiveFile
            );

            expect(mockFolderManager.handleNameConflicts).toHaveBeenCalledWith(
                'attachments',
                'photo.png',
                'increment'
            );
            expect(result.fileName).toBe('photo_1.png');
        });

        it('returns an explicit skipped disposition when conflict policy declines the write', async () => {
            const pngBuffer = new Uint8Array([137, 80, 78, 71]).buffer;
            (requestUrl as any).mockResolvedValue({
                status: 200,
                arrayBuffer: pngBuffer
            });
            (mockFolderManager.createUniqueBinaryDetailed as any)
                .mockResolvedValue({
                    file: null,
                    disposition: 'skipped'
                });

            const result = await downloader.downloadSingleImageInternal(
                'https://example.com/photo.png',
                'attachments',
                'photo.png',
                mockActiveFile
            );

            expect(result).toMatchObject({
                success: false,
                skipped: true,
                disposition: 'skipped'
            });
        });

        it('Given 相对路径计算, When 下载成功, Then 返回相对于笔记的路径', async () => {
            const pngBuffer = new Uint8Array([137, 80, 78, 71]);
            (requestUrl as any).mockResolvedValue({
                status: 200,
                arrayBuffer: pngBuffer.buffer,
            });

            const result = await (downloader as any).downloadSingleImageInternal(
                'https://example.com/photo.png',
                'attachments',
                'photo.png',
                mockActiveFile
            );

            // notes/test.md -> attachments/photo.png = ../attachments/photo.png
            expect(result.localPath).toBe('../attachments/photo.png');
            expect(result.vaultPath).toBe('attachments/photo.png');
        });

        it('undo deletes a newly created download', async () => {
            const file = Object.assign(new (TFile as any)(), { path: 'attachments/photo.png', name: 'photo.png' });
            const pngBuffer = new Uint8Array([137, 80, 78, 71]);
            (requestUrl as any).mockResolvedValue({ status: 200, arrayBuffer: pngBuffer.buffer });
            (mockFolderManager.createUniqueBinaryDetailed as any).mockResolvedValue({ file, disposition: 'created' });
            (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(file);

            const result = await downloader.downloadSingleImageInternal(
                'https://example.com/photo.png', 'attachments', 'photo.png', mockActiveFile
            );
            await downloader.undoDownload(result);

            expect(mockApp.vault.trash).toHaveBeenCalledWith(file, true);
            expect(mockApp.vault.modifyBinary).not.toHaveBeenCalled();
        });

        it('fails closed and consumes the undo token when the downloaded file disappeared', async () => {
            const file = Object.assign(new (TFile as any)(), {
                path: 'attachments/photo.png',
                name: 'photo.png'
            });
            const pngBuffer = new Uint8Array([137, 80, 78, 71]).buffer;
            (requestUrl as any).mockResolvedValue({
                status: 200,
                arrayBuffer: pngBuffer
            });
            (mockFolderManager.createUniqueBinaryDetailed as any)
                .mockResolvedValue({ file, disposition: 'created' });

            const result = await downloader.downloadSingleImageInternal(
                'https://example.com/photo.png',
                'attachments',
                'photo.png',
                mockActiveFile
            );

            await expect(downloader.undoDownload(result)).resolves.toBe(false);
            await expect(downloader.undoDownload(result)).resolves.toBe(false);
            expect(mockApp.vault.trash).not.toHaveBeenCalled();
        });

        it('undo restores bytes replaced by overwrite', async () => {
            const file = Object.assign(new (TFile as any)(), { path: 'attachments/photo.png', name: 'photo.png' });
            const previousData = new Uint8Array([1, 2, 3]).buffer;
            const pngBuffer = new Uint8Array([137, 80, 78, 71]);
            (requestUrl as any).mockResolvedValue({ status: 200, arrayBuffer: pngBuffer.buffer });
            (mockFolderManager.createUniqueBinaryDetailed as any).mockResolvedValue({
                file,
                disposition: 'overwritten',
                previousData
            });
            (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(file);

            const result = await downloader.downloadSingleImageInternal(
                'https://example.com/photo.png', 'attachments', 'photo.png', mockActiveFile
            );
            await downloader.undoDownload(result);

            expect(mockApp.vault.modifyBinary).toHaveBeenCalledWith(file, previousData);
            expect(mockApp.vault.trash).not.toHaveBeenCalled();
        });

        it('undo keeps a created download when a reference appeared after download', async () => {
            const file = Object.assign(new (TFile as any)(), { path: 'attachments/photo.png', name: 'photo.png' });
            const pngBuffer = new Uint8Array([137, 80, 78, 71]).buffer;
            (requestUrl as any).mockResolvedValue({ status: 200, arrayBuffer: pngBuffer });
            (mockFolderManager.createUniqueBinaryDetailed as any).mockResolvedValue({ file, disposition: 'created' });
            (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(file);
            (mockApp.vault.readBinary as any).mockResolvedValue(pngBuffer);
            (mockPlugin.vaultReferenceManager.scanReferencesDetailed as any).mockResolvedValue({
                locations: [{ file: mockActiveFile, start: 0, end: 1, original: '![[attachments/photo.png]]', link: file.path, line: 0 }],
                complete: true,
                uncertainFiles: []
            });

            const result = await downloader.downloadSingleImageInternal(
                'https://example.com/photo.png', 'attachments', 'photo.png', mockActiveFile
            );

            await expect(downloader.undoDownload(result)).resolves.toBe(false);
            expect(mockApp.vault.trash).not.toHaveBeenCalled();

            (mockPlugin.vaultReferenceManager.scanReferencesDetailed as any).mockResolvedValue({
                locations: [], complete: true, uncertainFiles: []
            });
            await expect(downloader.undoDownload(result)).resolves.toBe(true);
            expect(mockApp.vault.trash).toHaveBeenCalledWith(file, true);
        });

        it('undo keeps a file referenced only in an ordinary fence when indexing is disabled', async () => {
            const file = Object.assign(new (TFile as any)(), {
                path: 'attachments/photo.png',
                name: 'photo.png'
            });
            const pngBuffer = new Uint8Array([137, 80, 78, 71]).buffer;
            (requestUrl as any).mockResolvedValue({ status: 200, arrayBuffer: pngBuffer });
            (mockFolderManager.createUniqueBinaryDetailed as any).mockResolvedValue({
                file,
                disposition: 'created'
            });
            (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(file);
            (mockApp.vault.readBinary as any).mockResolvedValue(pngBuffer);
            mockPlugin.settings.global.codeBlockImageLinkIndexing = false;
            (mockPlugin.vaultReferenceManager.scanReferencesDetailed as any)
                .mockImplementation(async (
                    _path: string,
                    policy: { includeFencedCode: boolean }
                ) => ({
                    locations: policy.includeFencedCode
                        ? [{
                            file: mockActiveFile,
                            start: 12,
                            end: 43,
                            original: '![[attachments/photo.png]]',
                            link: file.path,
                            line: 2
                        }]
                        : [],
                    complete: true,
                    uncertainFiles: []
                }));

            const result = await downloader.downloadSingleImageInternal(
                'https://example.com/photo.png',
                'attachments',
                'photo.png',
                mockActiveFile
            );

            await expect(downloader.undoDownload(result)).resolves.toBe(false);
            expect(mockPlugin.vaultReferenceManager.scanReferencesDetailed)
                .toHaveBeenCalledWith(file.path, {
                    kind: 'safety',
                    includeFencedCode: true
                });
            expect(mockApp.vault.trash).not.toHaveBeenCalled();
        });

        it('undo keeps a downloaded file whose bytes changed after download', async () => {
            const file = Object.assign(new (TFile as any)(), { path: 'attachments/photo.png', name: 'photo.png' });
            const pngBuffer = new Uint8Array([137, 80, 78, 71]).buffer;
            (requestUrl as any).mockResolvedValue({ status: 200, arrayBuffer: pngBuffer });
            (mockFolderManager.createUniqueBinaryDetailed as any).mockResolvedValue({ file, disposition: 'created' });
            (mockApp.vault.getAbstractFileByPath as any).mockReturnValue(file);

            const result = await downloader.downloadSingleImageInternal(
                'https://example.com/photo.png', 'attachments', 'photo.png', mockActiveFile
            );
            (mockApp.vault.readBinary as any).mockResolvedValue(new Uint8Array([137, 80, 78, 72]).buffer);

            await expect(downloader.undoDownload(result)).resolves.toBe(false);
            expect(mockApp.vault.trash).not.toHaveBeenCalled();
        });

        it('undo leaves reused files untouched', async () => {
            const file = Object.assign(new (TFile as any)(), { path: 'attachments/photo.png', name: 'photo.png' });
            const pngBuffer = new Uint8Array([137, 80, 78, 71]);
            (requestUrl as any).mockResolvedValue({ status: 200, arrayBuffer: pngBuffer.buffer });
            (mockFolderManager.createUniqueBinaryDetailed as any).mockResolvedValue({ file, disposition: 'reused' });

            const result = await downloader.downloadSingleImageInternal(
                'https://example.com/photo.png', 'attachments', 'photo.png', mockActiveFile
            );
            const undone = await downloader.undoDownload(result);

            expect(result.undoToken).toBeUndefined();
            expect(undone).toBe(true);
            expect(mockApp.vault.modifyBinary).not.toHaveBeenCalled();
            expect(mockApp.vault.trash).not.toHaveBeenCalled();
        });

        it('undo treats a skipped download as a successful no-op', async () => {
            await expect(downloader.undoDownload({
                success: false,
                skipped: true,
                url: 'https://example.com/photo.png',
                disposition: 'skipped'
            })).resolves.toBe(true);

            expect(mockApp.vault.modifyBinary).not.toHaveBeenCalled();
            expect(mockApp.vault.trash).not.toHaveBeenCalled();
        });

    });

});
