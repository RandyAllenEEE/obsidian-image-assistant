import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PasteModeConfigModal } from '../../../../src/ui/modals/PasteModeConfigModal';
import { App, TFile, Notice, Modal } from 'obsidian';

// Mock Notice and Modal globally
vi.mock('obsidian', async () => {
    const actual = await vi.importActual('obsidian');
    return {
        ...actual,
        Notice: vi.fn(),
        Modal: class {
            titleEl = { createEl: vi.fn(), setText: vi.fn() };
            contentEl = { 
                createEl: vi.fn().mockReturnValue({ onclick: null }),
                empty: vi.fn(),
                addClass: vi.fn(),
                createDiv: vi.fn().mockReturnValue({
                    createEl: vi.fn().mockReturnValue({ onclick: null }),
                    style: {},
                }),
            };
            app: any;
            constructor(app: any) {
                this.app = app;
            }
            open() {}
            close() {}
        },
    };
});

// Mock translation function
vi.mock('../../../../src/lang/helpers', () => ({
    t: (key: string) => {
        const translations: Record<string, string> = {
            PASTE_MODE_CONFIG_TITLE: 'Configure Paste Mode',
            PASTE_MODE_CONFIG_DESC: 'Set paste mode for current note',
            PASTE_MODE_LOCAL: 'Local Mode',
            PASTE_MODE_CLOUD: 'Cloud Mode',
            PASTE_MODE_REMOVE: 'Use Global Settings',
            PASTE_MODE_CURRENT: 'Current: {0}',
            NOTICE_NO_ACTIVE_FILE: 'No active file',
            NOTICE_PASTE_MODE_SET: 'Paste mode set to {0}',
            NOTICE_PASTE_MODE_GLOBAL: 'Using global paste mode settings',
        };
        return translations[key] || key;
    },
}));

