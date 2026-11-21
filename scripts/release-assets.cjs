const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdirSync, mkdtempSync, readFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

const noticeAssets = [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'third-party/bundled-dependencies.json',
    'licenses/Apache-2.0.txt',
    'licenses/BSD-3-Clause.txt',
    'licenses/GPL-3.0.txt',
    'licenses/ISC.txt',
    'licenses/LGPL-3.0.txt',
    'licenses/MIT.txt',
    'licenses/UTIF-MIT.txt'
];

const sourceArchives = [
    {
        name: 'heic-to-1.0.2.tgz',
        url: 'https://registry.npmjs.org/heic-to/-/heic-to-1.0.2.tgz',
        sha256: 'ac85610181bb8270faff5e7b5892da9b26131c476f823e695e5b0667675884e7'
    },
    {
        name: 'libheif-1.18.2.tar.gz',
        url: 'https://github.com/strukturag/libheif/releases/download/v1.18.2/libheif-1.18.2.tar.gz',
        sha256: 'c4002a622bec9f519f29d84bfdc6024e33fd67953a5fb4dc2c2f11f67d5e45bf'
    },
    {
        name: 'libde265-1.0.15.tar.gz',
        url: 'https://github.com/strukturag/libde265/releases/download/v1.0.15/libde265-1.0.15.tar.gz',
        sha256: '00251986c29d34d3af7117ed05874950c875dd9292d016be29d3b3762666511d'
    }
];

const complianceBundle = 'licenses-and-source.zip';

function packageRelease(destination) {
    mkdirSync(dirname(destination), { recursive: true });
    const downloads = mkdtempSync(join(dirname(destination), 'image-release-sources-'));
    const verifiedSources = sourceArchives.map(({ name, url, sha256 }) => {
        const file = join(downloads, name);
        execFileSync('curl', [
            '--fail', '--location', '--silent', '--show-error',
            '--retry', '2', '--max-time', '60',
            '--proto', '=https', '--proto-redir', '=https',
            '--output', file, url
        ], { stdio: 'inherit' });
        const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
        if (digest !== sha256) throw new Error('Corresponding source SHA-256 mismatch: ' + name);
        console.log('Verified corresponding source: ' + name);
        return file;
    });

    const bundle = join(downloads, complianceBundle);
    execFileSync('python', [
        '.github/scripts/package-compliance.py', bundle, ...noticeAssets, ...verifiedSources
    ], { stdio: 'inherit' });

    execFileSync(process.execPath, [
        '.github/scripts/release.mjs', 'stage', 'build', destination,
        bundle
    ], { stdio: 'inherit' });
}

module.exports = { noticeAssets, sourceArchives };

if (require.main === module) {
    if (!process.argv[2]) throw new Error('An attachment staging directory is required.');
    packageRelease(resolve(process.argv[2]));
}
