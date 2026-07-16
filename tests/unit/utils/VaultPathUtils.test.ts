import { describe, expect, it } from "vitest";
import { assertSafeVaultFilename, normalizeVaultFolderPath } from "../../../src/utils/VaultPathUtils";

describe("VaultPathUtils", () => {
    it("normalizes vault-root and relative folder paths", () => {
        expect(normalizeVaultFolderPath("/")).toBe("/");
        expect(normalizeVaultFolderPath("/Assets/Images/")).toBe("Assets/Images");
        expect(normalizeVaultFolderPath("./Assets/Images")).toBe("Assets/Images");
    });

    it.each(["../outside", "Assets/../../outside", "C:\\outside", "//server/share", "bad:name"])(
        "rejects unsafe vault folder path %s",
        path => expect(() => normalizeVaultFolderPath(path)).toThrow()
    );

    it("rejects path separators and traversal filenames", () => {
        expect(() => assertSafeVaultFilename("../image.png")).toThrow();
        expect(() => assertSafeVaultFilename("folder/image.png")).toThrow();
        expect(() => assertSafeVaultFilename("image.png")).not.toThrow();
    });
});
