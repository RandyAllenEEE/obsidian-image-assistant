#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const EXPECTED_PLUGIN_ID = "obsidian-image-assistant";
const LEGACY_PLUGIN_IDS = new Set(["image-assistant"]);
const RELEASE_FILES = ["main.js", "styles.css", "manifest.json"];

function parseArguments(argv) {
    let vaultPath = null;
    let dryRun = false;
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--dry-run") {
            dryRun = true;
            continue;
        }
        if (argument === "--vault") {
            vaultPath = argv[++index] ?? null;
            continue;
        }
        if (argument.startsWith("--vault=")) {
            vaultPath = argument.slice("--vault=".length);
            continue;
        }
        throw new Error(`Unknown argument: ${argument}`);
    }
    if (!vaultPath) {
        throw new Error("Missing --vault=<path>");
    }
    return { vaultPath, dryRun };
}

function readJson(filePath, label) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Unable to read ${label}: ${error.message}`);
    }
    return parsed;
}

function normalizeEnabledPluginIds(
    enabledPluginIds,
    pluginId = EXPECTED_PLUGIN_ID
) {
    if (!Array.isArray(enabledPluginIds)
        || enabledPluginIds.some(value => typeof value !== "string")) {
        throw new Error("community-plugins.json must contain an array of strings");
    }

    const normalized = [];
    let inserted = false;
    for (const enabledId of enabledPluginIds) {
        const lowerId = enabledId.toLowerCase();
        const belongsToImageAssistant = enabledId === pluginId
            || LEGACY_PLUGIN_IDS.has(lowerId);
        if (!belongsToImageAssistant) {
            normalized.push(enabledId);
            continue;
        }
        if (!inserted) {
            normalized.push(pluginId);
            inserted = true;
        }
    }
    if (!inserted) normalized.push(pluginId);
    return normalized;
}

function fileHash(filePath) {
    return crypto
        .createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex");
}

function atomicReplaceFromFile(sourcePath, destinationPath) {
    const tempPath = temporaryPath(destinationPath);
    try {
        fs.copyFileSync(sourcePath, tempPath);
        flushFile(tempPath);
        fs.renameSync(tempPath, destinationPath);
    } catch (error) {
        removeIfPresent(tempPath);
        throw error;
    }
}

function atomicWriteText(destinationPath, content) {
    const tempPath = temporaryPath(destinationPath);
    try {
        fs.writeFileSync(tempPath, content, "utf8");
        flushFile(tempPath);
        fs.renameSync(tempPath, destinationPath);
    } catch (error) {
        removeIfPresent(tempPath);
        throw error;
    }
}

function deployLocalPlugin({
    rootPath = process.cwd(),
    vaultPath,
    dryRun = false
}) {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedVault = path.resolve(vaultPath);
    const obsidianDirectory = path.join(resolvedVault, ".obsidian");
    const pluginsDirectory = path.join(obsidianDirectory, "plugins");
    const enabledPluginsPath = path.join(
        obsidianDirectory,
        "community-plugins.json"
    );
    const sourceManifestPath = path.join(resolvedRoot, "manifest.json");
    const buildDirectory = path.join(resolvedRoot, "build");
    const buildManifestPath = path.join(buildDirectory, "manifest.json");

    if (!fs.statSync(resolvedVault, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`Vault directory does not exist: ${resolvedVault}`);
    }
    if (!fs.statSync(obsidianDirectory, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`Vault has no .obsidian directory: ${resolvedVault}`);
    }
    if (!fs.statSync(enabledPluginsPath, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`Missing community-plugins.json: ${enabledPluginsPath}`);
    }

    const sourceManifest = readJson(sourceManifestPath, "manifest.json");
    const buildManifest = readJson(buildManifestPath, "build/manifest.json");
    if (sourceManifest.id !== EXPECTED_PLUGIN_ID) {
        throw new Error(
            `manifest.json id must be ${EXPECTED_PLUGIN_ID}, got ${sourceManifest.id}`
        );
    }
    if (buildManifest.id !== sourceManifest.id
        || buildManifest.version !== sourceManifest.version) {
        throw new Error(
            "build/manifest.json does not match the source manifest"
        );
    }

    for (const fileName of RELEASE_FILES) {
        const sourcePath = path.join(buildDirectory, fileName);
        if (!fs.statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) {
            throw new Error(`Missing build artifact: ${sourcePath}`);
        }
    }

    const targetDirectory = path.join(pluginsDirectory, sourceManifest.id);
    const targetManifestPath = path.join(targetDirectory, "manifest.json");
    if (fs.existsSync(targetManifestPath)) {
        const targetManifest = readJson(
            targetManifestPath,
            "installed manifest.json"
        );
        if (targetManifest.id !== sourceManifest.id) {
            throw new Error(
                `Target directory belongs to plugin ${targetManifest.id}`
            );
        }
    }

    const enabledPluginIds = readJson(
        enabledPluginsPath,
        "community-plugins.json"
    );
    const normalizedEnabledPluginIds = normalizeEnabledPluginIds(
        enabledPluginIds,
        sourceManifest.id
    );
    const enabledPluginsChanged = JSON.stringify(enabledPluginIds)
        !== JSON.stringify(normalizedEnabledPluginIds);

    if (!dryRun) {
        fs.mkdirSync(targetDirectory, { recursive: true });
        for (const fileName of RELEASE_FILES) {
            atomicReplaceFromFile(
                path.join(buildDirectory, fileName),
                path.join(targetDirectory, fileName)
            );
        }
        if (enabledPluginsChanged) {
            atomicWriteText(
                enabledPluginsPath,
                `${JSON.stringify(normalizedEnabledPluginIds, null, 2)}\n`
            );
        }

        for (const fileName of RELEASE_FILES) {
            const sourceHash = fileHash(path.join(buildDirectory, fileName));
            const targetHash = fileHash(path.join(targetDirectory, fileName));
            if (sourceHash !== targetHash) {
                throw new Error(`Hash mismatch after deploying ${fileName}`);
            }
        }
    }

    return Object.freeze({
        pluginId: sourceManifest.id,
        version: sourceManifest.version,
        targetDirectory,
        enabledPluginsChanged,
        enabledPluginIds: Object.freeze([...normalizedEnabledPluginIds]),
        dryRun
    });
}

function flushFile(filePath) {
    const descriptor = fs.openSync(filePath, "r+");
    try {
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}

function temporaryPath(destinationPath) {
    return `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
}

function removeIfPresent(filePath) {
    try {
        fs.rmSync(filePath, { force: true });
    } catch {
        // Preserve the original deployment error.
    }
}

function main() {
    const options = parseArguments(process.argv.slice(2));
    const result = deployLocalPlugin(options);
    const prefix = result.dryRun ? "[deploy:dry-run]" : "[deploy]";
    console.log(
        `${prefix} ${result.pluginId} ${result.version} -> ${result.targetDirectory}`
    );
    console.log(
        `${prefix} enabled IDs: ${result.enabledPluginIds.join(", ")}`
    );
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`[deploy] ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {
    EXPECTED_PLUGIN_ID,
    deployLocalPlugin,
    normalizeEnabledPluginIds,
    parseArguments
};
