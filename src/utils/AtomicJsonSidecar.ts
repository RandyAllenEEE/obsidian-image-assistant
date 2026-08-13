interface SidecarAdapter {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    rename?(oldPath: string, newPath: string): Promise<void>;
    remove?(path: string): Promise<void>;
}

export class AtomicJsonSidecar {
    constructor(
        private readonly adapter: SidecarAdapter,
        readonly path: string,
        private readonly maxBytes: number
    ) { }

    async read(): Promise<unknown | null> {
        for (const candidate of [this.path, `${this.path}.bak`]) {
            try {
                if (!await this.adapter.exists(candidate)) continue;
                const content = await this.adapter.read(candidate);
                if (new TextEncoder().encode(content).byteLength > this.maxBytes) continue;
                return JSON.parse(content) as unknown;
            } catch (error) {
                console.warn(`[Image Assistant] Failed to read JSON sidecar ${candidate}:`, error);
            }
        }
        return null;
    }

    async write(value: unknown): Promise<void> {
        const content = JSON.stringify(value);
        if (new TextEncoder().encode(content).byteLength > this.maxBytes) {
            throw new Error(`JSON sidecar ${this.path} exceeded its storage limit.`);
        }
        const rename = this.adapter.rename?.bind(this.adapter);
        const remove = this.adapter.remove?.bind(this.adapter);
        if (!rename || !remove) {
            await this.adapter.write(this.path, content);
            return;
        }

        const temp = `${this.path}.tmp`;
        const backup = `${this.path}.bak`;
        if (await this.adapter.exists(temp)) await remove(temp);
        await this.adapter.write(temp, content);
        let movedOriginal = false;
        try {
            if (await this.adapter.exists(this.path)) {
                if (await this.adapter.exists(backup)) await remove(backup);
                await rename(this.path, backup);
                movedOriginal = true;
            }
            await rename(temp, this.path);
            // Keep the last known-good primary as a durable backup. The next
            // write replaces it only after the new temporary file is complete,
            // allowing read() to recover from corruption discovered later.
        } catch (error) {
            if (!await this.adapter.exists(this.path)
                && movedOriginal
                && await this.adapter.exists(backup)) {
                await rename(backup, this.path);
            }
            throw error;
        } finally {
            if (await this.adapter.exists(temp)) await remove(temp);
        }
    }
}
