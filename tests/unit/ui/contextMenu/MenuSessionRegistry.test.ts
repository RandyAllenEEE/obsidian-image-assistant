import { describe, expect, it, vi } from "vitest";
import { Menu } from "obsidian";
import { MenuSessionRegistry } from "../../../../src/ui/contextMenu/shared/MenuSessionRegistry";

describe("MenuSessionRegistry", () => {
    it("releases a reused Menu instance when the menu closes", () => {
        const registry = new MenuSessionRegistry();
        const menu = new Menu();
        const onHide = vi.spyOn(menu as any, "onHide");
        const firstRelease = vi.fn();

        registry.claim(menu)?.onRelease(firstRelease);
        expect(registry.claim(menu)).toBeNull();

        menu.hide();

        expect(firstRelease).toHaveBeenCalledOnce();
        expect(registry.claim(menu)).not.toBeNull();
        expect(onHide).toHaveBeenCalledOnce();
    });

    it("closes and releases every active menu on teardown", () => {
        const registry = new MenuSessionRegistry();
        const first = new Menu();
        const second = new Menu();
        const firstHide = vi.spyOn(first, "hide");
        const secondHide = vi.spyOn(second, "hide");
        registry.claim(first);
        registry.claim(second);

        registry.closeAll();

        expect(firstHide).toHaveBeenCalledOnce();
        expect(secondHide).toHaveBeenCalledOnce();
        expect(registry.has(first)).toBe(false);
        expect(registry.has(second)).toBe(false);
    });
});
