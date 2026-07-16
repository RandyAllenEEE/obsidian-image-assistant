import { describe, expect, it } from "vitest";
import { getErrorMessage } from "../../../src/utils/ErrorUtils";

describe("getErrorMessage", () => {
    it("keeps Error and string rejection messages", () => {
        expect(getErrorMessage(new Error("request failed"))).toBe("request failed");
        expect(getErrorMessage("request failed")).toBe("request failed");
    });

    it("never throws while reporting arbitrary rejection values", () => {
        expect(getErrorMessage(null)).toBe("Unknown error");
        expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
        expect(getErrorMessage({ code: "ECONNRESET" })).toBe("[object Object]");
        expect(getErrorMessage({ toString: () => { throw new Error("nope"); } })).toBe("Unknown error");
    });
});
