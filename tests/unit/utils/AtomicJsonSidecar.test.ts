import { AtomicJsonSidecar } from "../../../src/utils/AtomicJsonSidecar";

describe("AtomicJsonSidecar", () => {
    it("falls back to a valid backup when the primary file is damaged", async () => {
        const adapter = new MemoryAdapter();
        adapter.files.set("state.json", "{broken");
        adapter.files.set("state.json.bak", JSON.stringify({ ok: true }));
        const sidecar = new AtomicJsonSidecar(adapter, "state.json", 1_024);

        await expect(sidecar.read()).resolves.toEqual({ ok: true });
    });

    it("restores the original when the temporary rename fails", async () => {
        const adapter = new MemoryAdapter();
        adapter.files.set("state.json", JSON.stringify({ version: 1 }));
        adapter.failRenameToPrimary = true;
        const sidecar = new AtomicJsonSidecar(adapter, "state.json", 1_024);

        await expect(sidecar.write({ version: 2 })).rejects.toThrow(/rename failed/);
        expect(JSON.parse(adapter.files.get("state.json")!)).toEqual({ version: 1 });
        expect(adapter.files.has("state.json.tmp")).toBe(false);
    });

    it("retains the previous valid primary after a successful replacement", async () => {
        const adapter = new MemoryAdapter();
        adapter.files.set("state.json", JSON.stringify({ version: 1 }));
        const sidecar = new AtomicJsonSidecar(adapter, "state.json", 1_024);

        await sidecar.write({ version: 2 });

        expect(JSON.parse(adapter.files.get("state.json")!)).toEqual({ version: 2 });
        expect(JSON.parse(adapter.files.get("state.json.bak")!)).toEqual({ version: 1 });

        adapter.files.set("state.json", "{damaged");
        await expect(sidecar.read()).resolves.toEqual({ version: 1 });
    });
});

class MemoryAdapter {
    readonly files = new Map<string, string>();
    failRenameToPrimary = false;

    async exists(path: string): Promise<boolean> {
        return this.files.has(path);
    }

    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error("missing");
        return value;
    }

    async write(path: string, value: string): Promise<void> {
        this.files.set(path, value);
    }

    async remove(path: string): Promise<void> {
        this.files.delete(path);
    }

    async rename(from: string, to: string): Promise<void> {
        if (this.failRenameToPrimary && from.endsWith(".tmp") && to === "state.json") {
            this.failRenameToPrimary = false;
            throw new Error("rename failed");
        }
        const value = await this.read(from);
        this.files.set(to, value);
        this.files.delete(from);
    }
}
