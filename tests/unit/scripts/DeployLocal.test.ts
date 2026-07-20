import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_PLUGIN_ID } from "../../helpers/plugin-manifest";

interface DeploymentResult {
    readonly pluginId: string;
    readonly targetDirectory: string;
    readonly enabledPluginsChanged: boolean;
    readonly enabledPluginIds: readonly string[];
    readonly dryRun: boolean;
}

interface DeployLocalModule {
    deployLocalPlugin(options: {
        rootPath: string;
        vaultPath: string;
        dryRun?: boolean;
    }): DeploymentResult;
    normalizeEnabledPluginIds(
        ids: readonly string[],
        pluginId?: string
    ): string[];
}

const deployModule = require(
    "../../../scripts/deploy-local.js"
) as DeployLocalModule;
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("local plugin deployment", () => {
    it("replaces legacy IDs at their first position and removes duplicates", () => {
        expect(deployModule.normalizeEnabledPluginIds([
            "first-plugin",
            "image-Assistant",
            "middle-plugin",
            "image-assistant",
            TEST_PLUGIN_ID,
            "last-plugin"
        ])).toEqual([
            "first-plugin",
            TEST_PLUGIN_ID,
            "middle-plugin",
            "last-plugin"
        ]);
    });

    it("performs a dry run without modifying plugin files or enabled IDs", () => {
        const fixture = createFixture([
            "first-plugin",
            "image-assistant"
        ]);
        const before = fs.readFileSync(fixture.enabledPluginsPath, "utf8");

        const result = deployModule.deployLocalPlugin({
            rootPath: fixture.rootPath,
            vaultPath: fixture.vaultPath,
            dryRun: true
        });

        expect(result.dryRun).toBe(true);
        expect(result.enabledPluginIds).toEqual([
            "first-plugin",
            TEST_PLUGIN_ID
        ]);
        expect(fs.readFileSync(fixture.enabledPluginsPath, "utf8")).toBe(before);
        expect(fs.existsSync(result.targetDirectory)).toBe(false);
    });

    it("deploys release files, preserves data, and enables the manifest ID", () => {
        const fixture = createFixture([
            "first-plugin",
            "image-Assistant",
            "image-assistant",
            "last-plugin"
        ], true);

        const result = deployModule.deployLocalPlugin({
            rootPath: fixture.rootPath,
            vaultPath: fixture.vaultPath
        });

        expect(result.pluginId).toBe(TEST_PLUGIN_ID);
        expect(result.enabledPluginsChanged).toBe(true);
        expect(readJson(fixture.enabledPluginsPath)).toEqual([
            "first-plugin",
            TEST_PLUGIN_ID,
            "last-plugin"
        ]);
        expect(fs.readFileSync(
            path.join(result.targetDirectory, "data.json"),
            "utf8"
        )).toBe("{\"preserved\":true}");
        for (const fileName of ["main.js", "styles.css", "manifest.json"]) {
            expect(hash(path.join(result.targetDirectory, fileName))).toBe(
                hash(path.join(fixture.rootPath, "build", fileName))
            );
        }
    });

    it("fails closed when community-plugins.json is malformed", () => {
        const fixture = createFixture([]);
        fs.writeFileSync(fixture.enabledPluginsPath, "{broken", "utf8");

        expect(() => deployModule.deployLocalPlugin({
            rootPath: fixture.rootPath,
            vaultPath: fixture.vaultPath
        })).toThrow("Unable to read community-plugins.json");
        expect(fs.existsSync(path.join(
            fixture.vaultPath,
            ".obsidian",
            "plugins",
            TEST_PLUGIN_ID
        ))).toBe(false);
    });
});

function createFixture(
    enabledPluginIds: string[],
    withExistingData = false
): {
    rootPath: string;
    vaultPath: string;
    enabledPluginsPath: string;
} {
    const basePath = fs.mkdtempSync(path.join(os.tmpdir(), "image-assistant-"));
    temporaryDirectories.push(basePath);
    const rootPath = path.join(basePath, "repository");
    const vaultPath = path.join(basePath, "vault");
    const buildPath = path.join(rootPath, "build");
    const pluginsPath = path.join(vaultPath, ".obsidian", "plugins");
    const enabledPluginsPath = path.join(
        vaultPath,
        ".obsidian",
        "community-plugins.json"
    );
    fs.mkdirSync(buildPath, { recursive: true });
    fs.mkdirSync(pluginsPath, { recursive: true });
    const manifest = {
        id: TEST_PLUGIN_ID,
        name: "Image Assistant",
        version: "5.0.0"
    };
    fs.writeFileSync(
        path.join(rootPath, "manifest.json"),
        JSON.stringify(manifest),
        "utf8"
    );
    fs.writeFileSync(
        path.join(buildPath, "manifest.json"),
        JSON.stringify(manifest),
        "utf8"
    );
    fs.writeFileSync(path.join(buildPath, "main.js"), "bundle", "utf8");
    fs.writeFileSync(path.join(buildPath, "styles.css"), "styles", "utf8");
    fs.writeFileSync(
        enabledPluginsPath,
        JSON.stringify(enabledPluginIds),
        "utf8"
    );
    if (withExistingData) {
        const targetPath = path.join(pluginsPath, TEST_PLUGIN_ID);
        fs.mkdirSync(targetPath, { recursive: true });
        fs.writeFileSync(
            path.join(targetPath, "manifest.json"),
            JSON.stringify(manifest),
            "utf8"
        );
        fs.writeFileSync(
            path.join(targetPath, "data.json"),
            "{\"preserved\":true}",
            "utf8"
        );
    }
    return { rootPath, vaultPath, enabledPluginsPath };
}

function readJson(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hash(filePath: string): string {
    return crypto
        .createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex");
}
