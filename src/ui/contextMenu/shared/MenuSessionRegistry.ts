import type { Menu } from "obsidian";

export interface MenuSession {
    readonly menu: Menu;
    onRelease(callback: () => void): void;
    release(): void;
}

export class MenuSessionRegistry {
    private readonly activeSessions = new Map<Menu, Set<() => void>>();
    private readonly hookedMenus = new WeakSet<Menu>();

    has(menu: Menu): boolean {
        return this.activeSessions.has(menu);
    }

    claim(menu: Menu): MenuSession | null {
        if (this.activeSessions.has(menu)) return null;
        const callbacks = new Set<() => void>();
        this.activeSessions.set(menu, callbacks);
        const release = () => this.release(menu);
        const lifecycle = menu as Menu & {
            onHide?: (handler: () => void) => void;
        };
        if (typeof lifecycle.onHide === "function"
            && !this.hookedMenus.has(menu)) {
            this.hookedMenus.add(menu);
            lifecycle.onHide(release);
        } else if (typeof lifecycle.onHide !== "function") {
            queueMicrotask(release);
        }
        return {
            menu,
            onRelease: callback => callbacks.add(callback),
            release
        };
    }

    release(menu: Menu): void {
        const callbacks = this.activeSessions.get(menu);
        if (!callbacks) return;
        this.activeSessions.delete(menu);
        for (const callback of callbacks) {
            try {
                callback();
            } catch {
                // One menu-owned component must not block the rest.
            }
        }
    }

    closeAll(): void {
        const menus = [...this.activeSessions.keys()];
        for (const menu of menus) {
            try {
                menu.hide();
            } catch {
                // Native menu shims may already be disposed.
            } finally {
                this.release(menu);
            }
        }
    }
}