describe('PasteModeConfigModal', () => {
    let modal: PasteModeConfigModal;
    let mockApp: any;
    let mockPlugin: any;
    let mockFile: TFile;

    beforeEach(() => {
        // Mock active file
        mockFile = {
            path: 'notes/test-note.md',
            name: 'test-note.md',
            basename: 'test-note',
            extension: 'md',
        } as TFile;

        // Mock App
        mockApp = {
            workspace: {
                getActiveFile: vi.fn().mockReturnValue(mockFile),
            },
            fileManager: {
                processFrontMatter: vi.fn(),
            },
        };

        // Mock Plugin
        mockPlugin = {
            app: mockApp,
            settings: {
                uploadMethod: 'local',
            },
        };

        modal = new PasteModeConfigModal(mockApp as App, mockPlugin);

        // Clear Notice mock
        vi.mocked(Notice).mockClear();
    });

    // ===== Modal 构造和生命周期 =====
    describe('Modal 构造和生命周期', () => {
        it('Given 创建 Modal 实例, When 初始化, Then 设置正确的 App 和 Plugin', () => {
            expect(modal['app']).toBe(mockApp);
            expect(modal['plugin']).toBe(mockPlugin);
        });

        it('Given 关闭 Modal, When onClose 调用, Then 清空内容', () => {
            const emptySpy = vi.spyOn(modal.contentEl, 'empty');

            modal.onClose();

            expect(emptySpy).toHaveBeenCalled();
        });
    });

    // ===== 设置 Local 模式 =====
    describe('设置 Local 粘贴模式', () => {
        it('Given 活动文件存在, When 设置 local 模式, Then 更新 Frontmatter', async () => {
            const closeSpy = vi.spyOn(modal, 'close');

            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    const fm = {};
                    fn(fm);
                    expect(fm).toEqual({ image_paste_mode: 'local' });
                }
            );

            await modal.setPasteMode('local');

            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
                mockFile,
                expect.any(Function)
            );
            expect(Notice).toHaveBeenCalledWith('Paste mode set to Local');
            expect(closeSpy).toHaveBeenCalled();
        });

        it('Given 无活动文件, When 设置 local 模式, Then 显示错误提示', async () => {
            mockApp.workspace.getActiveFile.mockReturnValue(null);
            const closeSpy = vi.spyOn(modal, 'close');

            await modal.setPasteMode('local');

            expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
            expect(Notice).toHaveBeenCalledWith('No active file');
            expect(closeSpy).not.toHaveBeenCalled();
        });

        it('Given Frontmatter 处理失败, When 设置模式, Then 抛出错误', async () => {
            mockApp.fileManager.processFrontMatter.mockRejectedValue(
                new Error('Failed to update frontmatter')
            );

            await expect(modal.setPasteMode('local')).rejects.toThrow(
                'Failed to update frontmatter'
            );
        });
    });

    // ===== 设置 Cloud 模式 =====
    describe('设置 Cloud 粘贴模式', () => {
        it('Given 活动文件存在, When 设置 cloud 模式, Then 更新 Frontmatter', async () => {
            const closeSpy = vi.spyOn(modal, 'close');

            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    const fm = {};
                    fn(fm);
                    expect(fm).toEqual({ image_paste_mode: 'cloud' });
                }
            );

            await modal.setPasteMode('cloud');

            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
                mockFile,
                expect.any(Function)
            );
            expect(Notice).toHaveBeenCalledWith('Paste mode set to Cloud');
            expect(closeSpy).toHaveBeenCalled();
        });

        it('Given 无活动文件, When 设置 cloud 模式, Then 显示错误提示', async () => {
            mockApp.workspace.getActiveFile.mockReturnValue(null);

            await modal.setPasteMode('cloud');

            expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
            expect(Notice).toHaveBeenCalledWith('No active file');
        });
    });

    // ===== 移除模式覆盖 =====
    describe('移除粘贴模式覆盖', () => {
        it('Given 活动文件有 Frontmatter 覆盖, When 移除, Then 删除字段', async () => {
            const closeSpy = vi.spyOn(modal, 'close');

            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    const fm = { image_paste_mode: 'local', other_field: 'value' };
                    fn(fm);
                    expect(fm).toEqual({ other_field: 'value' });
                }
            );

            await modal.removePasteMode();

            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
                mockFile,
                expect.any(Function)
            );
            expect(Notice).toHaveBeenCalledWith('Using global paste mode settings');
            expect(closeSpy).toHaveBeenCalled();
        });

        it('Given 无活动文件, When 移除模式, Then 显示错误提示', async () => {
            mockApp.workspace.getActiveFile.mockReturnValue(null);
            const closeSpy = vi.spyOn(modal, 'close');

            await modal.removePasteMode();

            expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
            expect(Notice).toHaveBeenCalledWith('No active file');
            expect(closeSpy).not.toHaveBeenCalled();
        });

        it('Given Frontmatter 无覆盖字段, When 移除, Then 仍然执行删除操作', async () => {
            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    const fm = { other_field: 'value' };
                    fn(fm);
                    // delete 一个不存在的字段不会报错
                    expect(fm).toEqual({ other_field: 'value' });
                }
            );

            await modal.removePasteMode();

            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalled();
            expect(Notice).toHaveBeenCalledWith('Using global paste mode settings');
        });
    });

    // ===== Frontmatter 读取验证 =====
    describe('Frontmatter 操作验证', () => {
        it('Given 设置 local 模式, When 读取 Frontmatter, Then 包含正确字段', async () => {
            let savedFrontmatter: any = {};

            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    fn(savedFrontmatter);
                }
            );

            await modal.setPasteMode('local');

            expect(savedFrontmatter).toHaveProperty('image_paste_mode', 'local');
        });

        it('Given 设置 cloud 模式, When 读取 Frontmatter, Then 包含正确字段', async () => {
            let savedFrontmatter: any = {};

            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    fn(savedFrontmatter);
                }
            );

            await modal.setPasteMode('cloud');

            expect(savedFrontmatter).toHaveProperty('image_paste_mode', 'cloud');
        });

        it('Given 移除模式覆盖, When 处理 Frontmatter, Then 删除字段', async () => {
            let savedFrontmatter: any = {
                image_paste_mode: 'local',
                other_field: 'value',
            };

            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    fn(savedFrontmatter);
                }
            );

            await modal.removePasteMode();

            expect(savedFrontmatter).not.toHaveProperty('image_paste_mode');
            expect(savedFrontmatter).toHaveProperty('other_field', 'value');
        });

        it('Given 已有其他 Frontmatter 字段, When 设置模式, Then 保留其他字段', async () => {
            let savedFrontmatter: any = {
                tags: ['test'],
                author: 'user',
            };

            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    fn(savedFrontmatter);
                }
            );

            await modal.setPasteMode('cloud');

            expect(savedFrontmatter).toEqual({
                tags: ['test'],
                author: 'user',
                image_paste_mode: 'cloud',
            });
        });
    });

    // ===== UI 渲染 =====
    describe('UI 渲染', () => {
        it('Given Modal 打开, When 渲染 UI, Then 添加 CSS class', () => {
            const addClassSpy = vi.spyOn(modal.contentEl, 'addClass');

            modal.onOpen();

            expect(addClassSpy).toHaveBeenCalledWith('image-assistant-paste-mode-modal');
        });

        it('Given Modal 打开, When 渲染 UI, Then 创建按钮容器', () => {
            const createDivSpy = vi.spyOn(modal.contentEl, 'createDiv');

            modal.onOpen();

            expect(createDivSpy).toHaveBeenCalledWith({ cls: 'paste-mode-button-container' });
        });
    });

    // ===== 边界情况测试 =====
    describe('边界情况', () => {
        it('Given Frontmatter 包含无效值, When 设置有效值, Then 覆盖无效值', async () => {
            let savedFrontmatter: any = {
                image_paste_mode: 'invalid_mode',
            };

            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    fn(savedFrontmatter);
                }
            );

            await modal.setPasteMode('local');

            expect(savedFrontmatter.image_paste_mode).toBe('local');
        });

        it('Given 快速连续调用 setPasteMode, When 执行, Then 每次都正确处理', async () => {
            mockApp.fileManager.processFrontMatter.mockResolvedValue(undefined);

            const promise1 = modal.setPasteMode('local');
            const promise2 = modal.setPasteMode('cloud');

            await Promise.all([promise1, promise2]);

            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(2);
        });

        it('Given 文件路径包含特殊字符, When 更新 Frontmatter, Then 正常处理', async () => {
            const specialFile = {
                ...mockFile,
                path: 'notes/特殊字符 & symbols.md',
            } as TFile;

            mockApp.workspace.getActiveFile.mockReturnValue(specialFile);
            mockApp.fileManager.processFrontMatter.mockResolvedValue(undefined);

            await modal.setPasteMode('local');

            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
                specialFile,
                expect.any(Function)
            );
        });

        it('Given processFrontMatter 回调中抛出错误, When 设置模式, Then 传播错误', async () => {
            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    const fm = {};
                    fn(fm); // 这里模拟回调内部抛出错误
                    throw new Error('Callback error');
                }
            );

            await expect(modal.setPasteMode('local')).rejects.toThrow('Callback error');
        });
    });

    // ===== 集成场景测试 =====
    describe('集成场景测试', () => {
        it('Given 完整工作流：设置 -> 移除 -> 再设置, When 执行, Then 正确更新', async () => {
            mockApp.fileManager.processFrontMatter.mockResolvedValue(undefined);

            // 1. 设置为 local
            await modal.setPasteMode('local');
            expect(Notice).toHaveBeenNthCalledWith(1, 'Paste mode set to Local');

            // 2. 移除覆盖
            vi.mocked(Notice).mockClear();
            await modal.removePasteMode();
            expect(Notice).toHaveBeenCalledWith('Using global paste mode settings');

            // 3. 设置为 cloud
            vi.mocked(Notice).mockClear();
            await modal.setPasteMode('cloud');
            expect(Notice).toHaveBeenCalledWith('Paste mode set to Cloud');
        });

        it('Given 多个文件切换, When 设置模式, Then 影响当前活动文件', async () => {
            const file1 = { path: 'file1.md' } as TFile;
            const file2 = { path: 'file2.md' } as TFile;

            mockApp.fileManager.processFrontMatter.mockResolvedValue(undefined);

            // 设置 file1
            mockApp.workspace.getActiveFile.mockReturnValue(file1);
            await modal.setPasteMode('local');

            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
                file1,
                expect.any(Function)
            );

            // 切换到 file2
            mockApp.workspace.getActiveFile.mockReturnValue(file2);
            await modal.setPasteMode('cloud');

            expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
                file2,
                expect.any(Function)
            );
        });

        it('Given 全局设置和笔记覆盖不同, When 设置笔记模式, Then 独立于全局设置', async () => {
            mockPlugin.settings.uploadMethod = 'local';

            let savedFrontmatter: any = {};

            mockApp.fileManager.processFrontMatter.mockImplementation(
                async (_file: TFile, fn: (fm: any) => void) => {
                    fn(savedFrontmatter);
                }
            );

            // 设置笔记为 cloud，即使全局是 local
            await modal.setPasteMode('cloud');

            // 验证笔记设置为 cloud
            expect(savedFrontmatter.image_paste_mode).toBe('cloud');
            // 全局设置不变
            expect(mockPlugin.settings.uploadMethod).toBe('local');
        });
    });
});
