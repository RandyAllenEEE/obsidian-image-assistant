import { beforeEach, describe, expect, it, vi } from "vitest";

const noticeMock = vi.hoisted(() => vi.fn());
const deleteImageMock = vi.hoisted(() => vi.fn(async (_image?: { url: string }) => true));

vi.mock("obsidian", async (importOriginal) => {
    const actual = await importOriginal<typeof import("obsidian")>();
    return {
        ...actual,
        Notice: noticeMock,
    };
});

vi.mock("../../../../../../src/cloud/CloudImageDeleter", () => ({
    CloudImageDeleter: class {
        deleteImageDetailed = vi.fn(async (image: { url: string }) => ({
            success: await deleteImageMock(image)
        }));
    },
}));

import { DownloadMode } from "../../../../../../src/ui/modals/batch/modes/DownloadMode";
import { fakeApp, fakeMetadataCache, fakeTFile, fakeTFolder, fakeVault, fakeWorkspace } from "../../../../../factories/obsidian";
import { DEFAULT_SETTINGS } from "../../../../../../src/settings/defaults";
import { Modal } from "obsidian";

describe("DownloadMode", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function makeDownloadPlugin(overrides: Record<string, unknown> = {}) {
        return {
            settings: structuredClone(DEFAULT_SETTINGS),
            supportedImageFormats: {
                isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpe?g|webp|gif)$/i.test(name || "")),
            },
            ...overrides,
        } as any;
    }

    it("renders its settings description", () => {
        const mode = new DownloadMode(fakeApp() as any, makeDownloadPlugin(), null, "vault");
        const container = document.createElement("div");

        mode.renderSettings(container);

        expect(container.textContent).toContain("Download Configuration");
    });

    it("recursively discovers notes in nested folders", async () => {
        const note = fakeTFile({ path: "root/nested/note.md", extension: "md" });
        const nested = fakeTFolder({ path: "root/nested", children: [note] });
        const root = fakeTFolder({ path: "root", children: [nested] });
        const url = "https://cdn.example.com/nested.png";
        const app = fakeApp({
            vault: fakeVault({ files: [note], folders: [root, nested], fileContents: new Map([[note.path, `![](${url})`]]) }),
            metadataCache: fakeMetadataCache()
        }) as any;
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: { getDefaultAttachmentFolderPath: vi.fn(() => "assets") }
        });

        const { tasks } = await new DownloadMode(app, plugin, root, "folder").loadTasks();

        expect(tasks.map(task => task.path)).toEqual([url]);
    });

    it("marks attachment-folder resolution failures as uncertain discovery", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const url = "https://cdn.example.com/photo.png";
        const app = fakeApp({
            vault: fakeVault({ files: [note], fileContents: new Map([[note.path, `![](${url})`]]) }),
            metadataCache: fakeMetadataCache()
        }) as any;
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: {
                getDefaultAttachmentFolderPath: vi.fn(() => { throw new Error("invalid attachment rule"); })
            }
        });

        const discovery = await new DownloadMode(app, plugin, note, "note").loadTasks();

        expect(discovery.complete).toBe(false);
        expect(discovery.tasks).toEqual([]);
        expect(discovery.failedFiles).toEqual([expect.stringContaining("invalid attachment rule")]);
    });

    it("prepares a batch without prompting when target folders do not conflict", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const mode = new DownloadMode(fakeApp() as any, makeDownloadPlugin(), null, "vault");

        await expect(mode.prepareExecution([{
            id: "url", name: "image", path: "https://example.com/image", selected: true, status: "pending",
            source: { url: "https://example.com/image", origins: [{ file: note, targetFolder: "assets" }] }
        }])).resolves.toBe(true);
        expect((mode as any).conflictPolicy).toBe("single-copy");
    });

    it("fails closed for a download task without a valid source", async () => {
        const mode = new DownloadMode(fakeApp() as any, makeDownloadPlugin(), null, "vault");

        const result = await mode.processTask({
            id: "bad", name: "bad", path: "bad", source: {}, selected: true, status: "pending"
        });

        expect(result).toMatchObject({ status: "failed", success: false });
    });

    it("classifies direct-worker skip, failure, and exception results", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const source = { url: "https://example.com/image.png", origins: [{ file: note, targetFolder: "assets" }] };
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: { ensureFolderExists: vi.fn() },
            cloudImageHandler: { downloadImageToFolder: vi.fn() }
        });
        const mode = new DownloadMode(fakeApp() as any, plugin, null, "vault");
        const task = {
            id: source.url, name: "image.png", path: source.url, source,
            selected: true, status: "pending" as const
        };

        plugin.cloudImageHandler.downloadImageToFolder.mockResolvedValueOnce({
            success: false, skipped: true, url: source.url, error: "exists"
        });
        await expect(mode.processTask(task)).resolves.toMatchObject({ status: "skipped", error: "exists" });

        plugin.cloudImageHandler.downloadImageToFolder.mockResolvedValueOnce({
            success: false, url: source.url, error: "HTTP 500"
        });
        await expect(mode.processTask(task)).resolves.toMatchObject({ status: "failed", error: "assets: HTTP 500" });

        plugin.cloudImageHandler.downloadImageToFolder.mockRejectedValueOnce(new Error("worker crashed"));
        await expect(mode.processTask(task)).resolves.toMatchObject({ status: "failed", error: "worker crashed" });
    });

    it("skips an unverified Canvas URL when downloaded bytes are not an image", async () => {
        const note = fakeTFile({ path: "boards/current.canvas", extension: "canvas" });
        const url = "https://example.com/article";
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: { ensureFolderExists: vi.fn() },
            cloudImageHandler: {
                downloadImageToFolder: vi.fn().mockResolvedValue({
                    success: false,
                    url,
                    error: "not an image",
                    errorCode: "not-image"
                })
            }
        });
        const mode = new DownloadMode(fakeApp() as any, plugin, note, "note");

        await expect(mode.processTask({
            id: url,
            name: "article",
            path: url,
            source: {
                url,
                verification: "unverified",
                origins: [{
                    file: note,
                    targetFolder: "assets",
                    verification: "unverified"
                }]
            },
            selected: true,
            status: "pending"
        })).resolves.toMatchObject({
            status: "skipped",
            skipped: true,
            item: url
        });
    });

    it("handles malformed URL helpers and exposes uploader-appropriate review actions", () => {
        const plugin = makeDownloadPlugin();
        const mode = new DownloadMode(fakeApp() as any, plugin, null, "vault");

        expect((mode as any).normalizeUrlIdentity(" not a url ")).toBe("not a url");
        expect((mode as any).isAllowedNetworkImageUrl("ftp://example.com/image.png")).toBe(false);
        expect((mode as any).isAllowedNetworkImageUrl("not a url")).toBe(false);
        expect((mode as any).extractImageNameFromUrl("https://example.com/%E0%A4%A")).toBe("%E0%A4%A");

        plugin.settings.pasteHandling.cloud.uploader = "PicGo";
        expect(mode.getReviewActions().map(action => action.id)).toEqual(["replace_only", "undo"]);
        plugin.settings.pasteHandling.cloud.uploader = "PicList";
        expect(mode.getReviewActions().map(action => action.id)).toEqual([
            "replace_only", "replace_delete_cloud", "undo"
        ]);
    });

    it("settles the zero-reference deletion confirmation", async () => {
        const mode = new DownloadMode(fakeApp() as any, makeDownloadPlugin(), null, "vault");
        const open = vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
            (this as any).onOpen();
        });

        const confirmation = (mode as any).confirmZeroReferenceDeletion("https://example.com/image.png");
        const dialog = open.mock.instances[0] as unknown as Modal;
        dialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[1].click();

        await expect(confirmation).resolves.toBe(true);
    });

    it("preserves a skipped download conflict result", async () => {
        const note = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const url = "https://cdn.example.com/photo.png";
        const skipped = {
            success: false,
            skipped: true,
            url,
            error: "Destination exists"
        } as const;
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: {
                getDefaultAttachmentFolderPath: vi.fn(async () => "attachments"),
                ensureFolderExists: vi.fn()
            },
            cloudImageHandler: {
                downloadImageToFolder: vi.fn(async () => skipped)
            }
        });
        const mode = new DownloadMode(fakeApp() as any, plugin, note, "note");

        await expect(mode.processTask({
            id: url,
            name: "photo.png",
            path: url,
            source: { url, file: note },
            selected: true,
            status: "pending"
        })).resolves.toMatchObject({
            status: "skipped",
            success: false,
            skipped: true,
            item: url,
            error: "Destination exists"
        });
    });

    it("accepts metadata image embeds regardless of URL extension and strips query text from task names", async () => {
        const note = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const pngUrl = "https://cdn.example.com/photo.png?token=abc#v";
        const pdfUrl = "https://cdn.example.com/report.pdf";
        const metadataCache = fakeMetadataCache({
            fileCache: new Map([[note.path, {
                embeds: [{ link: pngUrl }, { link: pdfUrl }],
                links: [{ link: "https://cdn.example.com/linked.gif?size=large" }]
            }]])
        });
        const app = fakeApp({
            vault: fakeVault({ files: [note] }),
            metadataCache,
        }) as any;
        const plugin = makeDownloadPlugin();
        plugin.settings.global.codeBlockImageLinkIndexing = false;
        const mode = new DownloadMode(app, plugin, note, "note");

        const { tasks } = await mode.loadTasks();

        expect(tasks.map(task => task.path).sort()).toEqual([pngUrl, pdfUrl]);
        expect(tasks.find(task => task.path === pngUrl)?.name).toBe("photo.png");
        expect(tasks.some(task => task.path.includes("linked.gif"))).toBe(false);
    });

    it("discovers extensionless and misleading image embed URLs but not extensionless normal links", async () => {
        const note = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const dynamicImage = "https://cdn.example.com/render?id=42";
        const misleadingImage = "https://cdn.example.com/image.php?asset=7";
        const normalPage = "https://example.com/article";
        const metadataCache = fakeMetadataCache({
            fileCache: new Map([[note.path, {
                embeds: [{ link: dynamicImage }, { link: misleadingImage }],
                links: [{ link: normalPage }],
            }]])
        });
        const app = fakeApp({ vault: fakeVault({ files: [note] }), metadataCache }) as any;
        const plugin = makeDownloadPlugin();
        plugin.settings.global.codeBlockImageLinkIndexing = false;

        const { tasks } = await new DownloadMode(app, plugin, note, "note").loadTasks();

        expect(tasks.map(task => task.path)).toEqual([dynamicImage, misleadingImage].sort());
        expect(tasks.map(task => task.name)).toEqual(["image.php", "render"]);
    });

    it("excludes exact blacklisted domains and their subdomains from batch discovery", async () => {
        const note = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const metadataCache = fakeMetadataCache({
            fileCache: new Map([[note.path, {
                embeds: [
                    { link: "https://blocked.example/photo.png" },
                    { link: "https://cdn.media.example/photo.png" },
                    { link: "https://allowed.example/photo.png" }
                ]
            }]])
        });
        const app = fakeApp({ vault: fakeVault({ files: [note] }), metadataCache }) as any;
        const plugin = makeDownloadPlugin();
        plugin.settings.global.codeBlockImageLinkIndexing = false;
        plugin.settings.pasteHandling.cloud.newWorkBlackDomains = "blocked.example\nmedia.example";
        const mode = new DownloadMode(app, plugin, note, "note");

        const { tasks } = await mode.loadTasks();

        expect(tasks.map(task => task.path)).toEqual(["https://allowed.example/photo.png"]);
    });

    it("keeps image-syntax URLs regardless of extension when content scanning is enabled", async () => {
        const note = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const pngUrl = "https://cdn.example.com/photo.png?token=abc";
        const pdfUrl = "https://cdn.example.com/report.pdf";
        const app = fakeApp({
            vault: fakeVault({
                files: [note],
                fileContents: new Map([[note.path, `![ok](${pngUrl})\n![skip](${pdfUrl})`]])
            }),
        }) as any;
        const plugin = makeDownloadPlugin();
        plugin.settings.global.codeBlockImageLinkIndexing = true;
        const mode = new DownloadMode(app, plugin, note, "note");

        const { tasks } = await mode.loadTasks();

        expect(tasks).toHaveLength(2);
        expect(tasks).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: "photo.png", path: pngUrl }),
            expect.objectContaining({ name: "report.pdf", path: pdfUrl }),
        ]));
    });

    it("discovers an extensionless image link when content scanning is enabled", async () => {
        const note = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const url = "HTTPS://cdn.example.com/render?asset=123";
        const app = fakeApp({
            vault: fakeVault({
                files: [note],
                fileContents: new Map([[note.path, `![dynamic](${url})`]])
            }),
        }) as any;
        const plugin = makeDownloadPlugin();
        plugin.settings.global.codeBlockImageLinkIndexing = true;

        const { tasks } = await new DownloadMode(app, plugin, note, "note").loadTasks();

        expect(tasks).toHaveLength(1);
        expect(tasks[0].path).toBe(url);
        expect(tasks[0].name).toBe("render");
    });

    it("discovers network images in fenced blocks and admonitions when content indexing is enabled", async () => {
        const note = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const urls = [
            "https://cdn.example.com/fenced.png",
            "https://cdn.example.com/tilde.gif",
            "https://cdn.example.com/admonition.webp",
            "https://cdn.example.com/normal.jpg",
        ];
        const app = fakeApp({
            vault: fakeVault({
                files: [note],
                fileContents: new Map([[note.path, [
                    "```md",
                    `![fenced](${urls[0]})`,
                    "```",
                    "~~~md",
                    `![tilde](${urls[1]})`,
                    "~~~",
                    "> [!note]",
                    `> ![admonition](${urls[2]})`,
                    `![normal](${urls[3]})`,
                ].join("\n")]])
            })
        }) as any;
        const plugin = makeDownloadPlugin();
        plugin.settings.global.codeBlockImageLinkIndexing = true;
        const mode = new DownloadMode(app, plugin, note, "note");

        const { tasks } = await mode.loadTasks();

        expect(tasks.map(task => task.path)).toEqual([...urls].sort());
    });

    it("keeps rendered callout links while excluding source-only fenced links when indexing is disabled", async () => {
        const note = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const app = fakeApp({
            vault: fakeVault({
                files: [note],
                fileContents: new Map([[note.path, [
                    "```md",
                    "![fenced](https://cdn.example.com/fenced.png)",
                    "```",
                    "> [!note]",
                    "> ![admonition](https://cdn.example.com/admonition.webp)",
                ].join("\n")]])
            }),
            metadataCache: fakeMetadataCache({ fileCache: new Map([[note.path, { embeds: [], links: [] }]]) })
        }) as any;
        const plugin = makeDownloadPlugin();
        plugin.settings.global.codeBlockImageLinkIndexing = false;
        const mode = new DownloadMode(app, plugin, note, "note");

        await expect(mode.loadTasks()).resolves.toEqual(expect.objectContaining({
            tasks: [expect.objectContaining({ path: "https://cdn.example.com/admonition.webp" })],
            complete: true
        }));
    });

    it("discovers Canvas image syntax and marks all native URL nodes for execution-time verification", async () => {
        const canvas = fakeTFile({ path: "boards/media.canvas", name: "media.canvas", extension: "canvas" });
        const textUrl = "https://cdn.example.com/render?id=42";
        const nativeUrl = "https://cdn.example.com/photo.webp";
        const app = fakeApp({
            vault: fakeVault({
                files: [canvas],
                fileContents: new Map([[canvas.path, JSON.stringify({
                    nodes: [
                        { id: "text", type: "text", text: `![dynamic](${textUrl})` },
                        { id: "native", type: "link", url: nativeUrl },
                        { id: "page", type: "link", url: "https://example.com/article" }
                    ]
                })]])
            })
        }) as any;
        const plugin = makeDownloadPlugin();

        const { tasks } = await new DownloadMode(app, plugin, canvas, "note").loadTasks();

        expect(tasks.map(task => task.path).sort()).toEqual([
            nativeUrl,
            textUrl,
            "https://example.com/article"
        ].sort());
        expect(tasks.find(task => task.path === "https://example.com/article")?.source)
            .toEqual(expect.objectContaining({ verification: "unverified" }));
        expect(tasks.find(task => task.path === textUrl)?.source)
            .toEqual(expect.objectContaining({ verification: "verified" }));
    });

    it("uses the note where a URL was found when choosing the download attachment folder", async () => {
        const activeNote = fakeTFile({ path: "active.md", name: "active.md", extension: "md" });
        const sourceNote = fakeTFile({ path: "project/source.md", name: "source.md", extension: "md" });
        const folder = fakeTFolder({ path: "project", name: "project", children: [sourceNote] });
        const url = "https://cdn.example.com/photo.png";
        const metadataCache = fakeMetadataCache({
            fileCache: new Map([[sourceNote.path, { embeds: [{ link: url }] }]])
        });
        const app = fakeApp({
            vault: fakeVault({ files: [activeNote, sourceNote], folders: [folder] }),
            metadataCache,
            workspace: fakeWorkspace({ activeFile: activeNote })
        }) as any;
        const downloadImageToFolder = vi.fn(async () => ({
            success: true,
            url,
            vaultPath: "project/assets/photo.png",
            disposition: "created"
        }));
        const getDefaultAttachmentFolderPath = vi.fn(async (file: any) => `attachments-for/${file.basename}`);
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: {
                getDefaultAttachmentFolderPath,
                ensureFolderExists: vi.fn()
            },
            cloudImageHandler: {
                downloadImageToFolder
            }
        });
        plugin.settings.global.codeBlockImageLinkIndexing = false;
        const mode = new DownloadMode(app, plugin, folder, "folder");

        const { tasks } = await mode.loadTasks();
        await mode.processTask(tasks[0]);

        expect(getDefaultAttachmentFolderPath).toHaveBeenCalledWith(sourceNote);
        expect(getDefaultAttachmentFolderPath).not.toHaveBeenCalledWith(activeNote);
        expect(downloadImageToFolder).toHaveBeenCalledWith(
            url,
            "attachments-for/source",
            "photo.png",
            sourceNote
        );
    });

    it("stores one copy for a conflicting URL when the batch chooses the first source folder", async () => {
        const first = fakeTFile({ path: "a/first.md", extension: "md" });
        const second = fakeTFile({ path: "b/second.md", extension: "md" });
        const url = "https://cdn.example.com/shared.png";
        const downloadImageToFolder = vi.fn(async () => ({
            success: true,
            url,
            vaultPath: "a/assets/shared.png",
            disposition: "created"
        }));
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: { ensureFolderExists: vi.fn() },
            cloudImageHandler: { downloadImageToFolder }
        });
        const mode = new DownloadMode(fakeApp() as any, plugin, null, "vault");
        const task = {
            id: url, name: "shared.png", path: url, selected: true, status: "pending" as const,
            source: { url, origins: [
                { file: first, targetFolder: "a/assets" },
                { file: second, targetFolder: "b/assets" }
            ] }
        };
        const open = vi.spyOn(Modal.prototype, "open");

        const preparing = mode.prepareExecution([task]);
        const modal = open.mock.instances[0] as unknown as Modal;
        modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[0].click();
        await expect(preparing).resolves.toBe(true);
        const result = await mode.processTask(task);

        expect(downloadImageToFolder).toHaveBeenCalledOnce();
        expect(downloadImageToFolder).toHaveBeenCalledWith(url, "a/assets", "shared.png", first);
        expect((result as any).output.downloads[0].files).toEqual([first, second]);
    });

    it("stores one copy in each target folder when that conflict policy is chosen", async () => {
        const first = fakeTFile({ path: "a/first.md", extension: "md" });
        const second = fakeTFile({ path: "b/second.md", extension: "md" });
        const url = "https://cdn.example.com/shared.png";
        const downloadImageToFolder = vi.fn(async (_url: string, folder: string) => ({
            success: true,
            url,
            vaultPath: `${folder}/shared.png`,
            disposition: "created"
        }));
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: { ensureFolderExists: vi.fn() },
            cloudImageHandler: { downloadImageToFolder }
        });
        const mode = new DownloadMode(fakeApp() as any, plugin, null, "vault");
        const task = {
            id: url, name: "shared.png", path: url, selected: true, status: "pending" as const,
            source: { url, origins: [
                { file: first, targetFolder: "a/assets" },
                { file: second, targetFolder: "b/assets" }
            ] }
        };
        const open = vi.spyOn(Modal.prototype, "open");

        const preparing = mode.prepareExecution([task]);
        const modal = open.mock.instances[0] as unknown as Modal;
        modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[1].click();
        await expect(preparing).resolves.toBe(true);
        const result = await mode.processTask(task);

        expect(downloadImageToFolder).toHaveBeenCalledTimes(2);
        expect(downloadImageToFolder.mock.calls.map(call => call[1])).toEqual(["a/assets", "b/assets"]);
        expect((result as any).output.downloads.map((entry: any) => entry.files)).toEqual([[first], [second]]);
    });

    it("cancels the entire batch before any download starts", async () => {
        const first = fakeTFile({ path: "a/first.md", extension: "md" });
        const second = fakeTFile({ path: "b/second.md", extension: "md" });
        const url = "https://cdn.example.com/shared.png";
        const downloadImageToFolder = vi.fn();
        const plugin = makeDownloadPlugin({ cloudImageHandler: { downloadImageToFolder } });
        const mode = new DownloadMode(fakeApp() as any, plugin, null, "vault");
        const task = {
            id: url, name: "shared.png", path: url, selected: true, status: "pending" as const,
            source: { url, origins: [
                { file: first, targetFolder: "a/assets" },
                { file: second, targetFolder: "b/assets" }
            ] }
        };
        const open = vi.spyOn(Modal.prototype, "open");

        const preparing = mode.prepareExecution([task]);
        const modal = open.mock.instances[0] as unknown as Modal;
        modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[2].click();

        await expect(preparing).resolves.toBe(false);
        expect(downloadImageToFolder).not.toHaveBeenCalled();
    });

    it("reports a skipped target folder alongside successful per-folder downloads", async () => {
        const first = fakeTFile({ path: "a/first.md", extension: "md" });
        const second = fakeTFile({ path: "b/second.md", extension: "md" });
        const url = "https://cdn.example.com/shared.png";
        const downloadImageToFolder = vi.fn()
            .mockResolvedValueOnce({ success: true, url, vaultPath: "a/assets/shared.png", disposition: "created" })
            .mockResolvedValueOnce({ success: false, skipped: true, url, error: "Destination exists", disposition: "skipped" });
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: { ensureFolderExists: vi.fn() },
            cloudImageHandler: { downloadImageToFolder }
        });
        const mode = new DownloadMode(fakeApp() as any, plugin, null, "vault");
        (mode as any).conflictPolicy = "per-target-folder";

        const result = await mode.processTask({
            id: url, name: "shared.png", path: url, selected: true, status: "pending",
            source: { url, origins: [
                { file: first, targetFolder: "a/assets" },
                { file: second, targetFolder: "b/assets" }
            ] }
        });

        expect(result.status).toBe("success");
        expect((result as any).output.downloads[0].files).toEqual([first]);
        expect((result as any).output.errors).toEqual(["b/assets: Destination exists"]);
    });

    it("returns visible discovery diagnostics when a source note cannot be read", async () => {
        const readable = fakeTFile({ path: "a/readable.md", extension: "md" });
        const unreadable = fakeTFile({ path: "b/unreadable.md", extension: "md" });
        const url = "https://cdn.example.com/ok.png";
        const vault = fakeVault({ files: [readable, unreadable] });
        vault.read = vi.fn(async (file: any) => {
            if (file.path === unreadable.path) throw new Error("permission denied");
            return `![](${url})`;
        });
        const app = fakeApp({ vault, metadataCache: fakeMetadataCache() }) as any;
        const plugin = makeDownloadPlugin({
            folderAndFilenameManagement: { getDefaultAttachmentFolderPath: vi.fn(() => "assets") }
        });

        const discovery = await new DownloadMode(app, plugin, null, "vault").loadTasks();

        expect(discovery.tasks).toHaveLength(1);
        expect(discovery.complete).toBe(false);
        expect(discovery.failedFiles).toEqual([expect.stringContaining("b/unreadable.md: permission denied")]);
        expect(discovery.uncertainFiles).toEqual([unreadable.path]);
    });

    it("replaces downloaded URLs only inside the selected note scope and reports the result", async () => {
        const noteInScope = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const noteOutsideScope = fakeTFile({ path: "notes/other.md", name: "other.md", extension: "md" });
        const localFile = fakeTFile({ path: "attachments/photo.png", name: "photo.png", extension: "png" });
        const url = "https://cdn.example.com/photo.png";

        const app = fakeApp() as any;
        app.vault.getAbstractFileByPath = vi.fn((path: string) => path === localFile.path ? localFile : null);
        app.metadataCache.fileToLinktext = vi.fn(() => "attachments/photo.png");

        const inScopeLocations = [0, 1].map(index => ({
            file: noteInScope,
            start: index,
            end: index + 1,
            original: `![photo](<${url}>)`,
            link: url,
            line: index,
        }));
        const updateReferenceLocationsDetailed = vi.fn(async (locations: any[]) => ({
            found: locations.length,
            replaced: locations.length,
            complete: true,
            files: [{ filePath: noteInScope.path, found: locations.length, replaced: locations.length }],
            failedFiles: [],
            uncertainFiles: [],
        }));
        const plugin = {
            settings: structuredClone(DEFAULT_SETTINGS),
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({
                    locations: [...inScopeLocations, { ...inScopeLocations[0], file: noteOutsideScope }],
                    complete: true,
                    uncertainFiles: [],
                })),
                updateReferenceLocationsDetailed,
            },
            cloudImageHandler: { discardDownloadUndo: vi.fn() },
            historyManager: {
                isUrlUploaded: vi.fn(() => false),
            },
        } as any;

        const mode = new DownloadMode(app, plugin, noteInScope, "note");

        await mode.handleReviewAction("replace_only", {
            successful: [
                {
                    status: "success",
                    success: true,
                    item: url,
                    output: {
                        vaultPath: localFile.path,
                        localPath: "../attachments/photo.png",
                    },
                },
            ],
            failed: [],
            skipped: [],
            cancelled: false,
        });

        expect(plugin.vaultReferenceManager.scanReferencesDetailed).toHaveBeenCalledWith(
            url,
            { kind: "safety", includeFencedCode: true }
        );
        expect(updateReferenceLocationsDetailed).toHaveBeenCalledWith(inScopeLocations, expect.any(Function));
        expect(noticeMock).toHaveBeenCalledWith("Replaced 2 links in 1 notes.");
    });

    it("replaces native and text Canvas URLs with the downloaded local file", async () => {
        const canvas = fakeTFile({ path: "boards/media.canvas", name: "media.canvas", extension: "canvas" });
        const localFile = fakeTFile({ path: "attachments/photo.png", name: "photo.png", extension: "png" });
        const url = "https://cdn.example.com/photo.png";
        const contents = new Map([[canvas.path, JSON.stringify({
            nodes: [
                { id: "native", type: "link", url, x: 1, y: 2 },
                { id: "text", type: "text", text: `![[${url}|300]]` }
            ]
        })]]);
        const app = fakeApp({
            vault: fakeVault({ files: [canvas, localFile], fileContents: contents }),
            metadataCache: fakeMetadataCache()
        }) as any;
        const plugin = makeDownloadPlugin({
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({
                    locations: [], complete: true, uncertainFiles: []
                })),
                updateReferenceLocationsDetailed: vi.fn(async () => ({
                    found: 0, replaced: 0, complete: true,
                    files: [], failedFiles: [], uncertainFiles: []
                }))
            },
            cloudImageHandler: { discardDownloadUndo: vi.fn() },
            historyManager: { isUrlUploaded: vi.fn(() => false) }
        });
        const mode = new DownloadMode(app, plugin, canvas, "note");

        const completed = await mode.handleReviewAction("replace_only", {
            successful: [{
                status: "success",
                success: true,
                item: url,
                output: { vaultPath: localFile.path }
            }],
            failed: [], skipped: [], cancelled: false
        });
        const updated = JSON.parse(contents.get(canvas.path) ?? "{}");

        expect(completed).toBe(true);
        expect(updated.nodes[0]).toMatchObject({
            id: "native",
            type: "file",
            file: localFile.path,
            x: 1,
            y: 2
        });
        expect(updated.nodes[0]).not.toHaveProperty("url");
        expect(updated.nodes[1].text).toBe(`![[${localFile.name}|300]]`);
    });

    it("does not delete cloud images when references remain outside the selected scope", async () => {
        const noteInScope = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const noteOutsideScope = fakeTFile({ path: "notes/other.md", name: "other.md", extension: "md" });
        const localFile = fakeTFile({ path: "attachments/photo.png", name: "photo.png", extension: "png" });
        const url = "https://cdn.example.com/photo.png";
        const app = fakeApp() as any;
        app.vault.getAbstractFileByPath = vi.fn((path: string) => path === localFile.path ? localFile : null);
        app.metadataCache.fileToLinktext = vi.fn(() => "attachments/photo.png");
        const plugin = {
            settings: structuredClone(DEFAULT_SETTINGS),
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({
                    locations: [noteInScope, noteOutsideScope].map((file, index) => ({
                        file, start: index, end: index + 1, original: `![](${url})`, link: url, line: index
                    })),
                    complete: true,
                    uncertainFiles: [],
                })),
                updateReferenceLocationsDetailed: vi.fn(async () => ({
                    found: 1, replaced: 1, complete: true, files: [], failedFiles: [], uncertainFiles: []
                })),
            },
            cloudImageHandler: { discardDownloadUndo: vi.fn() },
            historyManager: {
                isUrlUploaded: vi.fn(() => true),
            },
        } as any;
        plugin.settings.pasteHandling.cloud.uploader = "PicList";
        plugin.settings.pasteHandling.cloud.deleteServer = "http://127.0.0.1:36677/delete";
        const mode = new DownloadMode(app, plugin, noteInScope, "note");

        const completed = await mode.handleReviewAction("replace_delete_cloud", {
            successful: [{ status: "success", success: true, item: url, output: { vaultPath: localFile.path } }],
            failed: [],
            skipped: [],
            cancelled: false,
        });

        expect(plugin.historyManager.isUrlUploaded).toHaveBeenCalledWith(url);
        expect(deleteImageMock).not.toHaveBeenCalled();
        expect(completed).toBe(false);
    });

    it("deletes cloud images after replace_delete_cloud replaces all known references in scope", async () => {
        const noteInScope = fakeTFile({ path: "notes/current.md", name: "current.md", extension: "md" });
        const localFile = fakeTFile({ path: "attachments/photo.png", name: "photo.png", extension: "png" });
        const url = "https://cdn.example.com/photo.png";
        const app = fakeApp() as any;
        app.vault.getAbstractFileByPath = vi.fn((path: string) => path === localFile.path ? localFile : null);
        app.metadataCache.fileToLinktext = vi.fn(() => "attachments/photo.png");
        let scanCount = 0;
        const plugin = {
            settings: structuredClone(DEFAULT_SETTINGS),
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({
                    locations: scanCount++ < 2 ? [{
                        file: noteInScope, start: 0, end: 1, original: `![](${url})`, link: url, line: 0
                    }] : [],
                    complete: true,
                    uncertainFiles: [],
                })),
                getFilesReferencingUrl: vi.fn(async () => []),
                updateReferenceLocationsDetailed: vi.fn(async () => ({
                    found: 1, replaced: 1, complete: true,
                    files: [{ filePath: noteInScope.path, found: 1, replaced: 1 }],
                    failedFiles: [], uncertainFiles: []
                })),
            },
            cloudImageHandler: { discardDownloadUndo: vi.fn() },
            historyManager: {
                isUrlUploaded: vi.fn(() => true),
            },
        } as any;
        plugin.settings.pasteHandling.cloud.uploader = "PicList";
        plugin.settings.pasteHandling.cloud.deleteServer = "http://127.0.0.1:36677/delete";
        const mode = new DownloadMode(app, plugin, noteInScope, "note");

        await mode.handleReviewAction("replace_delete_cloud", {
            successful: [{ status: "success", success: true, item: url, output: { vaultPath: localFile.path } }],
            failed: [],
            skipped: [],
            cancelled: false,
        });

        expect(plugin.historyManager.isUrlUploaded).toHaveBeenCalledWith(url);
        expect(deleteImageMock).toHaveBeenCalledWith({ url });
    });

    it("keeps review open and reports when any downloaded file cannot be undone", async () => {
        const app = fakeApp() as any;
        const undoDownload = vi.fn()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        const plugin = makeDownloadPlugin({
            cloudImageHandler: { undoDownload }
        });
        const mode = new DownloadMode(app, plugin, null, "vault");

        const completed = await mode.handleReviewAction("undo", {
            successful: [
                { status: "success", success: true, item: "https://example.com/a.png", output: { vaultPath: "a.png" } },
                { status: "success", success: true, item: "https://example.com/b.png", output: { vaultPath: "b.png" } },
            ],
            failed: [], skipped: [], cancelled: false,
        });

        expect(undoDownload).toHaveBeenCalledTimes(2);
        expect(completed).toBe(false);
        expect(noticeMock).not.toHaveBeenCalledWith("Undo complete");
    });

    it("reports replace_only as incomplete when a known reference could not be updated", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const localFile = fakeTFile({ path: "attachments/photo.png", extension: "png" });
        const url = "https://cdn.example.com/photo.png";
        const app = fakeApp() as any;
        app.vault.getAbstractFileByPath = vi.fn(() => localFile);
        const plugin = makeDownloadPlugin({
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({
                    locations: [{ file: note, start: 0, end: 1, original: `![](${url})`, link: url, line: 0 }],
                    complete: true,
                    uncertainFiles: [],
                })),
                updateReferenceLocationsDetailed: vi.fn(async () => ({
                    found: 1, replaced: 0, complete: false, files: [],
                    failedFiles: [note.path], uncertainFiles: [],
                })),
            },
            cloudImageHandler: { discardDownloadUndo: vi.fn() },
            historyManager: { isUrlUploaded: vi.fn(() => false) },
        });
        const mode = new DownloadMode(app, plugin, note, "note");

        const completed = await mode.handleReviewAction("replace_only", {
            successful: [{ status: "success", success: true, item: url, output: { vaultPath: localFile.path } }],
            failed: [], skipped: [], cancelled: false,
        });

        expect(completed).toBe(false);
    });

    it("releases a downloaded item's undo backup when its result is discarded", () => {
        const discardDownloadUndo = vi.fn();
        const plugin = makeDownloadPlugin({
            cloudImageHandler: { discardDownloadUndo }
        });
        const mode = new DownloadMode(fakeApp() as any, plugin, null, "vault");
        const output = { vaultPath: "attachments/image.webp", undoToken: "undo-1" };

        mode.disposeItemResult({
            status: "success",
            success: true,
            item: "https://example.com/image.webp",
            output
        });

        expect(discardDownloadUndo).toHaveBeenCalledWith(output);
    });
});
