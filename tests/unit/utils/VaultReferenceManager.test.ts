import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { ReferenceLocation, VaultReferenceManager } from '../../../src/utils/VaultReferenceManager';
import { ImageLinkPathReplacer } from '../../../src/utils/ImageLinkPathReplacer';
import { fakeApp, fakeMetadataCache, fakeTFile, fakeVault } from '../../factories/obsidian';

/**
 * VaultReferenceManager 单元测试
 * 
 * 注意：由于 VaultReferenceManager 高度依赖 Obsidian 的 App、MetadataCache 和 Vault API，
 * 这些组件的 mock 非常复杂。完整的单元测试需要精确模拟 Obsidian 的内部行为。
 * 
 * 当前测试聚焦于核心数据结构和类型定义的验证。
 * 完整的集成测试应在实际 Obsidian 环境中进行。
 */

describe('VaultReferenceManager', () => {
    describe('ReferenceLocation 类型', () => {
        it('Given 引用位置对象, When 包含所有必需字段, Then 类型验证通过', () => {
            const mockFile = {
                path: 'notes/note.md',
                basename: 'note',
                extension: 'md',
                name: 'note.md'
            } as any;

            const location: ReferenceLocation = {
                file: mockFile,
                start: 10,
                end: 26,
                original: '![[image.png]]',
                link: 'image.png',
                line: 0
            };

            expect(location.file.path).toBe('notes/note.md');
            expect(location.start).toBe(10);
            expect(location.end).toBe(26);
            expect(location.original).toBe('![[image.png]]');
            expect(location.link).toBe('image.png');
            expect(location.line).toBe(0);
        });

        it('Given Wiki链接引用, When 包含尺寸参数, Then 正确存储链接信息', () => {
            const location: ReferenceLocation = {
                file: {} as any,
                start: 0,
                end: 20,
                original: '![[image.png|300]]',
                link: 'image.png|300',
                line: 0
            };

            expect(location.original).toBe('![[image.png|300]]');
            expect(location.link).toBe('image.png|300');
        });

        it('Given Markdown链接引用, When 包含题注, Then 正确存储链接信息', () => {
            const location: ReferenceLocation = {
                file: {} as any,
                start: 5,
                end: 40,
                original: '![My Caption](https://cdn.com/img.png)',
                link: 'https://cdn.com/img.png',
                line: 2
            };

            expect(location.original).toBe('![My Caption](https://cdn.com/img.png)');
            expect(location.link).toBe('https://cdn.com/img.png');
            expect(location.line).toBe(2);
        });
    });

    describe('processUpdates replacement ordering', () => {
        it('replaces multiple references in one file from end to start without shifting earlier offsets', async () => {
            const file = {
                path: 'notes/note.md',
                basename: 'note',
                extension: 'md',
                name: 'note.md'
            } as any;
            let content = '![[a.png]] and ![[a.png|300]]';
            const app = {
                vault: {
                    process: vi.fn(async (_file: any, updater: (current: string) => string) => {
                        content = updater(content);
                        return content;
                    })
                }
            } as any;
            const manager = new VaultReferenceManager(app);
            const locations: ReferenceLocation[] = [
                {
                    file,
                    start: 0,
                    end: '![[a.png]]'.length,
                    original: '![[a.png]]',
                    link: 'a.png',
                    line: 0
                },
                {
                    file,
                    start: '![[a.png]] and '.length,
                    end: content.length,
                    original: '![[a.png|300]]',
                    link: 'a.png|300',
                    line: 0
                }
            ];

            const updated = await (manager as any).processUpdates(
                locations,
                (location: ReferenceLocation) => ImageLinkPathReplacer.replacePath(location.original, 'assets/really-long-name.png')
            );

            expect(updated).toBe(2);
            expect(content).toBe('![[assets/really-long-name.png]] and ![[assets/really-long-name.png|300]]');
        });

        it('does not replace a different image when a stale offset still contains image syntax', async () => {
            const file = { path: 'notes/note.md', name: 'note.md' } as any;
            let content = '![[b.png]]';
            const app = {
                vault: {
                    process: vi.fn(async (_file: any, updater: (current: string) => string) => {
                        content = updater(content);
                        return content;
                    })
                },
                metadataCache: {
                    getFirstLinkpathDest: vi.fn(() => null)
                }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await (manager as any).processUpdatesDetailed([{
                file,
                start: 0,
                end: content.length,
                original: '![[a.png]]',
                link: 'a.png',
                line: 0
            }], () => '![[cloud/a.png]]');

            expect(content).toBe('![[b.png]]');
            expect(result).toMatchObject({ found: 1, replaced: 0, complete: false });
            expect(result.failedFiles).toEqual([file.path]);
        });

        it('replaces ordinary Markdown and Wiki references without changing labels, titles, or aliases', async () => {
            const file = { path: 'notes/note.md', name: 'note.md' } as any;
            const markdown = '[source](a.png "original")';
            const wiki = '[[a.png|Open image]]';
            let content = `${markdown} and ${wiki}`;
            const app = {
                vault: {
                    process: vi.fn(async (_file: any, updater: (current: string) => string) => {
                        content = updater(content);
                        return content;
                    })
                },
                metadataCache: { getFirstLinkpathDest: vi.fn(() => null) }
            } as any;
            const manager = new VaultReferenceManager(app);
            const locations: ReferenceLocation[] = [
                {
                    file,
                    start: 0,
                    end: markdown.length,
                    original: markdown,
                    link: 'a.png',
                    line: 0
                },
                {
                    file,
                    start: markdown.length + 5,
                    end: content.length,
                    original: wiki,
                    link: 'a.png',
                    line: 0
                }
            ];

            const result = await manager.updateReferenceLocationsDetailed(
                locations,
                location => ImageLinkPathReplacer.replacePath(location.original, 'assets/new photo.webp')
            );

            expect(result).toMatchObject({ found: 2, replaced: 2, complete: true });
            expect(content).toBe('[source](<assets/new photo.webp> "original") and [[assets/new photo.webp|Open image]]');
        });

        it('deduplicates identical locations before applying an atomic update', async () => {
            const file = { path: 'notes/note.md', name: 'note.md' } as any;
            let content = '[[a.png]]';
            const process = vi.fn(async (_file: any, updater: (current: string) => string) => {
                content = updater(content);
                return content;
            });
            const manager = new VaultReferenceManager({
                vault: { process },
                metadataCache: { getFirstLinkpathDest: vi.fn(() => null) }
            } as any);
            const location: ReferenceLocation = {
                file,
                start: 0,
                end: content.length,
                original: content,
                link: 'a.png',
                line: 0
            };

            const result = await manager.updateReferenceLocationsDetailed(
                [location, { ...location }],
                current => ImageLinkPathReplacer.replacePath(current.original, 'b.png')
            );

            expect(result).toMatchObject({ found: 1, replaced: 1, complete: true });
            expect(process).toHaveBeenCalledOnce();
            expect(content).toBe('[[b.png]]');
        });

        it('reports a recognized reference as incomplete when the replacement generator cannot change it', async () => {
            const file = { path: 'notes/note.md', name: 'note.md' } as any;
            const content = '<https://cdn.example/photo.png>';
            const manager = new VaultReferenceManager({
                vault: {
                    process: vi.fn(async (_file: any, updater: (current: string) => string) => updater(content))
                }
            } as any);

            const result = await manager.updateReferenceLocationsDetailed([{
                file,
                start: 0,
                end: content.length,
                original: content,
                link: 'https://cdn.example/photo.png',
                line: 0
            }], location => ImageLinkPathReplacer.replacePath(location.original, 'assets/photo.png'));

            expect(result).toMatchObject({ found: 1, replaced: 0, complete: false });
            expect(result.failedFiles).toEqual([file.path]);
        });
    });

    describe('fail-closed bulk scans', () => {
        it('returns references found before a read failure and reports the unreadable note', async () => {
            const readable = { path: 'notes/readable.md', name: 'readable.md' } as any;
            const unreadable = { path: 'notes/unreadable.md', name: 'unreadable.md' } as any;
            const image = Object.assign(new TFile(), { path: 'attachments/photo.png', name: 'photo.png' });
            const app = {
                vault: {
                    getMarkdownFiles: vi.fn(() => [readable, unreadable]),
                    read: vi.fn(async (file: any) => {
                        if (file === unreadable) throw new Error('permission denied');
                        return '![[attachments/photo.png]]';
                    })
                },
                metadataCache: {
                    getFirstLinkpathDest: vi.fn(() => image)
                }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesForTargetsDetailed([
                'attachments/photo.png',
                'attachments/other.png'
            ]);

            expect(result.complete).toBe(false);
            expect(result.uncertainFiles).toEqual([unreadable.path]);
            expect(result.references.get('attachments/photo.png')).toHaveLength(1);
            expect(result.references.get('attachments/other.png')).toEqual([]);
        });

        it('does not match identical relative text when Obsidian resolves it to another file', async () => {
            const file = { path: 'notes/note.md', name: 'note.md' } as any;
            const relativeDestination = Object.assign(new TFile(), {
                path: 'notes/images/photo.png',
                name: 'photo.png'
            });
            const app = {
                vault: {
                    getMarkdownFiles: vi.fn(() => [file]),
                    read: vi.fn(async () => '![[images/photo.png]]')
                },
                metadataCache: {
                    getFirstLinkpathDest: vi.fn(() => relativeDestination)
                }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesDetailed('images/photo.png');

            expect(result.complete).toBe(true);
            expect(result.locations).toEqual([]);
        });

        it('marks a possible local reference uncertain when metadata cannot resolve it', async () => {
            const file = { path: 'notes/note.md', name: 'note.md' } as any;
            const app = {
                vault: {
                    getMarkdownFiles: vi.fn(() => [file]),
                    read: vi.fn(async () => '![[photo.png]]')
                },
                metadataCache: {
                    getFirstLinkpathDest: vi.fn(() => null)
                }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesDetailed('attachments/photo.png');

            expect(result.complete).toBe(false);
            expect(result.locations).toEqual([]);
            expect(result.uncertainFiles).toEqual([file.path]);
        });

        it('preserves URL fragments when scanning network image references', async () => {
            const file = { path: 'notes/network.md', name: 'network.md' } as any;
            const url = 'https://cdn.example/photo.png#preview';
            const app = {
                vault: {
                    getMarkdownFiles: vi.fn(() => [file]),
                    read: vi.fn(async () => `![photo](${url})`)
                },
                metadataCache: { getFirstLinkpathDest: vi.fn() }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesDetailed(url);

            expect(result.complete).toBe(true);
            expect(result.locations).toHaveLength(1);
            expect(result.locations[0].link).toBe(url);
        });

        it('recognizes uppercase HTTP schemes as network image references', async () => {
            const file = { path: 'notes/note.md', name: 'note.md' } as any;
            const url = 'HTTPS://cdn.example/photo.png?token=AbC';
            const content = `![photo](${url})`;
            const app = {
                vault: {
                    getMarkdownFiles: vi.fn(() => [file]),
                    read: vi.fn(async () => content)
                },
                metadataCache: {
                    getFirstLinkpathDest: vi.fn(() => null)
                }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesDetailed(url);

            expect(result.complete).toBe(true);
            expect(result.locations).toHaveLength(1);
            expect(result.locations[0]).toMatchObject({ original: content, link: url });
        });

        it('finds ordinary Markdown and Wiki links during the authoritative raw scan', async () => {
            const file = { path: 'notes/note.md', name: 'note.md' } as any;
            const image = Object.assign(new TFile(), {
                path: 'assets/photo.png',
                name: 'photo.png'
            });
            const markdown = '[source](<../assets/photo.png> "original")';
            const wiki = '[[../assets/photo.png|Open image]]';
            const app = {
                vault: {
                    getMarkdownFiles: vi.fn(() => [file]),
                    getAbstractFileByPath: vi.fn((path: string) => path === image.path ? image : null),
                    getFiles: vi.fn(() => [image, file]),
                    read: vi.fn(async () => `${markdown}\n${wiki}`)
                },
                metadataCache: {
                    getFirstLinkpathDest: vi.fn(() => image)
                }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesDetailed(image.path);

            expect(result.complete).toBe(true);
            expect(result.locations.map(location => location.original)).toEqual([markdown, wiki]);
        });

        it('treats an existing encoded vault-root path as certain when metadata is unavailable', async () => {
            const note = fakeTFile({ path: 'notes/current.md', extension: 'md' });
            const image = fakeTFile({ path: '20 Areas/assets/My Photo.png', extension: 'png' });
            const source = '![Caption|center|300](/20%20Areas/assets/My%20Photo.png)';
            const app = fakeApp({
                vault: fakeVault({
                    files: [note, image],
                    fileContents: new Map([[note.path, source]])
                }),
                metadataCache: fakeMetadataCache()
            }) as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesDetailed(image.path);

            expect(result.complete).toBe(true);
            expect(result.uncertainFiles).toEqual([]);
            expect(result.locations).toHaveLength(1);
            expect(result.locations[0]).toMatchObject({ file: note, original: source });
        });

        it('finds ordinary URL links even when metadata cache has no entries', async () => {
            const file = { path: 'notes/network.md', name: 'network.md' } as any;
            const url = 'https://cdn.example/Photo.png?token=AbC';
            const content = `[source](${url}) and [[${url}|Open source]]`;
            const app = {
                vault: {
                    getMarkdownFiles: vi.fn(() => [file]),
                    read: vi.fn(async () => content)
                },
                metadataCache: { getFirstLinkpathDest: vi.fn(() => null) }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesDetailed(url);

            expect(result.complete).toBe(true);
            expect(result.locations).toHaveLength(2);
            expect(result.locations.map(location => location.original)).toEqual([
                `[source](${url})`,
                `[[${url}|Open source]]`
            ]);
        });

        it('marks an unresolved ordinary same-name link uncertain instead of declaring the image unused', async () => {
            const file = { path: 'notes/note.md', name: 'note.md' } as any;
            const app = {
                vault: {
                    getMarkdownFiles: vi.fn(() => [file]),
                    read: vi.fn(async () => '[source](photo.png)')
                },
                metadataCache: { getFirstLinkpathDest: vi.fn(() => null) }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesDetailed('attachments/photo.png');

            expect(result.complete).toBe(false);
            expect(result.locations).toEqual([]);
            expect(result.uncertainFiles).toEqual([file.path]);
        });

        it('marks a bare URL occurrence uncertain so cloud deletion fails closed', async () => {
            const file = { path: 'notes/network.md', name: 'network.md' } as any;
            const url = 'https://cdn.example/photo.png';
            const app = {
                vault: {
                    getMarkdownFiles: vi.fn(() => [file]),
                    read: vi.fn(async () => `Backup source: ${url}`)
                },
                metadataCache: { getFirstLinkpathDest: vi.fn(() => null) }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.scanReferencesDetailed(url);

            expect(result.complete).toBe(false);
            expect(result.locations).toEqual([]);
            expect(result.uncertainFiles).toEqual([file.path]);
        });
    });

    describe('metadata cache link path extraction', () => {
        it('preserves escaped literal pipes in wiki image paths when original link text is available', () => {
            const manager = new VaultReferenceManager({} as any);

            const path = (manager as any).getCacheLinkPath({
                link: 'remote\\|img.png|300',
                original: '![[remote\\|img.png|300]]'
            });

            expect(path).toBe('remote|img.png');
        });

        it('falls back to unescaped-pipe splitting when metadata original is unavailable', () => {
            const manager = new VaultReferenceManager({} as any);

            const path = (manager as any).getCacheLinkPath({
                link: 'remote\\|img.png|300',
                original: ''
            });

            expect(path).toBe('remote|img.png');
        });

        it('extracts Markdown destinations with titles from metadata original link text', () => {
            const manager = new VaultReferenceManager({} as any);

            const path = (manager as any).getCacheLinkPath({
                link: 'https://example.com/photo.png "demo"',
                original: '![alt](https://example.com/photo.png "demo")'
            });

            expect(path).toBe('https://example.com/photo.png');
        });
    });

    describe('URL matching', () => {
        it('normalizes protocol and hostname casing without lowercasing resource components', () => {
            const manager = new VaultReferenceManager({} as any);

            expect((manager as any).isUrlMatch(
                'HTTPS://CDN.EXAMPLE/Images/Photo.png?token=AbC#Preview',
                'https://cdn.example/Images/Photo.png?token=AbC#Preview'
            )).toBe(true);
            expect((manager as any).isUrlMatch(
                'https://cdn.example/images/photo.png?token=AbC#Preview',
                'https://cdn.example/Images/Photo.png?token=AbC#Preview'
            )).toBe(false);
            expect((manager as any).isUrlMatch(
                'https://cdn.example/Images/Photo.png?token=abc#Preview',
                'https://cdn.example/Images/Photo.png?token=AbC#Preview'
            )).toBe(false);
        });

        it('uses the same URL normalization when extracting metadata-cache positions', async () => {
            const file = { path: 'notes/network.md', name: 'network.md' } as any;
            const target = 'https://cdn.example/Photo.png?token=AbC';
            const actual = 'HTTPS://CDN.EXAMPLE/Photo.png?token=AbC';
            const original = `[source](${actual})`;
            const cache = {
                links: [{
                    link: actual,
                    original,
                    position: {
                        start: { offset: 0, line: 0 },
                        end: { offset: original.length, line: 0 }
                    }
                }]
            };
            const app = {
                vault: { getMarkdownFiles: vi.fn(() => [file]) },
                metadataCache: { getFileCache: vi.fn(() => cache) }
            } as any;
            const manager = new VaultReferenceManager(app);

            const result = await manager.getFilesReferencingUrl(target);

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ file, original, link: actual });
        });
    });

    describe('code block and admonition scanning', () => {
        it('finds URL image references inside tilde fenced code blocks', async () => {
            const file = {
                path: 'notes/note.md',
                basename: 'note',
                extension: 'md',
                name: 'note.md'
            } as any;
            const url = 'https://example.com/tilde-block.png';
            const content = [
                'intro',
                '~~~md',
                `![alt](${url})`,
                '~~~',
                'outro'
            ].join('\n');
            const app = {
                vault: {
                    read: vi.fn(async () => content)
                },
                metadataCache: {
                    getFirstLinkpathDest: vi.fn()
                }
            } as any;
            const manager = new VaultReferenceManager(app);

            const refs = await (manager as any).scanCodeAndAdmonitionReferences(file, url, content);

            expect(refs).toHaveLength(1);
            expect(refs[0]).toMatchObject({
                file,
                original: `![alt](${url})`,
                link: url,
                line: 2
            });
        });
    });

    describe('source-context reference safety', () => {
        it('keeps callout and ad-* references while ignoring literal Markdown contexts', async () => {
            const file = { path: 'notes/context.md', name: 'context.md', extension: 'md' } as any;
            const target = 'https://cdn.example.com/photo.png';
            const content = [
                '---',
                `cover: ![](${target})`,
                '---',
                `\`![](${target})\``,
                `<!-- ![](${target}) -->`,
                '```markdown',
                `![](${target})`,
                '```',
                '> [!note]',
                `> ![](${target})`,
                '```ad-note',
                `![](${target})`,
                '```'
            ].join('\n');
            const app = {
                vault: {
                    getMarkdownFiles: () => [file],
                    read: vi.fn(async () => content)
                },
                metadataCache: {
                    getFirstLinkpathDest: vi.fn(),
                    resolvedLinks: {}
                }
            } as any;
            const manager = new VaultReferenceManager(app, {
                settings: { global: { codeBlockImageLinkIndexing: false } }
            } as any);

            const scan = await manager.scanReferencesDetailed(target);

            expect(scan.complete).toBe(true);
            expect(scan.locations.map(location => location.line)).toEqual([9, 11]);
        });
    });
});
