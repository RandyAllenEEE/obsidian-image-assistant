import { describe, expect, it, vi } from 'vitest';
import { ImageStateManager } from '../../../src/ui/ImageStateManager';
import { ImageAlignment } from '../../../src/ui/ImageAlignment';
import {
  getImageSourceDescriptors,
  getImageSourceKey
} from '../../../src/utils/MarkdownSourceContext';

function makeManager(app: any = {}) {
  const plugin = {
    settings: {
      alignment: {
        enabled: true,
        default: 'center'
      }
    }
  } as any;
  const manager = new ImageStateManager(app as any, plugin);
  (manager as any).alignment = {
    applyLayout: vi.fn(),
    clearImage: vi.fn(),
    cleanup: vi.fn(),
    applyAlignmentToImage: vi.fn(),
    ensureReadingModeLayout: vi.fn()
  };
  (manager as any).resizer = {
    applySize: vi.fn()
  };
  (manager as any).caption = {
    renderImage: vi.fn(),
    removeImage: vi.fn()
  };
  (manager as any).initialized = true;
  return manager;
}

function makeUpdateFixture(line: string, src = 'app://local/img.png') {
  const lines = [line];
  const file = { path: 'notes/current.md', name: 'current.md' };
  const contentEl = document.createElement('div');
  const editor = {
    lineCount: vi.fn(() => lines.length),
    getLine: vi.fn((index: number) => lines[index]),
    replaceRange: vi.fn((replacement: string, from: { line: number; ch: number }, to: { line: number; ch: number }) => {
      lines[from.line] = `${lines[from.line].slice(0, from.ch)}${replacement}${lines[from.line].slice(to.ch)}`;
    })
  };
  const view = { editor, file, contentEl, getMode: () => 'source' };
  const app = {
    workspace: {
      getActiveViewOfType: vi.fn(() => view),
      getActiveFile: vi.fn(() => file),
      onLayoutReady: vi.fn((callback: () => void) => callback())
    }
  };
  const manager = makeManager(app);
  const img = document.createElement('img') as HTMLImageElement;
  img.setAttribute('src', src);
  contentEl.appendChild(img);

  return { app, editor, img, lines, manager };
}

