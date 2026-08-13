#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = process.cwd();
const expectedPluginId = "obsidian-image-assistant";
const expectedVersion = process.argv
    .slice(2)
    .find(argument => argument !== "--build")
    ?.replace(/^v/, "");
const verifyBuild = process.argv.includes("--build");
const bundledDependencyInventoryPath = "third-party/bundled-dependencies.json";
const thirdPartyAssets = [
    "THIRD_PARTY_NOTICES.md",
    bundledDependencyInventoryPath,
    "licenses/Apache-2.0.txt",
    "licenses/BSD-3-Clause.txt",
    "licenses/GPL-3.0.txt",
    "licenses/ISC.txt",
    "licenses/LGPL-3.0.txt",
    "licenses/MIT.txt",
    "licenses/UTIF-MIT.txt"
];

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function fail(message) {
    console.error(`[release] ${message}`);
    process.exitCode = 1;
}

function sha256(relativePath) {
    return crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, relativePath)))
        .digest("hex");
}

const manifest = readJson("manifest.json");
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const versions = readJson("versions.json");
const bundledDependencyInventory = readJson(bundledDependencyInventoryPath);
const version = manifest.version;

if (manifest.id !== expectedPluginId) {
    fail(`manifest id must remain ${expectedPluginId}, got ${manifest.id}`);
}
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    fail(`manifest version is not valid SemVer: ${version}`);
}
if (expectedVersion && expectedVersion !== version) {
    fail(`tag version ${expectedVersion} does not match manifest version ${version}`);
}
if (packageJson.version !== version) {
    fail(`package.json version ${packageJson.version} does not match ${version}`);
}
if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) {
    fail(`package-lock.json root version does not match ${version}`);
}
if (versions[version] !== manifest.minAppVersion) {
    fail(`versions.json must map ${version} to Obsidian ${manifest.minAppVersion}`);
}
if (packageJson.private !== true) {
    fail("package.json must keep the release package private");
}

for (const asset of thirdPartyAssets) {
    if (!fs.statSync(path.join(root, asset), { throwIfNoEntry: false })?.isFile()) {
        fail(`missing third-party compliance asset: ${asset}`);
    }
}

if (sha256("src/heic-to.min.js")
    !== "9a2ff22899ad5c28cd461e68c9370b263abb6ee418b78229d8bc14beecdcbe9e") {
    fail("src/heic-to.min.js changed without updating its pinned notice");
}
if (sha256("src/UTIF.js")
    !== "b8f55e42f779ebfc2f7fe88f59dea6393a3f4282a03ea5d503f98fec3dbe69d0") {
    fail("src/UTIF.js changed without updating its pinned notice");
}
const normalizedUtifHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, "src/UTIF.js"), "utf8").replace(/\r\n/g, "\n"), "utf8")
    .digest("hex");
if (normalizedUtifHash !== "b74b27602365347f78ae9977aa31aa8b6522a2f656152523cca3872adef1000d") {
    fail("src/UTIF.js program content changed without updating its pinned upstream identity");
}

if (bundledDependencyInventory.formatVersion !== 1 || !Array.isArray(bundledDependencyInventory.packages)) {
    fail(`${bundledDependencyInventoryPath} must declare formatVersion 1 and a packages array`);
}

const inventoryByName = new Map();
for (const dependency of bundledDependencyInventory.packages) {
    if (!dependency
        || typeof dependency.name !== "string"
        || typeof dependency.version !== "string"
        || typeof dependency.license !== "string"
        || typeof dependency.copyright !== "string"
        || typeof dependency.source !== "string") {
        fail(`${bundledDependencyInventoryPath} contains an invalid dependency entry`);
        continue;
    }
    if (inventoryByName.has(dependency.name)) {
        fail(`${bundledDependencyInventoryPath} contains duplicate package ${dependency.name}`);
        continue;
    }
    inventoryByName.set(dependency.name, dependency);

    const lockEntry = packageLock.packages?.[`node_modules/${dependency.name}`];
    const installedPackagePath = path.join(root, "node_modules", dependency.name, "package.json");
    const installedPackage = fs.existsSync(installedPackagePath)
        ? JSON.parse(fs.readFileSync(installedPackagePath, "utf8"))
        : null;
    const actualLicense = installedPackage?.license ?? lockEntry?.license;
    if (lockEntry?.version !== dependency.version || actualLicense !== dependency.license) {
        fail(`${dependency.name} must remain ${dependency.version} (${dependency.license}) or its inventory must be updated`);
    }
}
if (inventoryByName.size === 0) {
    fail(`${bundledDependencyInventoryPath} must not be empty`);
}

const thirdPartyNotices = fs.readFileSync(
    path.join(root, "THIRD_PARTY_NOTICES.md"),
    "utf8"
);
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function noticeContainsDependency(notices, dependency) {
    const packagePattern = escapeRegExp(dependency.name);
    const versionPattern = escapeRegExp(dependency.version);
    return new RegExp(
        "`" + packagePattern + "`(?:\\s*\\|\\s*|\\s+)" + versionPattern + "(?:\\s|\\||$)"
    ).test(notices);
}

