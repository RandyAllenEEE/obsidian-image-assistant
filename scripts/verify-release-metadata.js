#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const expectedPluginId = "obsidian-image-assistant";
const expectedVersion = process.argv
    .slice(2)
    .find(argument => argument !== "--build")
    ?.replace(/^v/, "");
const verifyBuild = process.argv.includes("--build");

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function fail(message) {
    console.error(`[release] ${message}`);
    process.exitCode = 1;
}

const manifest = readJson("manifest.json");
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const versions = readJson("versions.json");
const version = manifest.version;

if (manifest.id !== expectedPluginId) {
    fail(`manifest id must remain ${expectedPluginId}, got ${manifest.id}`);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
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

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
if (!new RegExp(`^## ${version.replace(/\./g, "\\.")} - `, "m").test(changelog)) {
    fail(`CHANGELOG.md has no ${version} release heading`);
}

const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
if (!readme.includes(`What's New in v${version}`)) {
    fail(`README.md does not identify v${version} as the current release`);
}

if (verifyBuild) {
    const buildFiles = fs.readdirSync(path.join(root, "build")).sort();
    const expectedBuildFiles = ["main.js", "manifest.json", "styles.css"];
    const unexpectedBuildFiles = buildFiles.filter(file => !expectedBuildFiles.includes(file));
    const missingBuildFiles = expectedBuildFiles.filter(file => !buildFiles.includes(file));
    if (unexpectedBuildFiles.length || missingBuildFiles.length) {
        fail(`build directory must contain only release artifacts; missing=${missingBuildFiles.join(",") || "none"}, unexpected=${unexpectedBuildFiles.join(",") || "none"}`);
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
        const bundleHeader = fs.readFileSync(bundlePath, "utf8").slice(0, 512);
        if (!bundleHeader.includes(`Image Assistant Plugin v${version}`)) {
            fail(`build/main.js banner does not contain v${version}`);
        }
    }
}

if (!process.exitCode) {
    console.log(`[release] Metadata verified for Image Assistant ${version}${verifyBuild ? " (including build artifacts)" : ""}.`);
}
