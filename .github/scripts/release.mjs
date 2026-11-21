import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

const pluginFiles = ['main.js', 'manifest.json', 'styles.css'];
const manifest = readJson('manifest.json');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function verifyVersion(tag = '') {
  const { version, minAppVersion } = manifest;
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!semver.test(version) || (tag && tag !== version)) {
    throw new Error('The tag must match the manifest version exactly (X.Y.Z).');
  }

  const lock = readJson('package-lock.json');
  if (
    readJson('package.json').version !== version ||
    lock.version !== version ||
    lock.packages?.['']?.version !== version ||
    readJson('versions.json')[version] !== minAppVersion
  ) {
    throw new Error('The manifest, npm package, lockfile, and versions.json disagree.');
  }
}

function verifyPluginFiles(directory) {
  for (const file of pluginFiles) {
    const stat = statSync(join(directory, file));
    if (!stat.isFile() || stat.size === 0) {
      throw new Error('Missing or empty plugin file: ' + file);
    }
  }

  const built = readJson(join(directory, 'manifest.json'));
  for (const key of ['id', 'version', 'minAppVersion']) {
    if (built[key] !== manifest[key]) {
      throw new Error('The built manifest differs from the source manifest: ' + key);
    }
  }
  execFileSync(process.execPath, ['--check', join(directory, 'main.js')], {
    stdio: 'inherit',
  });
}

function stage(buildDirectory, destination, extraFiles) {
  if (existsSync(destination)) {
    throw new Error('The artifact staging directory must be new: ' + destination);
  }
  verifyPluginFiles(buildDirectory);
  mkdirSync(destination, { recursive: true });
  for (const file of [
    ...pluginFiles.map((name) => join(buildDirectory, name)),
    ...extraFiles,
  ]) {
    copyFileSync(file, join(destination, basename(file)));
  }
}

function sha256(bytes) {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

function releaseNotes(version) {
  const escaped = version.replaceAll('.', '\\.');
  const heading = new RegExp('^## ' + escaped + '(?:\\s|$)');
  for (const source of ['release-notes.md', 'CHANGELOG.md']) {
    if (!existsSync(source)) continue;
    const lines = readFileSync(source, 'utf8').split(/\r?\n/);
    const start = lines.findIndex((line) => heading.test(line));
    if (start === -1) continue;
    const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
    return lines.slice(start + 1, end === -1 ? lines.length : end).join('\n').trim();
  }
  return '';
}

function gh(args) {
  return execFileSync('gh', args, { maxBuffer: 128 * 1024 * 1024 });
}

function publish(tag, directory) {
  if (!tag || !process.env.GITHUB_REPOSITORY) {
    throw new Error('Publish requires a GitHub repository and a version tag.');
  }
  verifyVersion(tag);
  verifyPluginFiles(directory);

  const repo = process.env.GITHUB_REPOSITORY;
  const files = readdirSync(directory).sort();
  const localAssets = new Map(files.map((name) => {
    const bytes = readFileSync(join(directory, name));
    if (!bytes.length) throw new Error('Empty release attachment: ' + name);
    return [name, { size: bytes.length, digest: sha256(bytes) }];
  }));

  const pages = JSON.parse(gh(['api', '--paginate', '--slurp', 'repos/' + repo + '/releases?per_page=100']));
  const release = pages.flat().find((candidate) => candidate.tag_name === tag);
  if (release) {
    if (release.draft || release.prerelease || release.assets.length !== localAssets.size) {
      throw new Error('An existing release for ' + tag + ' conflicts with the verified artifact.');
    }

    for (const asset of release.assets) {
      const local = localAssets.get(asset.name);
      if (!local || asset.state !== 'uploaded' || asset.size !== local.size) {
        throw new Error('The existing release has a conflicting attachment: ' + asset.name);
      }
      const digest = asset.digest || sha256(gh([
        'release', 'download', tag, '--repo', repo, '--pattern', asset.name, '--output', '-',
      ]));
      if (digest !== local.digest) {
        throw new Error('The existing release has different attachment bytes: ' + asset.name);
      }
    }
    console.log('Release ' + tag + ' already contains the verified attachments.');
    return;
  }

  const notes = releaseNotes(tag);
  execFileSync('gh', [
    'release', 'create', tag, '--repo', repo, '--verify-tag', '--title', tag,
    ...(notes ? ['--notes', notes] : ['--generate-notes']),
    ...files.map((file) => join(directory, file)),
  ], { stdio: 'inherit' });
}

const [action, ...args] = process.argv.slice(2);
switch (action) {
  case 'verify':
    verifyVersion(args[0]);
    break;
  case 'stage':
    verifyVersion();
    stage(resolve(args[0]), resolve(args[1]), args.slice(2));
    break;
  case 'publish':
    publish(args[0], resolve(args[1]));
    break;
  default:
    throw new Error('Expected verify, stage, or publish.');
}