describe('ImageStateManager pipe syntax integration', () => {
  it('injects delegates immediately but starts its DOM observer explicitly and once', () => {
    const manager = new ImageStateManager({} as any, {} as any);
    const setupObserver = vi.spyOn(manager as any, 'setupObserver').mockImplementation(() => undefined);
    const alignment = {} as any;
    const caption = {} as any;

    manager.initialize(alignment, null, caption);
    expect(setupObserver).not.toHaveBeenCalled();

    manager.start();
    manager.start();
    expect(setupObserver).toHaveBeenCalledOnce();
  });

  it('ignores renderer callbacks until its delegates are initialized', () => {
    const manager = makeManager();
    (manager as any).initialized = false;
    const img = document.createElement('img');

    expect(() => manager.processReadingModeImage(img)).not.toThrow();
    expect((manager as any).alignment.applyAlignmentToImage).not.toHaveBeenCalled();
    expect((manager as any).caption.renderImage).not.toHaveBeenCalled();
  });

  it('clears deferred processing timers on unload', () => {
    vi.useFakeTimers();
    try {
      const manager = makeManager();
      vi.spyOn(manager, 'getImageState').mockReturnValue({
        align: 'none', wrap: false, caption: 'Caption'
      });
      const img = document.createElement('img');

      manager.processImage(img);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      manager.onunload();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves editor caption DOM exclusively to the CodeMirror extension', () => {
    const manager = makeManager();
    vi.spyOn(manager, 'getImageState').mockReturnValue({
      align: 'none', wrap: false, caption: 'Caption'
    });
    const img = document.createElement('img');

    manager.processImage(img);

    expect((manager as any).caption.removeImage).toHaveBeenCalledWith(img);
    expect((manager as any).caption.renderImage).not.toHaveBeenCalled();
  });

  it('refreshes images in every Markdown leaf instead of only the active leaf', () => {
    const firstContent = document.createElement('div');
    const secondContent = document.createElement('div');
    const firstImage = firstContent.appendChild(document.createElement('img'));
    const secondImage = secondContent.appendChild(document.createElement('img'));
    const firstView = {
      contentEl: firstContent,
      getMode: () => 'preview',
      editor: { getValue: vi.fn(() => '') }
    };
    const secondView = {
      contentEl: secondContent,
      getMode: () => 'source',
      editor: {
        getValue: vi.fn(() => ''),
        cm: { state: { field: vi.fn(() => true) } }
      }
    };
    const app = {
      workspace: {
        layoutReady: true,
        getLeavesOfType: vi.fn(() => [{ view: firstView }, { view: secondView }]),
        getActiveViewOfType: vi.fn(() => firstView)
      }
    };
    const manager = makeManager(app);
    const reading = vi.spyOn(manager, 'processReadingModeImage').mockImplementation(() => undefined);
    const editing = vi.spyOn(manager, 'processImage').mockImplementation(() => undefined);

    manager.refreshAllImages();

    expect(reading).toHaveBeenCalledWith(firstImage);
    expect(editing).toHaveBeenCalledWith(secondImage, expect.any(Object));
  });

  it('clears stale layout in Source Mode when Live Preview is not explicitly enabled', () => {
    const contentEl = document.createElement('div');
    const image = contentEl.appendChild(document.createElement('img'));
    const view = {
      contentEl,
      getMode: () => 'source',
      editor: {
        getValue: vi.fn(() => ''),
        cm: { state: { field: vi.fn(() => false) } }
      }
    };
    const app = {
      workspace: {
        layoutReady: true,
        getLeavesOfType: vi.fn(() => [{ view }]),
        getActiveViewOfType: vi.fn(() => view)
      }
    };
    const manager = makeManager(app);
    const processImage = vi.spyOn(manager, 'processImage');

    manager.refreshAllImages();

    expect(processImage).not.toHaveBeenCalled();
    expect((manager as any).alignment.clearImage).toHaveBeenCalledWith(image);
  });

  it('clears alignment delegates when alignment is disabled', () => {
    const manager = makeManager();
    (manager as any).plugin.settings.alignment.enabled = false;
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'Caption|left-wrap|320x200');

    manager.processReadingModeImage(img);

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(img, {
      alignment: null,
      wrap: false,
      source: 'none'
    }, {
      width: '320',
      height: '200'
    });
  });

  it('maps reading-mode pipe syntax into alignment, size, and caption delegates', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'Caption|left-wrap|320x200');

    manager.processReadingModeImage(img);

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(img, {
      alignment: 'left',
      wrap: true,
      source: 'pipe'
    }, {
      width: '320',
      height: '200'
    });
    expect((manager as any).resizer.applySize).toHaveBeenCalledWith(img, 320, 200);
    expect((manager as any).caption.renderImage).toHaveBeenCalledWith(img, { captionText: 'Caption' });
  });

  it('uses the default alignment when the link has size but no align attribute', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'Caption|640');

    manager.processReadingModeImage(img);

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(img, {
      alignment: 'center',
      wrap: false,
      source: 'image-default'
    }, {
      width: '640',
      height: undefined
    });
    expect((manager as any).resizer.applySize).toHaveBeenCalledWith(img, 640, undefined);
    expect((manager as any).caption.renderImage).toHaveBeenCalledWith(img, { captionText: 'Caption' });
  });

  it('supports display-mode Reading Mode attributes in arbitrary order', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'right|300|Caption');

    manager.processReadingModeImage(img);

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(img, {
      alignment: 'right',
      wrap: false,
      source: 'pipe'
    }, {
      width: '300',
      height: undefined
    });
    expect((manager as any).caption.renderImage).toHaveBeenCalledWith(img, { captionText: 'Caption' });
  });

  it('prefers the exact source link over a reduced Reading Mode alt attribute', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', '300');

    manager.processReadingModeImage(
      img,
      { linkText: '![[https://cdn.example.com/photo.webp|right|300|Exact caption]]' }
    );

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(img, {
      alignment: 'right',
      wrap: false,
      source: 'pipe'
    }, {
      width: '300',
      height: undefined
    });
    expect((manager as any).caption.renderImage).toHaveBeenCalledWith(img, {
      linkText: '![[https://cdn.example.com/photo.webp|right|300|Exact caption]]'
    });
  });

  it('releases a stale source binding and falls back to the current DOM alt', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'Fallback caption');
    manager.processReadingModeImage(img, {
      linkText: '![[photo.webp|Old source caption|right]]'
    });

    manager.processReadingModeImage(img, { linkText: null, descriptor: null });

    expect((manager as any).caption.renderImage).toHaveBeenLastCalledWith(img, {
      captionText: 'Fallback caption'
    });
  });

  it('maps a virtualized repeated network URL to its exact Live Preview source offset', () => {
    const lines = [
      '![First|left](https://example.com/image?id=1)',
      '![Second|right](https://example.com/image?id=1)'
    ];
    const contentEl = document.createElement('div');
    const img = contentEl.appendChild(document.createElement('img'));
    img.src = 'https://example.com/image?id=1';
    const editor = {
      getValue: vi.fn(() => lines.join('\n')),
      getLine: vi.fn((line: number) => lines[line]),
      lineCount: vi.fn(() => lines.length),
      cm: { posAtDOM: vi.fn(() => lines[0].length + 2) }
    };
    const file = { path: 'notes/current.md' };
    const view = { editor, file, contentEl, getMode: () => 'source' };
    const app = {
      workspace: {
        getLeavesOfType: vi.fn(() => [{ view }]),
        getActiveViewOfType: vi.fn(() => view),
        getActiveFile: vi.fn(() => file)
      }
    };
    const manager = makeManager(app);

    manager.processImage(img);

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(img, {
      alignment: 'right',
      wrap: false,
      source: 'pipe'
    }, { width: undefined, height: undefined });
    expect(img.getAttribute('data-image-assistant-source-key')).toContain(':1:https://example.com/image?id=1');
  });

  it('fails closed for repeated targets when CodeMirror cannot provide a source offset', () => {
    const lines = [
      '![[https://example.com/image|First|left]]',
      '![[https://example.com/image|Second|right]]'
    ];
    const contentEl = document.createElement('div');
    const img = contentEl.appendChild(document.createElement('img'));
    img.src = 'https://example.com/image';
    const editor = {
      getValue: vi.fn(() => lines.join('\n')),
      getLine: vi.fn((line: number) => lines[line]),
      lineCount: vi.fn(() => lines.length)
    };
    const file = { path: 'notes/current.md' };
    const view = { editor, file, contentEl, getMode: () => 'source' };
    const app = {
      workspace: {
        getLeavesOfType: vi.fn(() => [{ view }]),
        getActiveViewOfType: vi.fn(() => view),
        getActiveFile: vi.fn(() => file)
      }
    };
    const manager = makeManager(app);

    manager.processImage(img);

    expect((manager as any).alignment.applyLayout).not.toHaveBeenCalled();
    expect((manager as any).alignment.clearImage).toHaveBeenCalledWith(img);
  });

  it('processes a network image that was rendered before its Live Preview observer starts', async () => {
    const source = '![GFL current droop|center|800](https://example.com/gfl?id=1)';
    const contentEl = document.createElement('div');
    const img = contentEl.appendChild(document.createElement('img'));
    img.src = 'https://example.com/gfl?id=1';
    const sourceKey = getImageSourceKey(getImageSourceDescriptors(source)[0]);
    const caption = contentEl.appendChild(document.createElement('span'));
    caption.className = 'image-assistant-caption image-assistant-live-preview-caption';
    caption.setAttribute('data-image-assistant-caption-renderer', 'codemirror');
    caption.setAttribute('data-image-assistant-source-key', sourceKey);
    caption.setAttribute('data-image-assistant-caption-width', 'auto');
    caption.setAttribute('data-image-assistant-caption-explicit-width', 'true');
    caption.setAttribute('data-image-assistant-caption-wrap', 'false');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 300, width: 800, right: 1100, top: 0, bottom: 100,
      height: 100, x: 300, y: 0, toJSON: () => ({})
    } as DOMRect);
    vi.spyOn(caption, 'getBoundingClientRect').mockReturnValue({
      left: 100, width: 800, right: 900, top: 100, bottom: 130,
      height: 30, x: 100, y: 100, toJSON: () => ({})
    } as DOMRect);
    const editor = {
      getValue: vi.fn(() => source),
      getLine: vi.fn(() => source),
      lineCount: vi.fn(() => 1),
      cm: {
        state: { field: vi.fn(() => true) },
        posAtDOM: vi.fn(() => source.length)
      }
    };
    const file = { path: 'notes/gfl.md' };
    const view = { contentEl, editor, file, getMode: () => 'source' };
    const workspace = {
      layoutReady: true,
      getLeavesOfType: vi.fn(() => [{ view }]),
      getActiveViewOfType: vi.fn(() => view),
      getActiveFile: vi.fn(() => file),
      on: vi.fn(() => ({}))
    };
    const plugin = {
      settings: { alignment: { enabled: true, default: 'left' } },
      registerEvent: vi.fn()
    } as any;
    const manager = new ImageStateManager({ workspace } as any, plugin);
    const alignment = new ImageAlignment({} as any, plugin);
    manager.initialize(alignment, null, { removeImage: vi.fn() } as any);

    manager.start();
    await Promise.resolve();

    expect(img.style.width).toBe('800px');
    expect(img.getAttribute('data-image-assistant-align')).toBe('center');
    expect(img.getAttribute('data-image-assistant-source-key')).toContain('https://example.com/gfl?id=1');
    expect(caption.getAttribute('data-image-assistant-caption-positioned')).toBe('true');
    expect(caption.style.getPropertyValue('--image-assistant-caption-rendered-width')).toBe('800px');
    expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('200px');

    manager.onunload();
  });

  it('queues images already present when a new Live Preview leaf is discovered', async () => {
    const firstContent = document.createElement('div');
    const secondContent = document.createElement('div');
    const secondImage = secondContent.appendChild(document.createElement('img'));
    const makeView = (contentEl: HTMLElement) => ({
      contentEl,
      file: { path: `notes/${contentEl === firstContent ? 'first' : 'second'}.md` },
      getMode: () => 'source',
      editor: {
        getValue: vi.fn(() => ''),
        cm: { state: { field: vi.fn(() => true) } }
      }
    });
    const firstView = makeView(firstContent);
    const secondView = makeView(secondContent);
    let leaves = [{ view: firstView }];
    const events = new Map<string, () => void>();
    const workspace = {
      layoutReady: true,
      getLeavesOfType: vi.fn(() => leaves),
      getActiveViewOfType: vi.fn(() => firstView),
      on: vi.fn((name: string, callback: () => void) => {
        events.set(name, callback);
        return {};
      })
    };
    const plugin = {
      settings: { alignment: { enabled: true, default: 'center' } },
      registerEvent: vi.fn()
    } as any;
    const manager = new ImageStateManager({ workspace } as any, plugin);
    manager.initialize({ cleanup: vi.fn() } as any, null, { removeImage: vi.fn() } as any);
    const processImage = vi.spyOn(manager, 'processImage').mockImplementation(() => undefined);

    manager.start();
    leaves = [{ view: firstView }, { view: secondView }];
    events.get('layout-change')?.();
    await Promise.resolve();

    expect(processImage).toHaveBeenCalledOnce();
    expect(processImage).toHaveBeenCalledWith(secondImage, expect.any(Object));
    expect((manager as any).observers.size).toBe(2);

    manager.onunload();
  });

  it('uses one layout coordinator observer for Live Preview geometry changes', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
    const instances: TestResizeObserver[] = [];
    class TestResizeObserver {
      readonly observe = vi.fn();
      readonly unobserve = vi.fn();
      readonly disconnect = vi.fn();

      constructor(readonly callback: ResizeObserverCallback) {
        instances.push(this);
      }
    }
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: TestResizeObserver
    });

    try {
      const contentEl = document.createElement('div');
      const image = contentEl.appendChild(document.createElement('img'));
      const view = {
        contentEl,
        file: { path: 'notes/responsive.md' },
        getMode: () => 'source',
        editor: {
          getValue: vi.fn(() => ''),
          cm: { state: { field: vi.fn(() => true) } }
        }
      };
      const workspace = {
        layoutReady: true,
        getLeavesOfType: vi.fn(() => [{ view }]),
        getActiveViewOfType: vi.fn(() => view),
        on: vi.fn(() => ({}))
      };
      const plugin = {
        settings: { alignment: { enabled: true, default: 'center' } },
        registerEvent: vi.fn()
      } as any;
      const manager = new ImageStateManager({ workspace } as any, plugin);
      manager.initialize({ cleanup: vi.fn() } as any, null, { removeImage: vi.fn() } as any);
      const processImage = vi.spyOn(manager, 'processImage').mockImplementation(() => undefined);

      manager.start();
      await Promise.resolve();
      processImage.mockClear();

      expect(instances).toHaveLength(1);
      expect(instances[0].observe).toHaveBeenCalledWith(contentEl);
      const coordinator = [...(manager as any).layoutCoordinators.values()][0];
      coordinator.registerImage(image, 'source-key', { standalone: true, scope: 'root' });
      expect(instances[0].observe).toHaveBeenCalledWith(image);
      instances[0].callback([
        { target: image } as unknown as ResizeObserverEntry
      ], instances[0] as any);
      await Promise.resolve();

      expect(processImage).not.toHaveBeenCalled();
      manager.onunload();
      expect(instances[0].disconnect).toHaveBeenCalledOnce();
    } finally {
      if (original) Object.defineProperty(window, 'ResizeObserver', original);
      else delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });

  it('observes every Live Preview leaf and releases all observers on unload', async () => {
    const firstContent = document.createElement('div');
    const secondContent = document.createElement('div');
    const makeView = (contentEl: HTMLElement) => ({
      contentEl,
      getMode: () => 'source',
      editor: {
        getValue: vi.fn(() => ''),
        cm: { state: { field: vi.fn(() => true) } }
      }
    });
    const firstView = makeView(firstContent);
    const secondView = makeView(secondContent);
    const workspace = {
      layoutReady: true,
      getLeavesOfType: vi.fn(() => [{ view: firstView }, { view: secondView }]),
      getActiveViewOfType: vi.fn(() => firstView),
      on: vi.fn(() => ({}))
    };
    const plugin = {
      settings: { alignment: { enabled: true, default: 'center' } },
      registerEvent: vi.fn()
    } as any;
    const manager = new ImageStateManager({ workspace } as any, plugin);
    const alignment = { cleanup: vi.fn() } as any;
    manager.initialize(alignment, null, { removeImage: vi.fn() } as any);
    const processImage = vi.spyOn(manager, 'processImage').mockImplementation(() => undefined);

    manager.start();
    expect((manager as any).observers.size).toBe(2);
    firstContent.appendChild(document.createElement('img'));
    secondContent.appendChild(document.createElement('img'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(processImage).toHaveBeenCalledTimes(2);

    manager.onunload();
    expect((manager as any).observers.size).toBe(0);
    expect(alignment.cleanup).toHaveBeenCalledWith(firstContent);
    expect(alignment.cleanup).toHaveBeenCalledWith(secondContent);
  });

  it('removes the size attribute when width and height are cleared', async () => {
    const { editor, img, lines, manager } = makeUpdateFixture('![[img.png|Caption|left|320x200]]');

    await manager.updateState(img, { width: null, height: null });

    expect(editor.replaceRange).toHaveBeenCalledWith(
      '![[img.png|Caption|left]]',
      { line: 0, ch: 0 },
      { line: 0, ch: '![[img.png|Caption|left|320x200]]'.length }
    );
    expect(lines[0]).toBe('![[img.png|Caption|left]]');
  });

  it('does not write an empty size attribute when clearing dimensions on a link without size', async () => {
    const { editor, img, lines, manager } = makeUpdateFixture('![[img.png|Caption]]');

    await manager.updateState(img, { width: null, height: null });

    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(lines[0]).toBe('![[img.png|Caption]]');
  });

  it('preserves the remaining height when only width is cleared', async () => {
    const { editor, img, lines, manager } = makeUpdateFixture('![Caption|320x200](img.png)');

    await manager.updateState(img, { width: null });

    expect(editor.replaceRange).toHaveBeenCalledWith(
      '![Caption|x200](img.png)',
      { line: 0, ch: 0 },
      { line: 0, ch: '![Caption|320x200](img.png)'.length }
    );
    expect(lines[0]).toBe('![Caption|x200](img.png)');
  });

  it('updates the exact matched range when same-basename links share one line', async () => {
    const originalLine = '![[other/pic.png|Other|100]] and ![[assets/pic.png|Target|200]]';
    const { editor, img, lines, manager } = makeUpdateFixture(originalLine, 'app://local/assets/pic.png');
    const target = '![[assets/pic.png|Target|200]]';
    const targetIndex = originalLine.indexOf(target);

    await manager.updateState(img, { width: 320 });

    expect(editor.replaceRange).toHaveBeenCalledWith(
      '![[assets/pic.png|Target|320]]',
      { line: 0, ch: targetIndex },
      { line: 0, ch: targetIndex + target.length }
    );
    expect(lines[0]).toBe('![[other/pic.png|Other|100]] and ![[assets/pic.png|Target|320]]');
  });

  it('does not write a stale image into a different active view', async () => {
    const { editor, img, manager } = makeUpdateFixture('![[img.png|Caption|200]]');
    const otherView = document.createElement('div');
    ((manager as any).app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>)
      .mockReturnValue({ editor, contentEl: otherView });

    await manager.updateState(img, { width: 320 });

    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('abandons a deferred write when the source link changed before layout became ready', async () => {
    const { app, editor, img, lines, manager } = makeUpdateFixture('![[img.png|Caption|200]]');
    let deferredWrite: (() => void) | undefined;
    app.workspace.onLayoutReady.mockImplementation((callback: () => void) => {
      deferredWrite = callback;
    });

    await manager.updateState(img, { width: 320 });
    lines[0] = '![[img.png|User edit|640]]';
    deferredWrite?.();

    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(lines[0]).toBe('![[img.png|User edit|640]]');
  });

  it('keeps writing to the owning view after an active-view change and abandons after unload', async () => {
    const { app, editor, img, manager } = makeUpdateFixture('![[img.png|Caption|200]]');
    const originalView = app.workspace.getActiveViewOfType();
    let deferredWrite: (() => void) | undefined;
    app.workspace.onLayoutReady.mockImplementation((callback: () => void) => {
      deferredWrite = callback;
    });

    await manager.updateState(img, { width: 320 });
    app.workspace.getActiveViewOfType.mockReturnValue({
      editor,
      file: originalView.file,
      contentEl: document.createElement('div'),
      getMode: () => 'source'
    });
    deferredWrite?.();
    expect(editor.replaceRange).toHaveBeenCalledOnce();

    editor.replaceRange.mockClear();
    app.workspace.getActiveViewOfType.mockReturnValue(originalView);
    await manager.updateState(img, { width: 360 });
    manager.onunload();
    deferredWrite?.();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});
