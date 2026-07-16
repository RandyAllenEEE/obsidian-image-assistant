import { promises as dns } from "dns";
import { isIP } from "net";
import { withTimeout } from "./NetworkRequestUtils";

const DNS_LOOKUP_TIMEOUT_MS = 10_000;

export function isHttpUrl(value: string): boolean {
    try {
        const protocol = new URL(value.trim()).protocol.toLowerCase();
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Compare HTTP(S) references without changing case-sensitive resource parts.
 * URL parsing normalizes protocol/host casing and default ports; path, query,
 * fragment, and credentials remain exact. A trailing path slash is the only
 * resource normalization applied.
 */
export function isSameHttpUrl(candidate: string, targetUrl: string): boolean {
    if (candidate === targetUrl) return true;

    const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");
    try {
        const actual = new URL(candidate);
        const target = new URL(targetUrl);
        return actual.protocol.toLowerCase() === target.protocol.toLowerCase()
            && actual.hostname.toLowerCase() === target.hostname.toLowerCase()
            && actual.port === target.port
            && actual.username === target.username
            && actual.password === target.password
            && stripTrailingSlash(actual.pathname) === stripTrailingSlash(target.pathname)
            && actual.search === target.search
            && actual.hash === target.hash;
    } catch {
        return stripTrailingSlash(candidate) === stripTrailingSlash(targetUrl);
    }
}

export function parseDomainList(value: string): string[] {
    return Array.from(new Set(
        value
            .split(/[\n,]/)
            .map(normalizeDomainEntry)
            .filter(Boolean)
    ));
}

function normalizeDomainEntry(entry: string): string {
    const trimmed = entry.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!trimmed) return "";
    try {
        return new URL(`http://${trimmed}`).hostname.toLowerCase().replace(/\.$/, "");
    } catch {
        return "";
    }
}

export function isDomainBlacklisted(url: string, blacklist: string): boolean {
    try {
        const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
        return parseDomainList(blacklist).some(domain =>
            hostname === domain || hostname.endsWith(`.${domain}`)
        );
    } catch {
        return false;
    }
}

export async function validatePublicHttpUrl(url: string): Promise<string | null> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch (error) {
        return `Invalid URL: ${error instanceof Error ? error.message : String(error)}`;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `Invalid protocol: ${parsed.protocol}. Only HTTP and HTTPS are allowed.`;
    }
    if (parsed.username || parsed.password) {
        return "URLs containing embedded credentials are not allowed.";
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
        return "Localhost addresses are not allowed.";
    }

    if (isIP(hostname)) {
        return isPrivateOrReservedAddress(hostname)
            ? "Private, loopback, link-local, or reserved network addresses are not allowed."
            : null;
    }

    try {
        const records = await withTimeout(
            dns.lookup(hostname, { all: true, verbatim: true }),
            DNS_LOOKUP_TIMEOUT_MS,
            "DNS lookup"
        );
        if (records.length === 0) return "The hostname did not resolve to an address.";
        if (records.some(record => isPrivateOrReservedAddress(record.address))) {
            return "The hostname resolves to a private, loopback, link-local, or reserved address.";
        }
    } catch (error) {
        return `Unable to resolve hostname: ${error instanceof Error ? error.message : String(error)}`;
    }

    return null;
}

export function isPrivateOrReservedAddress(address: string): boolean {
    const normalized = address.toLowerCase().split("%")[0];
    if (isIP(normalized) === 4) return isPrivateOrReservedIpv4(normalized);
    if (isIP(normalized) !== 6) return true;

    const words = parseIpv6Words(normalized);
    if (!words) return true;
    const [a, b, c, d, e, f, g, h] = words;

    if (words.every(word => word === 0)) return true;
    if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && g === 0 && h === 1) return true;
    if ((a & 0xe000) !== 0x2000) return true; // Only currently allocated global unicast 2000::/3
    if ((a & 0xfe00) === 0xfc00) return true; // Unique local fc00::/7
    if ((a & 0xffc0) === 0xfe80) return true; // Link-local fe80::/10
    if ((a & 0xff00) === 0xff00) return true; // Multicast ff00::/8
    if (a === 0x2001 && b === 0x0db8) return true; // Documentation
    if (a === 0x0100 && b === 0 && c === 0 && (d === 0 || d === 1)) return true; // Discard-only and dummy prefixes
    if (a === 0x0064 && b === 0xff9b) return true; // NAT64 translation prefixes
    if (a === 0x2001 && b === 0x0000) return true; // Teredo 2001::/32
    if (a === 0x2001 && b === 0x0002 && c === 0) return true; // Benchmarking 2001:2::/48
    if (a === 0x2002) return true; // 6to4 2002::/16 embeds an IPv4 destination
    if (a === 0x3fff && (b & 0xf000) === 0) return true; // Documentation 3fff::/20

    const isMappedIpv4 = a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff;
    const isCompatibleIpv4 = a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0;
    if (isMappedIpv4 || isCompatibleIpv4) {
        const ipv4 = `${g >> 8}.${g & 0xff}.${h >> 8}.${h & 0xff}`;
        return isPrivateOrReservedIpv4(ipv4);
    }
    return false;
}

function parseIpv6Words(address: string): number[] | null {
    let normalized = address;
    const dottedMatch = normalized.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dottedMatch) {
        const octets = dottedMatch[2].split(".").map(Number);
        if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
        normalized = `${dottedMatch[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    }

    const halves = normalized.split("::");
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
    const groups = [...left, ...Array(missing).fill("0"), ...right];
    if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map(group => Number.parseInt(group, 16));
}

function isPrivateOrReservedIpv4(address: string): boolean {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
    const [a, b, c] = octets;

    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 192 && b === 88 && c === 99) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    return a >= 224;
}
