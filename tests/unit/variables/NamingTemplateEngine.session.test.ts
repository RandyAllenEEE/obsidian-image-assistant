import { beforeEach, describe, expect, it, vi } from "vitest";
import { VariableProcessor } from "../../../src/local/VariableProcessor";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { fakeApp, fakeTFile, fakeVault } from "../../factories/obsidian";

function fixture() {
    const activeFile = fakeTFile({
        path: "notes/Active Note.md",
        name: "Active Note.md",
        basename: "Active Note"
    });
    const vault = fakeVault({ vaultName: "Research Vault" });
    (vault.adapter as any).basePath = "E:/Vault";
    const app = fakeApp({ vault }) as any;
    return {
        activeFile,
        app,
        processor: new VariableProcessor(app, structuredClone(DEFAULT_SETTINGS))
    };
}

describe("NamingEvaluationSession", () => {
    beforeEach(() => {
        (globalThis as any).moment = vi.fn(() => ({
            valueOf: () => 1_750_000_000_123,
            format: (format: string) => format === "YYYY"
                ? "2025"
                : "2025-06-15",
            add() { return this; },
            subtract() { return this; },
            startOf() { return this; },
            endOf() { return this; },
            week: () => 24,
            quarter: () => 2,
            daysInMonth: () => 30,
            calendar: () => "2025-06-15",
            fromNow: () => "now"
        }));
    });

    it("uses one time and random value per operation without recursive expansion", async () => {
        const { activeFile, processor } = fixture();
        const file = new File(
            [new Uint8Array([1])],
            "{date}-$&.png",
            { type: "image/png" }
        );
        const session = processor.createSession({ file, activeFile });
        const first = await session.evaluate(
            "{timestamp}-{timestamp}-{random}-{random}-{imagename}"
        );
        const second = await session.evaluate("{timestamp}-{random}");
        const parts = first.split("-");

        expect(parts[0]).toBe("1750000000123");
        expect(parts[1]).toBe(parts[0]);
        expect(parts[3]).toBe(parts[2]);
        expect(second).toBe(`${parts[0]}-${parts[2]}`);
        expect(first).toContain("{date}-$&");
    });

    it("hashes millisecond time snapshots and preserves custom text exactly", async () => {
        const { activeFile, processor } = fixture();
        const file = new File([new Uint8Array([1])], "image.png");
        const first = await processor.processTemplate(
            "{MD5:time}-{sha256:time}",
            { file, activeFile, nowMs: 1_000 }
        );
        const second = await processor.processTemplate(
            "{MD5:time}-{sha256:time}",
            { file, activeFile, nowMs: 1_001 }
        );
        const custom = await processor.processTemplate(
            "{MD5:Custom Text!}-{MD5:custom text!}",
            { file, activeFile }
        );

        expect(first).not.toBe(second);
        expect(first.split("-")[0]).toHaveLength(32);
        expect(first.split("-")[1]).toHaveLength(64);
        expect(custom.split("-")[0]).not.toBe(custom.split("-")[1]);
    });

    it("shares vault semantics and rejects invalid tokens without consuming counters", async () => {
        const { activeFile, processor } = fixture();
        const file = new File([new Uint8Array([1])], "image.png");

        expect(await processor.processTemplate(
            "{rootfolder}|{vaultpath}|{notepath}",
            { file, activeFile }
        )).toBe("Research Vault|E:/Vault|notes/Active Note.md");
        expect(processor.validateTemplate(
            "{unknown}-{MD5:time:33}-{randomHex:129}",
            { file, activeFile }
        )).toMatchObject({ valid: false });
        await expect(processor.processTemplate(
            "{sha256:time:65}",
            { file, activeFile }
        )).rejects.toThrow(/1 to 64/i);
    });

    it("persists counters across processor instances and isolates scopes", async () => {
        const { activeFile, app, processor } = fixture();
        const file = new File([new Uint8Array([1])], "image.png");
        const template = "{counter:000}";

        expect(await processor.createSession({ file, activeFile })
            .evaluate(template, { counterScope: "assets/a" })).toBe("001");
        const restarted = new VariableProcessor(
            app,
            structuredClone(DEFAULT_SETTINGS)
        );
        expect(await restarted.createSession({ file, activeFile })
            .evaluate(template, { counterScope: "assets/a" })).toBe("002");
        expect(await restarted.createSession({ file, activeFile })
            .evaluate(template, { counterScope: "assets/b" })).toBe("001");
    });

    it("serializes counter reservations across processor instances", async () => {
        const { activeFile, app, processor } = fixture();
        const file = new File([new Uint8Array([1])], "image.png");
        const secondProcessor = new VariableProcessor(
            app,
            structuredClone(DEFAULT_SETTINGS)
        );

        const values = await Promise.all([
            processor.processTemplate("{counter:000}", { file, activeFile }),
            secondProcessor.processTemplate("{counter:000}", { file, activeFile })
        ]);

        expect(new Set(values)).toEqual(new Set(["001", "002"]));
        expect(processor.validateTemplate(
            "{counter:123}",
            { file, activeFile }
        ).valid).toBe(false);
    });

    it("keeps one counter high-water mark across interleaved processor instances", async () => {
        const { activeFile, app, processor } = fixture();
        const file = new File([new Uint8Array([1])], "image.png");
        const secondProcessor = new VariableProcessor(
            app,
            structuredClone(DEFAULT_SETTINGS)
        );

        const first = await processor.processTemplate(
            "{counter:000}",
            { file, activeFile }
        );
        const second = await secondProcessor.processTemplate(
            "{counter:000}",
            { file, activeFile }
        );
        const third = await processor.processTemplate(
            "{counter:000}",
            { file, activeFile }
        );

        expect([first, second, third]).toEqual(["001", "002", "003"]);
    });

    it("fails closed when the persisted counter state is corrupt", async () => {
        const activeFile = fakeTFile({
            path: "notes/Active Note.md",
            name: "Active Note.md",
            basename: "Active Note"
        });
        const statePath = "/.obsidian/plugins/obsidian-image-assistant/naming-counters.json";
        const fileContents = new Map([[statePath, "{broken"]]);
        const vault = fakeVault({ fileContents });
        const app = fakeApp({ vault }) as any;
        const processor = new VariableProcessor(
            app,
            structuredClone(DEFAULT_SETTINGS)
        );
        const file = new File([new Uint8Array([1])], "image.png");

        await expect(processor.processTemplate(
            "{counter:000}",
            { file, activeFile }
        )).rejects.toThrow(/counter state is invalid/i);
    });
});
