#!/usr/bin/env node

/**
 * prepare-release.js
 * 
 * This script verifies committed release metadata and creates a git tag
 * without modifying any files. The GitHub Actions workflow will:
 * 1. Build the plugin
 * 2. Create a draft release with the compiled files
 * 3. Refuse to publish if tag, package, manifest, docs, and bundle disagree
 * 
 * Usage: npm run pre-release -- X.Y.Z
 * Example: npm run pre-release -- 5.0.0
 * 
 * The script will:
 * - Verify there are no uncommitted changes
 * - Check if tag already exists
 * - Create a git tag with the specified version
 * - Push the tag to trigger GitHub Actions
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get version from command line
const version = process.argv[2];

if (!version) {
    console.error('❌ Please provide a version number: npm run pre-release X.Y.Z');
    process.exit(1);
}

// Support both formats: 1.3.17 and v1.3.17
const versionRegex = /^v?\d+\.\d+\.\d+$/;
if (!versionRegex.test(version)) {
    console.error('❌ Version must be in format X.Y.Z or vX.Y.Z');
    process.exit(1);
}

// Normalize version (remove 'v' prefix if present for consistency)
const cleanVersion = version.replace(/^v/, '');
const tagName = cleanVersion;  // or use `v${cleanVersion}` if you prefer v-prefix
let tagCreated = false;

// Get current version from manifest.json for comparison
const manifestPath = path.join(process.cwd(), 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const currentVersion = manifest.version;

console.log(`\n📦 Current version: ${currentVersion}`);
console.log(`🚀 Creating release: ${cleanVersion}\n`);

try {
    // Check if there are uncommitted changes
    const status = execSync('git status --porcelain').toString();
    if (status) {
        console.error('⚠️  You have uncommitted changes. Please commit or stash them first.');
        console.error('\nUncommitted files:');
        console.error(status);
        process.exit(1);
    }

    // Release metadata must be committed before the tag is created.
    execSync(`node scripts/verify-release-metadata.js ${cleanVersion}`, { stdio: 'inherit' });
    
    // Releases are cut only from the synchronized canonical branch. Fetch before
    // inspecting tags or ancestry so every decision uses the current remote state.
    console.log('📡 Fetching latest origin/main...');
    execSync('git fetch --prune --tags origin main', { stdio: 'inherit' });

    const currentBranch = execSync('git branch --show-current').toString().trim();
    if (currentBranch !== 'main') {
        throw new Error(`Releases must be created from main, not ${currentBranch || '(detached HEAD)'}.`);
    }

    const upstream = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}').toString().trim();
    if (upstream !== 'origin/main') {
        throw new Error(`main must track origin/main before release (current upstream: ${upstream || 'none'}).`);
    }

    const [behind, ahead] = execSync('git rev-list --left-right --count origin/main...HEAD')
        .toString()
        .trim()
        .split(/\s+/)
        .map(Number);
    if (behind !== 0 || ahead !== 0) {
        throw new Error(`main must exactly match origin/main before release (behind=${behind}, ahead=${ahead}). Push or reconcile it first.`);
    }

    // Check if tag already exists locally. The version regex above makes this
    // exact pattern safe and prevents wildcard tag matches.
    const localTag = execSync(`git tag --list ${tagName}`).toString().trim();
    if (localTag) {
        throw new Error(`Tag ${tagName} already exists locally.`);
    }
    
    // Check if tag exists on remote
    const remoteTag = execSync(`git ls-remote --tags origin refs/tags/${tagName}`, { stdio: 'pipe' })
        .toString()
        .trim();
    if (remoteTag) {
        throw new Error(`Tag ${tagName} already exists on origin.`);
    }
    
    // Create tag for the release (WITHOUT modifying any files)
    execSync(`git tag -a ${tagName} -m "Release ${cleanVersion}"`, { stdio: 'inherit' });
    tagCreated = true;
    console.log(`✅ Created tag ${tagName}`);
    
    // Push the tag to trigger GitHub Actions
    console.log('\n📤 Pushing tag to remote...');
    execSync(`git push origin ${tagName}`, { stdio: 'inherit' });
    console.log(`✅ Pushed tag ${tagName} to remote`);
    
    console.log(`\n🎉 Release tag ${cleanVersion} created successfully!`);
    console.log('\n📝 Next steps:');
    console.log('1. ⚙️  GitHub Actions will build and create a DRAFT release');
    console.log('2. 👀 Review the draft release on GitHub');
    console.log('3. 📢 Publish only after reviewing artifacts, notices, and release notes');
    console.log('\n🔗 View the workflow at:');
    console.log(`   https://github.com/RandyAllenEEE/obsidian-image-assistant/actions`);
    
} catch (error) {
    console.error('\n❌ Error during release preparation:', error.message);
    
    // Only remove a tag created by this process. Never delete a pre-existing tag
    // when an earlier validation or network operation fails.
    if (tagCreated) {
        try {
            execSync(`git tag -d ${tagName}`, { stdio: 'pipe' });
            console.log('🧹 Cleaned up local tag');
        } catch {
            // Silently ignore if tag cleanup fails
        }
    }
    
    process.exit(1);
}
