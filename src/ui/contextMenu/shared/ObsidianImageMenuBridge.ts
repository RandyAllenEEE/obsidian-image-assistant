import { Component, Menu } from "obsidian";

export type ObsidianMenuForEventHandler = (
    menu: Menu,
    event: PointerEvent | MouseEvent
) => void;

/**
 * Observes menus created through Obsidian's public Menu.forEvent() factory.
 *
 * Live Preview image widgets create their menu directly and do not emit the
 * workspace url-menu/editor-menu events. Wrapping the factory lets us append
 * to that same menu without replacing it or intercepting the DOM event.
 */
export class ObsidianImageMenuBridge extends Component {
    private active = true;
    private readonly original: typeof Menu.forEvent;
    private readonly wrapped: typeof Menu.forEvent;

    constructor(handler: ObsidianMenuForEventHandler) {
        super();
        this.original = Menu.forEvent;
        const bridge = this;
        this.wrapped = function (
            this: typeof Menu,
            event: PointerEvent | MouseEvent
        ): Menu {
            const menu = bridge.original.call(this, event);
            if (bridge.active) {
                try {
                    handler(menu, event);
                } catch (error) {
                    console.warn(
                        "[Image Assistant] Failed to extend an image menu:",
                        error
                    );
                }
            }
            return menu;
        };
        Menu.forEvent = this.wrapped;
    }

    onunload(): void {
        this.active = false;
        if (Menu.forEvent === this.wrapped) {
            Menu.forEvent = this.original;
        }
        super.onunload();
    }
}
