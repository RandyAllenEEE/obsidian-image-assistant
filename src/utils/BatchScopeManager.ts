import { App, TFile, TFolder, Notice } from "obsidian";
import type ImageConverterPlugin from "../main";
import { BatchMode, BatchScope, BatchTask } from "../types/BatchTypes";
import { ImageHandler } from "../core/ImageHandler";

export class BatchScopeManager {
    constructor(private app: App, private plugin: ImageConverterPlugin) { }

    async getTasks(scope: BatchScope, target: TFile | TFolder | null, mode: BatchMode): Promise<BatchTask[]> {
        if (mode === "download") {
            return this.getNetworkTasks(scope, target);
        } else {
            return this.getLocalTasks(scope, target);
        }
    }

    private async getLocalTasks(scope: BatchScope, target: TFile | TFolder | null): Promise<BatchTask[]> {
        let files: TFile[] = [];

        if (scope === "note" && target instanceof TFile) {
            files = await this.getImagesInNote(target);
        } else if (scope === "folder" && target instanceof TFolder) {
            files = this.getImagesInFolder(target);
        } else if (scope === "vault") {
            files = this.getAllImagesInVault();
        }

        // Filter duplicates
        const uniqueFiles = Array.from(new Set(files));

        return uniqueFiles.map(file => ({
            id: file.path,
            name: file.name,
            path: file.path,
            source: file,
            selected: true, // Default to selected
            status: 'pending'
        }));
    }

    private async getNetworkTasks(scope: BatchScope, target: TFile | TFolder | null): Promise<BatchTask[]> {
        let notes: TFile[] = [];

        if (scope === "note" && target instanceof TFile) {
            notes = [target];
        } else if (scope === "folder" && target instanceof TFolder) {
            notes = this.getNotesInFolder(target);
        } else if (scope === "vault") {
            notes = this.app.vault.getMarkdownFiles();
        }

        const taskMap = new Map<string, BatchTask>();

        for (const note of notes) {
            const urls = await this.extractImageUrls(note);
            for (const url of urls) {
                if (!taskMap.has(url)) {
                    taskMap.set(url, {
                        id: url,
                        name: this.extractFilenameFromUrl(url),
                        path: url, // For network tasks, path is the URL
                        source: url,
                        selected: true,
                        status: 'pending'
                    });
                }
            }
        }

        return Array.from(taskMap.values());
    }

    // --- Helper Methods ---

    private async getImagesInNote(file: TFile): Promise<TFile[]> {
        // Logic adapted from BatchImageProcessor
        if (file.extension === 'canvas') {
            return this.getImagesFromCanvas(file);
        }

        const { resolvedLinks } = this.app.metadataCache;
        const linksInNote = resolvedLinks[file.path] || {};

        return Object.keys(linksInNote)
            .map(path => this.app.vault.getAbstractFileByPath(path))
            .filter((f): f is TFile => f instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, f.name));
    }

    private getImagesInFolder(folder: TFolder): TFile[] {
        const allFiles = this.app.vault.getFiles();
        return allFiles.filter(file => {
            if (!this.plugin.supportedImageFormats.isSupported(undefined, file.name)) return false;
            return file.path.startsWith(folder.path + "/"); // Simple prefix check
        });
    }

    private getAllImagesInVault(): TFile[] {
        return this.app.vault.getFiles().filter(file =>
            this.plugin.supportedImageFormats.isSupported(undefined, file.name)
        );
    }

    private getNotesInFolder(folder: TFolder): TFile[] {
        const allFiles = this.app.vault.getMarkdownFiles();
        return allFiles.filter(file => file.path.startsWith(folder.path + "/"));
    }

    private async extractImageUrls(file: TFile): Promise<string[]> {
        const content = await this.app.vault.read(file);
        const urls: string[] = [];
        const markdownRegex = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
        const wikilinkRegex = /!\[\[(https?:\/\/[^\]]+)\]\]/g;

        let match;
        while ((match = markdownRegex.exec(content)) !== null) urls.push(match[1]);
        while ((match = wikilinkRegex.exec(content)) !== null) urls.push(match[1]);

        return urls;
    }

    private async getImagesFromCanvas(file: TFile): Promise<TFile[]> {
        const content = await this.app.vault.read(file);
        try {
            const canvasData = JSON.parse(content);
            const images: TFile[] = [];
            if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
                for (const node of canvasData.nodes) {
                    if (node.type === "file" && node.file) {
                        const imgFile = this.app.vault.getAbstractFileByPath(node.file);
                        if (imgFile instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, imgFile.name)) {
                            images.push(imgFile);
                        }
                    }
                }
            }
            return images;
        } catch (e) {
            console.error("Failed to parse canvas", e);
            return [];
        }
    }

    private extractFilenameFromUrl(url: string): string {
        try {
            const cleanUrl = url.split('?')[0].split('#')[0];
            const asset = cleanUrl.substring(1 + cleanUrl.lastIndexOf("/"));
            let fileName = decodeURIComponent(asset);
            fileName = fileName.replace(/[\\/:*?"<>|]/g, "-");
            if (!fileName || fileName === "-") fileName = "image-" + Date.now();
            return fileName;
        } catch (error) {
            return "image-" + Date.now();
        }
    }
}
