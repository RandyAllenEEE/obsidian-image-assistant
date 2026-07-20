import { describe, expect, it } from "vitest";
import { FolderAndFilenameManagement } from "../../../src/local/FolderAndFilenameManagement";
import { SupportedImageFormats } from "../../../src/local/SupportedImageFormats";
import { VariableProcessor } from "../../../src/local/VariableProcessor";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { fakeApp, fakeVault } from "../../factories/obsidian";

describe("FolderAndFilenameManagement sanitization and folders", () => {
    function makeFFM() {
        const app = fakeApp({ vault: fakeVault() }) as any;
        const supported = new SupportedImageFormats(app);
        const settings = structuredClone(DEFAULT_SETTINGS);
        const processor = new VariableProcessor(app, settings);
        return {
            app,
            ffm: new FolderAndFilenameManagement(
                app,
                settings,
                supported,
                processor
            )
        };
    }

    it("sanitizes invalid characters, reserved names and trailing dots", () => {
        const { ffm } = makeFFM();

        expect(ffm.sanitizeFilename("  My/File\\Name??**.txt  "))
            .toBe("My_File_Name____.txt");
        expect(ffm.sanitizeFilename("CON")).toBe("CON_");
        expect(ffm.sanitizeFilename("..hidden..file..")).toBe("hidden..file");
    });

    it("normalizes Unicode and limits the UTF-8 component length", () => {
        const { ffm } = makeFFM();
        const decomposed = `Cafe\u0301-${"测".repeat(120)}.png`;
        const result = ffm.sanitizeFilename(decomposed);

        expect(result.startsWith("Café-")).toBe(true);
        expect(result.endsWith(".png")).toBe(true);
        expect(new TextEncoder().encode(result).byteLength)
            .toBeLessThanOrEqual(240);
    });

    it("combines root and nested vault paths", () => {
        const { ffm } = makeFFM();

        expect(ffm.combinePath("/", "name.png")).toBe("/name.png");
        expect(ffm.combinePath("base", "name.png")).toBe("base/name.png");
    });

    it("creates missing nested folders", async () => {
        const { app, ffm } = makeFFM();

        await ffm.ensureFolderExists("alpha/beta/gamma");

        expect(app.vault.createFolder).toHaveBeenCalledTimes(3);
    });
});