for (const requiredNotice of [
    "heic-to 1.0.2",
    "Embedded libheif 1.18.2",
    "Embedded libde265 1.0.15",
    "97313f3387b722fc50593785923f1ec9b4db2a46",
    "1159ec68f781d2ad45383c2ffa14573e993b959e",
    "bd3e6c03d698115c06658e4eb8ba4bf7b6eb06898b9a0bf114805db2485fefc4",
    "libheif/tree/v1.18.2",
    "libde265/tree/v1.0.15",
    "ac85610181bb8270faff5e7b5892da9b26131c476f823e695e5b0667675884e7",
    "c4002a622bec9f519f29d84bfdc6024e33fd67953a5fb4dc2c2f11f67d5e45bf",
    "00251986c29d34d3af7117ed05874950c875dd9292d016be29d3b3762666511d",
    "2e6be655cb1beee3b4fc193deefee35b10b3a68c",
    "b74b27602365347f78ae9977aa31aa8b6522a2f656152523cca3872adef1000d",
    "1,762 LF line endings to CRLF",
    "third-party/bundled-dependencies.json"
]) {
    if (!thirdPartyNotices.includes(requiredNotice)) {
        fail(`THIRD_PARTY_NOTICES.md is missing: ${requiredNotice}`);
    }
}
for (const dependency of inventoryByName.values()) {
    if (!noticeContainsDependency(thirdPartyNotices, dependency)) {
        fail(`THIRD_PARTY_NOTICES.md is missing ${dependency.name} ${dependency.version}`);
    }
}

const licenseRequirements = Object.freeze({
    "licenses/Apache-2.0.txt": [
        "Copyright 2023 Vercel, Inc.",
        "Apache License",
        "Version 2.0, January 2004"
    ],
    "licenses/BSD-3-Clause.txt": [
        "BSD 3-Clause License",
        "Copyright 2008 Fair Oaks Labs, Inc."
    ],
    "licenses/GPL-3.0.txt": [
        "GNU GENERAL PUBLIC LICENSE",
        "Version 3, 29 June 2007"
    ],
    "licenses/ISC.txt": [
        "The ISC License",
        "Permission to use, copy, modify, and/or distribute"
    ],
    "licenses/LGPL-3.0.txt": [
        "GNU LESSER GENERAL PUBLIC LICENSE",
        "Version 3, 29 June 2007"
    ],
    "licenses/MIT.txt": [
        "MIT License",
        "Permission is hereby granted, free of charge"
    ],
    "licenses/UTIF-MIT.txt": [
        "Copyright (c) 2017 Photopea",
        "Permission is hereby granted"
    ]
});
for (const [licensePath, requiredFragments] of Object.entries(licenseRequirements)) {
    const licenseText = fs.readFileSync(path.join(root, licensePath), "utf8");
    for (const fragment of requiredFragments) {
        if (!licenseText.includes(fragment)) {
            fail(`${licensePath} is incomplete; missing: ${fragment}`);
        }
    }
}

const releaseWorkflow = fs.readFileSync(
    path.join(root, ".github/workflows/build-draft-release.yml"),
    "utf8"
);
const releaseActionMarker = "uses: softprops/action-gh-release@v2";
const releaseActionIndex = releaseWorkflow.indexOf(releaseActionMarker);
const releaseUploadSection = releaseActionIndex >= 0
    ? releaseWorkflow.slice(releaseActionIndex)
    : "";
if (!releaseUploadSection) {
    fail(`draft release workflow is missing ${releaseActionMarker}`);
}
for (const requiredReleaseSetting of ["draft: true", "fail_on_unmatched_files: true"]) {
    if (!releaseUploadSection.includes(requiredReleaseSetting)) {
        fail(`draft release workflow is missing ${requiredReleaseSetting}`);
    }
}
if (fs.existsSync(path.join(root, ".github/workflows/sync-manifest.yml"))) {
    fail("deprecated manifest-sync workflow must not be present");
}
for (const asset of ["LICENSE", ...thirdPartyAssets]) {
    if (!releaseUploadSection.includes(asset)) {
        fail(`draft release workflow does not publish ${asset}`);
    }
}
for (const pinnedSourceArtifact of [
    "heic-to-1.0.2.tgz",
    "libheif-1.18.2.tar.gz",
    "libde265-1.0.15.tar.gz"
]) {
    if (!releaseUploadSection.includes(pinnedSourceArtifact)) {
        fail(`draft release workflow does not publish pinned source: ${pinnedSourceArtifact}`);
    }
}
for (const pinnedSourceChecksum of [
    "ac85610181bb8270faff5e7b5892da9b26131c476f823e695e5b0667675884e7",
    "c4002a622bec9f519f29d84bfdc6024e33fd67953a5fb4dc2c2f11f67d5e45bf",
    "00251986c29d34d3af7117ed05874950c875dd9292d016be29d3b3762666511d"
]) {
    if (!releaseWorkflow.includes(pinnedSourceChecksum)) {
        fail(`draft release workflow is missing source checksum: ${pinnedSourceChecksum}`);
    }
}

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
if (!new RegExp(`^## ${version.replace(/\./g, "\\.")} - `, "m").test(changelog)) {
    fail(`CHANGELOG.md has no ${version} release heading`);
}

