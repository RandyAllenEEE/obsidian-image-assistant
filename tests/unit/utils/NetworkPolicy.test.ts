import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dnsLookupMock = vi.hoisted(() => vi.fn());

vi.mock("dns", () => {
    const promises = { lookup: dnsLookupMock };
    return { promises, default: { promises } };
});
import {
    isDomainBlacklisted,
    isHttpUrl,
    isPrivateOrReservedAddress,
    parseDomainList,
    validatePublicHttpUrl
} from "../../../src/utils/NetworkPolicy";

describe("NetworkPolicy", () => {
    beforeEach(() => {
        dnsLookupMock.mockReset();
        dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("recognizes valid HTTP URLs case-insensitively", () => {
        expect(isHttpUrl(" HTTPS://Example.com/image ")).toBe(true);
        expect(isHttpUrl("http://example.com/image")).toBe(true);
        expect(isHttpUrl("ftp://example.com/image")).toBe(false);
        expect(isHttpUrl("not a url")).toBe(false);
    });

    it("parses comma and newline separated domain lists", () => {
        expect(parseDomainList("Example.com, bad.test\n.example.com\n")).toEqual([
            "example.com",
            "bad.test"
        ]);
    });

    it("canonicalizes internationalized domains before blacklist matching", () => {
        expect(parseDomainList("例子.测试")).toEqual(["xn--fsqu00a.xn--0zwm56d"]);
        expect(isDomainBlacklisted("https://cdn.例子.测试/a.png", "例子.测试")).toBe(true);
    });

    it("matches exact domains and subdomains without substring false positives", () => {
        const blacklist = "example.com,blocked.test";
        expect(isDomainBlacklisted("https://example.com/a.png", blacklist)).toBe(true);
        expect(isDomainBlacklisted("https://cdn.example.com/a.png", blacklist)).toBe(true);
        expect(isDomainBlacklisted("https://notexample.com/a.png", blacklist)).toBe(false);
        expect(isDomainBlacklisted("https://example.org/a.png", "example")).toBe(false);
    });

    it.each([
        "127.0.0.1",
        "10.0.0.1",
        "169.254.1.2",
        "192.168.1.2",
        "::1",
        "fc00::1",
        "fe80::1",
        "64:ff9b::7f00:1",
        "64:ff9b:1::7f00:1",
        "2001::7f00:1",
        "2001:2::1",
        "2002:7f00:1::",
        "3fff::1",
        "4000::1",
        "::ffff:127.0.0.1",
        "::ffff:7f00:1"
    ])("rejects private or reserved address %s", address => {
        expect(isPrivateOrReservedAddress(address)).toBe(true);
    });

    it("allows public IP literals", () => {
        expect(isPrivateOrReservedAddress("8.8.8.8")).toBe(false);
        expect(isPrivateOrReservedAddress("2606:4700:4700::1111")).toBe(false);
    });

    it("rejects private literals before making a request", async () => {
        await expect(validatePublicHttpUrl("http://192.168.1.5/image.png"))
            .resolves.toContain("not allowed");
        await expect(validatePublicHttpUrl("http://[::ffff:7f00:1]/image.png"))
            .resolves.toContain("not allowed");
    });

    it("rejects a hostname when any DNS answer is private", async () => {
        dnsLookupMock.mockResolvedValue([
            { address: "93.184.216.34", family: 4 },
            { address: "127.0.0.1", family: 4 }
        ]);

        await expect(validatePublicHttpUrl("https://mixed.example/image.png"))
            .resolves.toContain("private");
    });

    it("bounds DNS resolution time before starting the request", async () => {
        vi.useFakeTimers();
        dnsLookupMock.mockReturnValue(new Promise(() => undefined));

        const validation = validatePublicHttpUrl("https://stalled.example/image.png");
        await vi.advanceTimersByTimeAsync(10_000);

        await expect(validation).resolves.toContain("DNS lookup timed out after 10 seconds");
    });
});
