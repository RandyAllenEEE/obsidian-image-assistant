import { App, FileSystemAdapter } from "obsidian";
import ImageConverterPlugin from "../main";

const HISTORY_FILE_NAME = "upload_history.json";

export interface UploadRecord {
    url: string;
    [key: string]: any;
}

export class UploadHistoryManager {
    private app: App;
    private plugin: ImageConverterPlugin;
    private history: UploadRecord[] = [];
    private loaded = false;

    constructor(app: App, plugin: ImageConverterPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    /**
     * Initialize: Load history and perform migration if needed
     */
    async init() {
        await this.loadHistory();
        await this.migrateFromSettings();
    }

    private async getAdapter(): Promise<FileSystemAdapter> {
        return this.app.vault.adapter as FileSystemAdapter;
    }

    private async getHistoryFilePath(): Promise<string> {
        const adapter = await this.getAdapter();
        // Store in the plugin's configuration directory usually
        // But for simplicity/robustness, we can store it in the plugin dir or vault root
        // Best practice: Store in .obsidian/plugins/image-assistant/upload_history.json or similar?
        // Or simply adjacent to data.json.
        // To be safe and standard: use the config dir.
        const configDir = this.app.vault.configDir;
        return `${configDir}/plugins/${this.plugin.manifest.id}/${HISTORY_FILE_NAME}`;
    }

    private async loadHistory() {
        const adapter = await this.getAdapter();
        const path = await this.getHistoryFilePath();

        if (await adapter.exists(path)) {
            try {
                const content = await adapter.read(path);
                this.history = JSON.parse(content);
            } catch (e) {
                console.error("Failed to parse upload history:", e);
                this.history = [];
            }
        } else {
            this.history = [];
        }
        this.loaded = true;
    }

    private async saveHistory() {
        const adapter = await this.getAdapter();
        const path = await this.getHistoryFilePath();
        await adapter.write(path, JSON.stringify(this.history, null, 2));
    }

    /**
     * Migrate data from data.json (settings) to this separate file
     */
    private async migrateFromSettings() {
        // Access raw settings to see if 'uploadedImages' exists, 
        // even if removed from the interface type in the future.
        const settings = this.plugin.settings as any;

        if (settings.uploadedImages && Array.isArray(settings.uploadedImages) && settings.uploadedImages.length > 0) {
            console.log(`[Image Assistant] Migrating ${settings.uploadedImages.length} upload records to history file...`);

            // Merge existing history with new migration data
            // Prevent duplicates based on URL
            const existingUrls = new Set(this.history.map(r => r.url));
            const newRecords = settings.uploadedImages.filter((r: any) => r.url && !existingUrls.has(r.url));

            this.history = [...this.history, ...newRecords];
            await this.saveHistory();

            // Clear from settings
            delete settings.uploadedImages;
            await this.plugin.saveSettings();

            console.log(`[Image Assistant] Migration complete.`);
        }
    }

    async addRecord(record: UploadRecord) {
        if (!this.loaded) await this.loadHistory();
        this.history.push(record);
        await this.saveHistory();
    }

    async removeRecord(url: string) {
        if (!this.loaded) await this.loadHistory();
        this.history = this.history.filter(r => !this.isMatch(url, r));
        await this.saveHistory();
    }

    getRecord(url: string): UploadRecord | undefined {
        return this.history.find(r => this.isMatch(url, r));
    }

    /**
     * Check if a given URL matches a history record, supporting PicList placeholders.
     */
    private isMatch(url: string, record: UploadRecord): boolean {
        if (record.url === url || record.imgUrl === url) return true;

        // Pattern matching for PicList placeholders
        if (record.url && record.url.includes('{')) {
            if (this.matchUrlWithPattern(url, record.url)) return true;
        }
        if (record.imgUrl && record.imgUrl.includes('{')) {
            if (this.matchUrlWithPattern(url, record.imgUrl)) return true;
        }

        return false;
    }

    /**
     * Converts a URL pattern with placeholders like {MD5}, {year} into a Regex and matches against target URL.
     */
    private matchUrlWithPattern(url: string, pattern: string): boolean {
        try {
            // Escape special regex characters except for our placeholders
            let regexStr = pattern.replace(/[.*+?^${}()|[\]\\]/g, (match) => {
                if (match === '{' || match === '}') return match; // Keep curly braces for placeholders
                return "\\" + match;
            });

            // Replace placeholders with regex groups
            // {year}, {month}, {day}, {hour}, {minute}, {second} -> \d+
            regexStr = regexStr.replace(/{year}|{month}|{day}|{hour}|{minute}|{second}/g, '\\d+');

            // {MD5}, {uuid}, {fileName}, {extName} -> [a-zA-Z0-9\-_]+
            regexStr = regexStr.replace(/{MD5}|{uuid}|{fileName}|{extName}/g, '[a-zA-Z0-9\\-_]+');

            // Handle custom {MD5:type:length} or similar if they exist in PicList (simplified here)
            regexStr = regexStr.replace(/{[\w:]+}/g, '.*?');

            const regex = new RegExp(`^${regexStr}$`);
            return regex.test(url);
        } catch (e) {
            console.error('[UploadHistoryManager] Pattern match error:', e);
            return false;
        }
    }

    getHistory(): UploadRecord[] {
        return this.history;
    }

    isUrlUploaded(url: string): boolean {
        return this.history.some(r => this.isMatch(url, r));
    }

    isLocalPathUploaded(path: string): boolean {
        return this.history.some(r => r.localPath === path);
    }
}