const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
if (!readme.includes(`What's New in v${version}`)) {
    fail(`README.md does not identify v${version} as the current release`);
}

function packageNameFromMetafileInput(inputPath) {
    const segments = inputPath.replace(/\\/g, "/").split("/");
    const nodeModulesIndex = segments.lastIndexOf("node_modules");
    if (nodeModulesIndex < 0 || nodeModulesIndex + 1 >= segments.length) {
        return null;
    }
    const firstSegment = segments[nodeModulesIndex + 1];
    return firstSegment.startsWith("@")
        ? `${firstSegment}/${segments[nodeModulesIndex + 2] ?? ""}`
        : firstSegment;
}

function bundledPackagesFromMetafile(metafile) {
    const packages = new Set();
    for (const bundle of Object.values(metafile.bundles ?? {})) {
        for (const output of Object.values(bundle.outputs ?? {})) {
            for (const [inputPath, input] of Object.entries(output.inputs ?? {})) {
                if (input.bytesInOutput <= 0) {
                    continue;
                }
                const packageName = packageNameFromMetafileInput(inputPath);
                if (packageName) {
                    packages.add(packageName);
                }
            }
        }
    }
    return packages;
}

if (verifyBuild) {
    const buildFiles = fs.readdirSync(path.join(root, "build")).sort();
    const expectedBuildFiles = ["esbuild-metafile.json", "main.js", "manifest.json", "styles.css"];
    const unexpectedBuildFiles = buildFiles.filter(file => !expectedBuildFiles.includes(file));
    const missingBuildFiles = expectedBuildFiles.filter(file => !buildFiles.includes(file));
    if (unexpectedBuildFiles.length || missingBuildFiles.length) {
        fail(`build directory must contain release artifacts plus esbuild-metafile.json; missing=${missingBuildFiles.join(",") || "none"}, unexpected=${unexpectedBuildFiles.join(",") || "none"}`);
    }

    const buildMetafile = readJson("build/esbuild-metafile.json");
    if (buildMetafile.formatVersion !== 1 || buildMetafile.production !== true) {
        fail("build/esbuild-metafile.json must describe a production build");
    }
    const actualBundledPackages = bundledPackagesFromMetafile(buildMetafile);
    const expectedBundledPackages = new Set(inventoryByName.keys());
    const missingBundledPackages = [...expectedBundledPackages]
        .filter(packageName => !actualBundledPackages.has(packageName));
    const unexpectedBundledPackages = [...actualBundledPackages]
        .filter(packageName => !expectedBundledPackages.has(packageName));
    if (missingBundledPackages.length || unexpectedBundledPackages.length) {
        fail(`third-party bundle inventory mismatch; missing=${missingBundledPackages.join(",") || "none"}, unexpected=${unexpectedBundledPackages.join(",") || "none"}`);
    }

    const buildManifest = readJson("build/manifest.json");
    if (buildManifest.id !== expectedPluginId) {
        fail(`build/manifest.json id must be ${expectedPluginId}`);
    }
    if (buildManifest.version !== version) {
        fail(`build/manifest.json version ${buildManifest.version} does not match ${version}`);
    }

    const bundlePath = path.join(root, "build/main.js");
    const stylesPath = path.join(root, "build/styles.css");
    if (!fs.existsSync(bundlePath) || !fs.existsSync(stylesPath)) {
        fail("build/main.js and build/styles.css must both exist");
    } else {
        const bundleHeader = fs.readFileSync(bundlePath, "utf8").slice(0, 16384);
        if (!bundleHeader.includes(`Image Assistant Plugin v${version}`)) {
            fail(`build/main.js banner does not contain v${version}`);
        }
        for (const requiredBannerNotice of [
            "heic-to 1.0.2 (LGPL-3.0-only)",
            "UTIF.js revision 2e6be655cb1beee3b4fc193deefee35b10b3a68c (MIT)",
            "THIRD_PARTY_NOTICES.md"
        ]) {
            if (!bundleHeader.includes(requiredBannerNotice)) {
                fail(`build/main.js banner is missing: ${requiredBannerNotice}`);
            }
        }
        for (const dependency of inventoryByName.values()) {
            const bannerDependency = `- ${dependency.name} ${dependency.version} (${dependency.license})`;
            if (!bundleHeader.includes(bannerDependency)) {
                fail(`build/main.js banner is missing: ${bannerDependency}`);
            }
        }
    }
}

if (!process.exitCode) {
    console.log(`[release] Metadata verified for Image Assistant ${version}${verifyBuild ? " (including build artifacts)" : ""}.`);
}
