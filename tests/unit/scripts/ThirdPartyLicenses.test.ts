import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const inventory = readJson<{
    formatVersion: number;
    packages: Array<{ name: string; version: string; license: string }>;
}>("third-party/bundled-dependencies.json");

describe("third-party license delivery", () => {
    it("pins notices to the exact vendored sources and line-ending normalization", () => {
        expect(sha256("src/heic-to.min.js")).toBe(
            "9a2ff22899ad5c28cd461e68c9370b263abb6ee418b78229d8bc14beecdcbe9e"
        );
        expect(sha256("src/UTIF.js")).toBe(
            "b8f55e42f779ebfc2f7fe88f59dea6393a3f4282a03ea5d503f98fec3dbe69d0"
        );
        expect(sha256Text(read("src/UTIF.js").replace(/\r\n/g, "\n"))).toBe(
            "b74b27602365347f78ae9977aa31aa8b6522a2f656152523cca3872adef1000d"
        );

        const notices = read("THIRD_PARTY_NOTICES.md");
        for (const sourceIdentity of [
            "heic-to 1.0.2",
            "Embedded libheif 1.18.2",
            "Embedded libde265 1.0.15",
            "97313f3387b722fc50593785923f1ec9b4db2a46",
            "1159ec68f781d2ad45383c2ffa14573e993b959e",
            "bd3e6c03d698115c06658e4eb8ba4bf7b6eb06898b9a0bf114805db2485fefc4",
            "libheif/tree/v1.18.2",
            "libde265/tree/v1.0.15",
            "2e6be655cb1beee3b4fc193deefee35b10b3a68c",
            "b74b27602365347f78ae9977aa31aa8b6522a2f656152523cca3872adef1000d",
            "1,762 LF line endings to CRLF",
            "third-party/bundled-dependencies.json"
        ]) {
            expect(notices).toContain(sourceIdentity);
        }
    });

    it("keeps a complete pinned inventory in the notice and build banner source", () => {
        expect(inventory.formatVersion).toBe(1);
        expect(new Set(inventory.packages.map(dependency => dependency.name)).size)
            .toBe(inventory.packages.length);
        expect(inventory.packages).toHaveLength(26);

        const notices = read("THIRD_PARTY_NOTICES.md");
        const buildConfig = read("esbuild.config.mjs");
        for (const dependency of inventory.packages) {
            expect(noticeContainsDependency(notices, dependency)).toBe(true);
            expect(buildConfig).toContain("bundledDependencySummary");
            expect(buildConfig).toContain("bundled-dependencies.json");
        }
        expect(notices).not.toContain("`@ai-sdk/gateway` 3.0.55");
    });

    it("ships complete license texts required by the inventory", () => {
        for (const [licensePath, fragment] of [
            ["licenses/Apache-2.0.txt", "Version 2.0, January 2004"],
            ["licenses/BSD-3-Clause.txt", "BSD 3-Clause License"],
            ["licenses/GPL-3.0.txt", "GNU GENERAL PUBLIC LICENSE"],
            ["licenses/ISC.txt", "The ISC License"],
            ["licenses/LGPL-3.0.txt", "GNU LESSER GENERAL PUBLIC LICENSE"],
            ["licenses/MIT.txt", "MIT License"],
            ["licenses/UTIF-MIT.txt", "Copyright (c) 2017 Photopea"]
        ] as const) {
            expect(read(licensePath)).toContain(fragment);
        }
    });

    it("publishes every notice asset and rejects stale manifest synchronization", () => {
        const workflow = read(".github/workflows/build-draft-release.yml");
        const releaseActionIndex = workflow.indexOf(
            "uses: softprops/action-gh-release@v2"
        );
        expect(releaseActionIndex).toBeGreaterThanOrEqual(0);
        const uploadSection = workflow.slice(releaseActionIndex);
        for (const releaseAsset of [
            "LICENSE",
            "THIRD_PARTY_NOTICES.md",
            "third-party/bundled-dependencies.json",
            "licenses/Apache-2.0.txt",
            "licenses/BSD-3-Clause.txt",
            "licenses/GPL-3.0.txt",
            "licenses/ISC.txt",
            "licenses/LGPL-3.0.txt",
            "licenses/MIT.txt",
            "licenses/UTIF-MIT.txt",
            "heic-to-1.0.2.tgz",
            "libheif-1.18.2.tar.gz",
            "libde265-1.0.15.tar.gz"
        ]) {
            expect(uploadSection).toContain(releaseAsset);
        }
        expect(uploadSection).toContain("fail_on_unmatched_files: true");
        expect(fs.existsSync(path.join(repositoryRoot, ".github/workflows/sync-manifest.yml")))
            .toBe(false);
    });
});

function read(relativePath: string): string {
    return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
    return JSON.parse(read(relativePath)) as T;
}

function sha256(relativePath: string): string {
    return crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(repositoryRoot, relativePath)))
        .digest("hex");
}

function sha256Text(value: string): string {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function noticeContainsDependency(
    notices: string,
    dependency: { name: string; version: string }
): boolean {
    const packagePattern = dependency.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const versionPattern = dependency.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
        "`" + packagePattern + "`(?:\\s*\\|\\s*|\\s+)" + versionPattern + "(?:\\s|\\||$)"
    ).test(notices);
}
