import { App, Platform } from "obsidian";
import * as fs from "fs/promises";
import { constants as fsConstants } from "fs";
import * as os from "os";
import * as path from "path";

const WINDOWS_ENV_VAR_REGEX = /%([^%]+)%/g;
const POSIX_ENV_VAR_REGEX = /\$(\w+)|\$\{([^}]+)\}/g;

export function normalizeExecutablePath(rawPath: string): string {
    if (!rawPath) return rawPath;

    let normalized = rawPath.trim();
    if (
        (normalized.startsWith('"') && normalized.endsWith('"')) ||
        (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
        normalized = normalized.slice(1, -1).trim();
    }

    normalized = expandTilde(normalized);
    normalized = expandEnvironmentVariables(normalized);

    const pathModule = Platform.isWin ? path.win32 : path.posix;
    return pathModule.normalize(normalized);
}

export async function findFfmpegExecutablePath(app?: App): Promise<string | null> {
    const candidates = new Set<string>();
    const executableName = Platform.isWin ? "ffmpeg.exe" : "ffmpeg";

    addVaultCandidates(candidates, app, executableName);
    addPathCandidates(candidates, executableName);
    addCommonOsCandidates(candidates, executableName);

    for (const candidate of Array.from(candidates).map(normalizeExecutablePath)) {
        if (await isExecutable(candidate)) {
            return candidate;
        }
    }

    return null;
}

function expandTilde(value: string): string {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/") || value.startsWith("~\\")) {
        return path.join(os.homedir(), value.slice(2));
    }
    return value;
}

function expandEnvironmentVariables(value: string): string {
    if (Platform.isWin) {
        return value.replace(WINDOWS_ENV_VAR_REGEX, (_match, name: string) => process.env[name] ?? `%${name}%`);
    }

    return value.replace(POSIX_ENV_VAR_REGEX, (match: string, simple: string, braced: string) => {
        const key = simple ?? braced;
        return key ? process.env[key] ?? match : match;
    });
}

function addVaultCandidates(candidates: Set<string>, app: App | undefined, executableName: string): void {
    const adapter = app?.vault?.adapter as { getBasePath?: () => string } | undefined;
    const basePath = adapter?.getBasePath?.();
    if (!basePath) return;

    [
        path.join(basePath, executableName),
        path.join(basePath, "bin", executableName),
        path.join(basePath, "tools", executableName),
        path.join(basePath, ".bin", executableName),
    ].forEach(candidate => candidates.add(candidate));
}

function addPathCandidates(candidates: Set<string>, executableName: string): void {
    const delimiter = Platform.isWin ? ";" : ":";
    const entries = (process.env.PATH ?? "").split(delimiter).map(entry => entry.trim()).filter(Boolean);
    entries.forEach(entry => candidates.add(path.join(entry, executableName)));
}

function addCommonOsCandidates(candidates: Set<string>, executableName: string): void {
    if (Platform.isWin) {
        const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
        const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
        const programData = process.env.ProgramData ?? "C:\\ProgramData";
        [
            path.join(programFiles, "ffmpeg", "bin", executableName),
            path.join(programFiles, "FFmpeg", "bin", executableName),
            path.join(programFilesX86, "ffmpeg", "bin", executableName),
            path.join(programFilesX86, "FFmpeg", "bin", executableName),
            path.join(programData, "chocolatey", "bin", executableName),
            path.join("C:\\ffmpeg", "bin", executableName),
            path.join("C:\\tools", "ffmpeg", "bin", executableName),
        ].forEach(candidate => candidates.add(candidate));
        return;
    }

    if (Platform.isMacOS) {
        [
            "/opt/homebrew/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            "/usr/bin/ffmpeg",
            "/opt/local/bin/ffmpeg",
        ].forEach(candidate => candidates.add(candidate));
        return;
    }

    [
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/snap/bin/ffmpeg",
        "/var/lib/flatpak/exports/bin/ffmpeg",
        "/home/linuxbrew/.linuxbrew/bin/ffmpeg",
    ].forEach(candidate => candidates.add(candidate));
}

async function isExecutable(candidate: string): Promise<boolean> {
    try {
        if (!candidate) return false;
        const mode = Platform.isWin ? fsConstants.F_OK : fsConstants.X_OK;
        await fs.access(candidate, mode);
        const stat = await fs.stat(candidate);
        return stat.isFile();
    } catch {
        return false;
    }
}
