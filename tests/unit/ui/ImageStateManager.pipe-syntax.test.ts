import { describe, expect, it, vi } from 'vitest';
import { ImageStateManager } from '../../../src/ui/ImageStateManager';
import { ImageAlignment } from '../../../src/ui/ImageAlignment';
import { resolveRenderedMediaLayoutTarget } from '../../../src/ui/RenderedMediaLayoutTarget';
import {
  getImageLayoutKey,
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
    applyLayoutTarget: vi.fn()
  };
  (manager as any).caption = {
    renderImage: vi.fn(),
    renderExternalMedia: vi.fn(),
    removeImage: vi.fn()
  };
  (manager as any).initialized = true;
  return manager;
}

describe('ImageStateManager pipe syntax integration', () => {
  it('applies the global default alignment to a native Excalidraw SVG render', () => {
    const manager = makeManager();
    const view = document.createElement('div');
    view.className = 'markdown-source-view';
    const host = view.appendChild(document.createElement('div'));
    host.className = 'internal-embed image-embed';
    const rendered = host.appendChild(document.createElement('div'));
    rendered.className = 'excalidraw-svg excalidraw-embedded-img';
    rendered.setAttribute('fileSource', 'Drawings/Flow.excalidraw.md');
    const svg = rendered.appendChild(document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    ));
    svg.classList.add('excalidraw-svg');
    document.body.appendChild(view);

    (manager as any).processExcalidrawEmbeds(view);

    expect((manager as any).alignment.applyLayoutTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'excalidraw-source',
        owner: host,
        visual: rendered,
        sizing: 'external-renderer'
      }),
      { alignment: 'center', wrap: false, source: 'image-default' }
    );
    view.remove();
  });

  it('applies the same default alignment to Excalidraw SVGIMG/PNG renders', () => {
    const manager = makeManager();
    const view = document.createElement('div');
    view.className = 'markdown-preview-view';
    const host = view.appendChild(document.createElement('div'));
    host.className = 'internal-embed image-embed';
    const image = host.appendChild(document.createElement('img'));
    image.className = 'excalidraw-svg excalidraw-embedded-img';
    image.setAttribute('fileSource', 'Drawings/Flow.excalidraw.md');
    document.body.appendChild(view);

    (manager as any).processReadingModeImage(image);

    expect((manager as any).alignment.applyLayoutTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'excalidraw-source',
        owner: host,
        visual: image,
        sizing: 'external-renderer'
      }),
      { alignment: 'center', wrap: false, source: 'image-default' }
    );
    expect((manager as any).caption.renderImage).toHaveBeenCalledWith(
      image,
      { document }
    );
    view.remove();
  });

  it('routes Reading Mode external Excalidraw media through the same source layout', () => {
    const manager = makeManager();
    const view = document.body.appendChild(document.createElement('div'));
    view.className = 'markdown-preview-view';
    const host = view.appendChild(document.createElement('div'));
    host.className = 'internal-embed image-embed';
    const marker = host.appendChild(document.createElement('div'));
    marker.className = 'excalidraw-embedded-img';
    marker.setAttribute('fileSource', 'Drawing.excalidraw.md');
    const svg = marker.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    svg.classList.add('excalidraw-svg');
    const descriptor = getImageSourceDescriptors(
      '![test|right|200](Drawing.excalidraw.md)'
    )[0];

    manager.processReadingModeExternalMedia(marker, {
      descriptor,
      linkText: descriptor.source
    });

    expect((manager as any).alignment.applyLayoutTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'excalidraw-source',
        owner: host,
        visual: marker,
        captionAnchor: svg
      }),
      { alignment: 'right', wrap: false, source: 'pipe' }
    );
    expect((manager as any).caption.renderExternalMedia).toHaveBeenCalledWith(marker, {
      descriptor,
      linkText: descriptor.source,
      document
    });
    view.remove();
  });

  it('does not apply the global default to a prose-adjacent Excalidraw render', () => {
    const manager = makeManager();
    const view = document.createElement('div');
    view.className = 'markdown-preview-view';
    const paragraph = view.appendChild(document.createElement('p'));
    paragraph.append('before ');
    const host = paragraph.appendChild(document.createElement('span'));
    host.className = 'internal-embed image-embed';
    const image = host.appendChild(document.createElement('img'));
    image.className = 'excalidraw-embedded-img';
    image.setAttribute('fileSource', 'Drawings/Flow.excalidraw.md');
    paragraph.append(' after');
    document.body.appendChild(view);

    (manager as any).processExcalidrawEmbeds(view);

    expect((manager as any).alignment.applyLayoutTarget).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'excalidraw-source', owner: host }),
      { alignment: null, wrap: false, source: 'none' }
    );
    view.remove();
  });

  it('binds a real 1.13.4 line-hosted Excalidraw embed through its outer owner', () => {
    const source = '![test|200](Drawing.excalidraw.md)';
    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-source-view';
    const cmContent = contentEl.appendChild(document.createElement('div'));
    cmContent.className = 'cm-content';
    const line = cmContent.appendChild(document.createElement('div'));
    line.className = 'cm-line';
    const host = line.appendChild(document.createElement('div'));
    host.className = 'internal-embed image-embed';
    const rendered = host.appendChild(document.createElement('div'));
    rendered.className = 'excalidraw-embedded-img';
    rendered.setAttribute('fileSource', 'Drawing.excalidraw.md');
    const svg = rendered.appendChild(document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    ));
    svg.classList.add('excalidraw-svg');
    document.body.appendChild(contentEl);

    const view = {
      contentEl,
      editor: {
        getValue: () => source,
        cm: { state: { field: vi.fn(() => true) } }
      },
      file: { path: 'Note.md' },
      getMode: () => 'source'
    } as any;
    const leaf = { view };
    const manager = makeManager({
      workspace: {
        getLeavesOfType: () => [leaf],
        getActiveViewOfType: () => view
      },
      metadataCache: {
        getFirstLinkpathDest: () => ({ path: 'Drawing.excalidraw.md' })
      }
    });
    const registerTarget = vi.fn();
    (manager as any).layoutCoordinators.set(view, { registerTarget });

    (manager as any).processExcalidrawEmbeds(contentEl);

    expect((manager as any).alignment.applyLayoutTarget).toHaveBeenCalledWith(
      expect.objectContaining({ owner: host, placement: host, visual: rendered }),
      { alignment: 'center', wrap: false, source: 'image-default' }
    );
    expect(registerTarget).toHaveBeenCalledWith(
      expect.objectContaining({ owner: host, placement: host, visual: rendered }),
      expect.any(String),
      expect.objectContaining({ alignment: 'center', wrap: false })
    );
    expect(rendered.getAttribute('data-image-assistant-source-key')).toBeNull();
    expect(rendered.getAttribute('data-image-assistant-layout-key')).toBeNull();
    expect(rendered.getAttribute('style')).toBeNull();
    expect(svg.getAttribute('style')).toBeNull();
    contentEl.remove();
  });

  it('lets an inline source descriptor override a structurally isolated embed', () => {
    const source = 'Text ![[Drawing.excalidraw.md]] after';
    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-source-view';
    const host = contentEl.appendChild(document.createElement('div'));
    host.className = 'internal-embed image-embed';
    const rendered = host.appendChild(document.createElement('div'));
    rendered.className = 'excalidraw-embedded-img';
    rendered.setAttribute('fileSource', 'Drawing.excalidraw.md');
    const svg = rendered.appendChild(document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    ));
    svg.classList.add('excalidraw-svg');
    document.body.appendChild(contentEl);

    const view = {
      contentEl,
      editor: { getValue: () => source },
      file: { path: 'Note.md' },
      getMode: () => 'source'
    } as any;
    const leaf = { view };
    const manager = makeManager({
      workspace: {
        getLeavesOfType: () => [leaf],
        getActiveViewOfType: () => view
      },
      metadataCache: {
        getFirstLinkpathDest: () => ({ path: 'Drawing.excalidraw.md' })
      }
    });

    (manager as any).processExcalidrawEmbeds(contentEl);

    expect((manager as any).alignment.applyLayoutTarget).toHaveBeenCalledWith(
      expect.objectContaining({ owner: host, visual: rendered }),
      { alignment: null, wrap: false, source: 'none' }
    );
    contentEl.remove();
  });

  it('does not copy one explicit alignment to an unaligned repeated Excalidraw source', () => {
    const source = [
      '![[Drawing.excalidraw.md|right]]',
      '![[Drawing.excalidraw.md]]'
    ].join('\n');
    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-source-view';
    for (const alignmentClass of ['excalidraw-svg-right', '']) {
      const host = contentEl.appendChild(document.createElement('div'));
      host.className = 'internal-embed image-embed';
      const rendered = host.appendChild(document.createElement('div'));
      rendered.className = `excalidraw-embedded-img ${alignmentClass}`.trim();
      rendered.setAttribute('fileSource', 'Drawing.excalidraw.md');
      const svg = rendered.appendChild(document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg'
      ));
      svg.classList.add('excalidraw-svg');
    }
    document.body.appendChild(contentEl);

    const view = {
      contentEl,
      editor: { getValue: () => source },
      file: { path: 'Note.md' },
      getMode: () => 'source'
    } as any;
    const manager = makeManager({
      workspace: {
        getLeavesOfType: () => [{ view }],
        getActiveViewOfType: () => view
      },
      metadataCache: {
        getFirstLinkpathDest: () => ({ path: 'Drawing.excalidraw.md' })
      }
    });

    (manager as any).processExcalidrawEmbeds(contentEl);

    const layouts = (manager as any).alignment.applyLayoutTarget.mock.calls
      .map((call: any[]) => call[1]);
    expect(layouts).toEqual([
      { alignment: 'right', wrap: false, source: 'pipe' },
      { alignment: 'center', wrap: false, source: 'image-default' }
    ]);
    contentEl.remove();
  });

  it('injects delegates immediately but starts its DOM observer explicitly and once', () => {
    const manager = new ImageStateManager({} as any, {} as any);
    const setupObserver = vi.spyOn(manager as any, 'setupObserver').mockImplementation(() => undefined);
    const alignment = {} as any;
    const caption = {} as any;

    manager.initialize(alignment, caption);
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
    expect((manager as any).alignment.applyLayout).not.toHaveBeenCalled();
    expect((manager as any).caption.renderImage).not.toHaveBeenCalled();
  });

  it('does not leave deferred image-processing timers behind', () => {
    vi.useFakeTimers();
    try {
      const manager = makeManager();
      vi.spyOn(manager, 'getImageState').mockReturnValue({
        align: 'none', wrap: false, caption: 'Caption'
      });
      const img = document.createElement('img');

      manager.processImage(img);
      expect(vi.getTimerCount()).toBe(0);

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
        cm: {
          state: { field: vi.fn(() => true), doc: { toString: () => '' } },
          dispatch: vi.fn(),
          requestMeasure: vi.fn((request: any) => request.write(request.read()))
        }
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
    const editing = vi.spyOn(manager as any, 'applyImageResolution');

    manager.refreshAllImages();

    expect(reading).toHaveBeenCalledWith(firstImage);
    expect(editing).toHaveBeenCalledWith(secondImage, { status: 'absent' });
  });

  it('reconciles images already rendered in Reading Mode when the manager starts', () => {
    const contentEl = document.createElement('div');
    const image = contentEl.appendChild(document.createElement('img'));
    const view = {
      contentEl,
      getMode: () => 'preview',
      editor: { getValue: vi.fn(() => '') }
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
    manager.initialize(
      { cleanup: vi.fn() } as any,
      { removeImage: vi.fn() } as any
    );
    const reading = vi.spyOn(manager, 'processReadingModeImage')
      .mockImplementation(() => undefined);

    manager.start();
    manager.start();

    expect(reading).toHaveBeenCalledOnce();
    expect(reading).toHaveBeenCalledWith(image);
    manager.onunload();
  });

  it('delegates Source Mode cleanup without invoking image processing', () => {
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
    });
    expect(img.style.width).toBe('');
    expect(img.style.height).toBe('');
  });

  it('maps reading-mode pipe syntax into alignment and caption delegates', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'Caption|left-wrap|320x200');

    manager.processReadingModeImage(img);

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(img, {
      alignment: 'left',
      wrap: true,
      source: 'pipe'
    });
    expect(img.style.width).toBe('');
    expect(img.style.height).toBe('');
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
    });
    expect(img.style.width).toBe('');
    expect(img.style.height).toBe('');
    expect((manager as any).caption.renderImage).toHaveBeenCalledWith(img, { captionText: 'Caption' });
  });

  it('does not reinterpret non-tail legacy tokens as size or alignment', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'right|300|Caption');

    manager.processReadingModeImage(img);

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(img, {
      alignment: 'center',
      wrap: false,
      source: 'image-default'
    });
    expect(img.style.width).toBe('');
    expect(img.style.height).toBe('');
    expect((manager as any).caption.renderImage).toHaveBeenCalledWith(img, {
      captionText: 'right|300|Caption'
    });
  });

  it('prefers the exact source link over a reduced Reading Mode alt attribute', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', '300');

    manager.processReadingModeImage(
      img,
      { linkText: '![[https://cdn.example.com/photo.webp|Exact caption|right|300]]' }
    );

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(img, {
      alignment: 'right',
      wrap: false,
      source: 'pipe'
    });
    expect(img.style.width).toBe('');
    expect(img.style.height).toBe('');
    expect((manager as any).caption.renderImage).toHaveBeenCalledWith(img, {
      linkText: '![[https://cdn.example.com/photo.webp|Exact caption|right|300]]'
    });
  });

  it('does not rewrite Reading Mode source ownership attributes when unchanged', async () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'Caption|center|300');
    const [descriptor] = getImageSourceDescriptors(
      '![[https://cdn.example.com/photo.webp|Caption|center|300]]'
    );
    const context = { linkText: descriptor.source, descriptor };

    manager.processReadingModeImage(img, context);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(img, { attributes: true });

    manager.processReadingModeImage(img, context);
    await Promise.resolve();
    observer.disconnect();

    expect(img.getAttribute('data-image-assistant-source-key'))
      .toBe(getImageSourceKey(descriptor));
    expect(img.getAttribute('data-image-assistant-layout-key'))
      .toBe(getImageLayoutKey(descriptor));
    expect(mutations).toHaveLength(0);
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
    });
    expect(img.getAttribute('data-image-assistant-source-key')).toContain(':1:https://example.com/image?id=1');
  });

  it('preserves the last layout while a repeated target is temporarily unresolved', () => {
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
    expect((manager as any).alignment.clearImage).not.toHaveBeenCalled();
  });

  it('deduplicates a replacement Live Preview widget added by nested mutations', () => {
    const source = '![Right|right|233](https://example.com/diagram.png)';
    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-source-view';
    const cmContent = contentEl.appendChild(document.createElement('div'));
    cmContent.className = 'cm-content';
    const oldImage = cmContent.appendChild(document.createElement('img'));
    oldImage.src = 'https://example.com/diagram.png';
    const replacement = document.createElement('img');
    replacement.src = 'https://example.com/diagram.png';
    cmContent.replaceChild(replacement, oldImage);
    document.body.appendChild(contentEl);

    const editor = {
      getValue: vi.fn(() => source),
      getLine: vi.fn(() => source),
      lineCount: vi.fn(() => 1),
      cm: {
        state: {
          field: vi.fn(() => true),
          doc: { toString: () => source }
        },
        dispatch: vi.fn(),
        posAtDOM: vi.fn(() => 0),
        requestMeasure: vi.fn((request: any) => request.write(request.read()))
      }
    };
    const file = { path: 'notes/current.md' };
    const view = { contentEl, editor, file, getMode: () => 'source' };
    const app = {
      workspace: {
        getLeavesOfType: vi.fn(() => [{ view }]),
        getActiveViewOfType: vi.fn(() => view)
      }
    };
    const manager = makeManager(app);

    // CodeMirror can report the same replacement in both an outer and nested
    // child-list record. The new node must enter one coalesced measurement;
    // the detached old node's processing state is irrelevant.
    (manager as any).processingImages.add(oldImage);
    (manager as any).collectMutatedMedia(view, [{
      type: 'childList',
      target: cmContent,
      addedNodes: [replacement],
      removedNodes: [oldImage]
    }, {
      type: 'childList',
      target: replacement,
      addedNodes: [replacement],
      removedNodes: []
    }] as unknown as MutationRecord[]);

    expect((manager as any).alignment.applyLayout).toHaveBeenCalledTimes(1);
    expect((manager as any).alignment.applyLayout).toHaveBeenCalledWith(replacement, {
      alignment: 'right',
      wrap: false,
      source: 'pipe'
    });
    expect(editor.cm.requestMeasure).toHaveBeenCalledOnce();

    manager.onunload();
    contentEl.remove();
  });

  it('detaches a removed external-renderer subtree without requiring an IMG', () => {
    const contentEl = document.createElement('div');
    const removed = document.createElement('div');
    removed.className = 'excalidraw-embedded-img';
    removed.setAttribute('fileSource', 'Drawing.excalidraw.md');
    removed.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    const view = { contentEl, getMode: () => 'source' } as any;
    const manager = makeManager();
    const detachSubtree = vi.fn();
    (manager as any).layoutCoordinators.set(view, { detachSubtree });
    vi.spyOn(manager as any, 'isLivePreview').mockReturnValue(true);

    (manager as any).collectMutatedMedia(view, [{
      type: 'childList',
      target: contentEl,
      addedNodes: [],
      removedNodes: [removed]
    }] as unknown as MutationRecord[]);

    expect(detachSubtree).toHaveBeenCalledOnce();
    expect(detachSubtree).toHaveBeenCalledWith(removed);
  });

  it('processes a network image that was rendered before its Live Preview observer starts', async () => {
    const source = '![GFL current droop|center|800](https://example.com/gfl?id=1)';
    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-source-view';
    document.body.appendChild(contentEl);
    const contentContainer = contentEl.appendChild(document.createElement('div'));
    contentContainer.className = 'cm-contentContainer';
    const cmContent = contentContainer.appendChild(document.createElement('div'));
    cmContent.className = 'cm-content';
    const imageEmbed = cmContent.appendChild(document.createElement('div'));
    imageEmbed.className = 'image-embed';
    const imageWrapper = imageEmbed.appendChild(document.createElement('div'));
    imageWrapper.className = 'image-wrapper';
    const img = imageWrapper.appendChild(document.createElement('img'));
    img.src = 'https://example.com/gfl?id=1';
    const descriptor = getImageSourceDescriptors(source)[0];
    const sourceKey = getImageSourceKey(descriptor);
    const layoutKey = getImageLayoutKey(descriptor);
    const caption = cmContent.appendChild(document.createElement('span'));
    caption.className = 'image-assistant-caption image-assistant-live-preview-caption';
    caption.setAttribute('data-image-assistant-caption-renderer', 'codemirror');
    caption.setAttribute('data-image-assistant-source-key', sourceKey);
    caption.setAttribute('data-image-assistant-layout-key', layoutKey);
    caption.setAttribute('data-image-assistant-caption-width', 'auto');
    caption.setAttribute('data-image-assistant-caption-wrap', 'false');
    vi.spyOn(contentContainer, 'getBoundingClientRect').mockReturnValue({
      left: 100, width: 1000, right: 1100, top: 0, bottom: 500,
      height: 500, x: 100, y: 0, toJSON: () => ({})
    } as DOMRect);
    vi.spyOn(img, 'getBoundingClientRect').mockImplementation(() => {
      const offset = Number.parseFloat(
        imageEmbed.style.getPropertyValue('--image-assistant-layout-offset')
      ) || 0;
      return {
        left: 100 + offset, width: 800, right: 900 + offset, top: 0, bottom: 100,
        height: 100, x: 100 + offset, y: 0, toJSON: () => ({})
      } as DOMRect;
    });
    vi.spyOn(caption, 'getBoundingClientRect').mockImplementation(() => {
      const offset = Number.parseFloat(
        caption.style.getPropertyValue('--image-assistant-caption-offset')
      ) || 0;
      return {
        left: 100 + offset, width: 800, right: 900 + offset, top: 100, bottom: 130,
        height: 30, x: 100 + offset, y: 100, toJSON: () => ({})
      } as DOMRect;
    });
    let sourceKeyDuringMeasureRead: string | null | undefined;
    const editor = {
      getValue: vi.fn(() => source),
      getLine: vi.fn(() => source),
      lineCount: vi.fn(() => 1),
      cm: {
        state: { field: vi.fn(() => true), doc: { toString: () => source } },
        posAtDOM: vi.fn(() => source.length),
        dispatch: vi.fn(),
        requestMeasure: vi.fn((request: any) => {
          const measurement = request.read();
          sourceKeyDuringMeasureRead = img.getAttribute('data-image-assistant-source-key');
          request.write(measurement);
        })
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
    manager.initialize(alignment, { removeImage: vi.fn() } as any);

    manager.start();
    await Promise.resolve();
    const coordinator = [...(manager as any).layoutCoordinators.values()][0];
    (coordinator as any).flush();

    expect(img.style.width).toBe('');
    expect(sourceKeyDuringMeasureRead).toBeNull();
    expect(editor.cm.requestMeasure).toHaveBeenCalledOnce();
    expect(imageEmbed.getAttribute('data-image-assistant-align')).toBe('center');
    expect(img.getAttribute('data-image-assistant-source-key')).toContain('https://example.com/gfl?id=1');
    expect(imageEmbed.getAttribute('data-image-assistant-layout-positioned')).toBe('true');
    expect(imageEmbed.style.getPropertyValue('--image-assistant-layout-offset')).toBe('100px');
    expect(caption.getAttribute('data-image-assistant-caption-positioned')).toBe('true');
    expect(caption.style.getPropertyValue('--image-assistant-caption-rendered-width')).toBe('800px');
    expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('100px');

    manager.onunload();
    contentEl.remove();
  });

  it.each([
    ['nested non-media block wrapper', 'cm-embed-block', false],
    ['stable 1.13.4 line widget', 'cm-line', true]
  ] as const)('registers geometry only for a %s', (_label, wrapperClass, expected) => {
    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-source-view';
    const cmContent = contentEl.appendChild(document.createElement('div'));
    cmContent.className = 'cm-content';
    const widget = cmContent.appendChild(document.createElement('div'));
    widget.className = wrapperClass;
    const embed = widget.appendChild(document.createElement('div'));
    embed.className = 'image-embed';
    const image = embed.appendChild(document.createElement('img'));
    const view = {
      contentEl,
      file: { path: 'notes/stability.md' },
      getMode: () => 'source',
      editor: { getValue: vi.fn(() => '') }
    };
    const app = {
      workspace: {
        getLeavesOfType: vi.fn(() => [{ view }]),
        getActiveViewOfType: vi.fn(() => view)
      }
    };
    const manager = makeManager(app);
    const registerTarget = vi.fn();
    (manager as any).layoutCoordinators.set(view, { registerTarget });

    (manager as any).applyImageResolution(image, {
      status: 'resolved',
      state: {
        align: 'right',
        wrap: false,
        pipeAlignment: 'right',
        standalone: true,
        sourceKey: 'source:stable',
        layoutKey: 'layout:stable',
        layoutScope: 'root'
      }
    });

    expect(registerTarget).toHaveBeenCalledTimes(expected ? 1 : 0);
  });

  it('registers a direct media-bearing cm-embed-block owner', () => {
    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-source-view';
    const cmContent = contentEl.appendChild(document.createElement('div'));
    cmContent.className = 'cm-content';
    const embed = cmContent.appendChild(document.createElement('div'));
    embed.className = 'cm-embed-block image-embed';
    const image = embed.appendChild(document.createElement('img'));
    const view = {
      contentEl,
      file: { path: 'notes/direct-block.md' },
      getMode: () => 'source',
      editor: { getValue: vi.fn(() => '') }
    };
    const manager = makeManager({
      workspace: {
        getLeavesOfType: vi.fn(() => [{ view }]),
        getActiveViewOfType: vi.fn(() => view)
      }
    });
    const registerTarget = vi.fn();
    (manager as any).layoutCoordinators.set(view, { registerTarget });

    (manager as any).applyImageResolution(image, {
      status: 'resolved',
      state: {
        align: 'right',
        wrap: false,
        pipeAlignment: 'right',
        standalone: true,
        sourceKey: 'source:direct-block',
        layoutKey: 'layout:direct-block',
        layoutScope: 'root'
      }
    });

    expect(registerTarget).toHaveBeenCalledOnce();
    expect(registerTarget).toHaveBeenCalledWith(
      expect.objectContaining({ owner: embed, placement: embed }),
      'layout:direct-block',
      expect.objectContaining({ alignment: 'right' })
    );
  });

  it.each([
    ['an unbound render', '', false, false],
    ['an image reveal tooltip', 'cm-image-reveal-tooltip', true, false],
    ['a hover popover', 'hover-popover', true, false]
  ] as const)('does not register geometry for %s', (
    _label,
    transientClass,
    hasSourceKey,
    expected
  ) => {
    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-source-view';
    const cmContent = contentEl.appendChild(document.createElement('div'));
    cmContent.className = 'cm-content';
    const line = cmContent.appendChild(document.createElement('div'));
    line.className = 'cm-line';
    const transient = transientClass
      ? line.appendChild(document.createElement('div'))
      : line;
    if (transientClass) transient.className = transientClass;
    const embed = transient.appendChild(document.createElement('span'));
    embed.className = 'image-embed';
    const image = embed.appendChild(document.createElement('img'));
    const view = {
      contentEl,
      file: { path: 'notes/transient.md' },
      getMode: () => 'source',
      editor: { getValue: vi.fn(() => '') }
    };
    const manager = makeManager({
      workspace: {
        getLeavesOfType: vi.fn(() => [{ view }]),
        getActiveViewOfType: vi.fn(() => view)
      }
    });
    const registerTarget = vi.fn();
    (manager as any).layoutCoordinators.set(view, { registerTarget });

    (manager as any).applyImageResolution(image, {
      status: 'resolved',
      state: {
        align: 'right',
        wrap: false,
        pipeAlignment: 'right',
        standalone: true,
        ...(hasSourceKey ? { sourceKey: 'source:transient' } : {}),
        layoutKey: 'layout:transient',
        layoutScope: 'root'
      }
    });

    expect(registerTarget).toHaveBeenCalledTimes(expected ? 1 : 0);
  });

  it('rejects a nested image-embed even when its source binding is unique', () => {
    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-source-view';
    const cmContent = contentEl.appendChild(document.createElement('div'));
    cmContent.className = 'cm-content';
    const line = cmContent.appendChild(document.createElement('div'));
    line.className = 'cm-line';
    const outer = line.appendChild(document.createElement('span'));
    outer.className = 'image-embed';
    const inner = outer.appendChild(document.createElement('span'));
    inner.className = 'image-embed';
    const image = inner.appendChild(document.createElement('img'));
    const view = {
      contentEl,
      file: { path: 'notes/nested.md' },
      getMode: () => 'source',
      editor: { getValue: vi.fn(() => '') }
    };
    const manager = makeManager({
      workspace: {
        getLeavesOfType: vi.fn(() => [{ view }]),
        getActiveViewOfType: vi.fn(() => view)
      }
    });
    const registerTarget = vi.fn();
    (manager as any).layoutCoordinators.set(view, { registerTarget });

    (manager as any).applyImageResolution(image, {
      status: 'resolved',
      state: {
        align: 'right',
        wrap: false,
        pipeAlignment: 'right',
        standalone: true,
        sourceKey: 'source:nested',
        layoutKey: 'layout:nested',
        layoutScope: 'root'
      }
    });

    expect(registerTarget).not.toHaveBeenCalled();
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
        cm: {
          state: { field: vi.fn(() => true), doc: { toString: () => '' } },
          dispatch: vi.fn(),
          requestMeasure: vi.fn((request: any) => request.write(request.read()))
        }
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
    manager.initialize({ cleanup: vi.fn() } as any, { removeImage: vi.fn() } as any);
    const applyImageResolution = vi.spyOn(manager as any, 'applyImageResolution')
      .mockImplementation(() => undefined);

    manager.start();
    leaves = [{ view: firstView }, { view: secondView }];
    events.get('layout-change')?.();
    expect(applyImageResolution).toHaveBeenCalledOnce();
    expect(applyImageResolution).toHaveBeenCalledWith(secondImage, { status: 'absent' });
    expect((manager as any).observers.size).toBe(2);

    manager.onunload();
  });

  it('creates Live Preview ownership on an effect-only same-leaf mode transition', () => {
    const contentEl = document.createElement('div');
    const editorDom = contentEl.appendChild(document.createElement('div'));
    let mode: 'preview' | 'source' = 'preview';
    const view = {
      contentEl,
      file: { path: 'notes/mode-transition.md' },
      getMode: () => mode,
      editor: {
        getValue: vi.fn(() => ''),
        cm: {
          state: { field: vi.fn(() => true), doc: { toString: () => '' } },
          dispatch: vi.fn(),
          requestMeasure: vi.fn()
        }
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
    manager.initialize(
      { cleanup: vi.fn() } as any,
      { removeImage: vi.fn() } as any
    );

    manager.start();
    expect((manager as any).layoutCoordinators.size).toBe(0);

    mode = 'source';
    manager.handleLivePreviewEditorUpdate(editorDom, {
      reconcileSource: false,
      geometryChanged: false,
      modeChanged: true
    });

    expect((manager as any).layoutCoordinators.has(view)).toBe(true);
    expect((manager as any).observers.has(view)).toBe(true);
    manager.onunload();
  });

  it('does not rescan workspace leaves for ordinary updates with an existing coordinator', () => {
    const contentEl = document.createElement('div');
    const editorDom = contentEl.appendChild(document.createElement('div'));
    const view = {
      contentEl,
      file: { path: 'notes/steady-live-preview.md' },
      getMode: () => 'source',
      editor: {
        getValue: vi.fn(() => ''),
        cm: {
          state: { field: vi.fn(() => true), doc: { toString: () => '' } },
          dispatch: vi.fn(),
          requestMeasure: vi.fn()
        }
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
    manager.initialize(
      { cleanup: vi.fn() } as any,
      { removeImage: vi.fn() } as any
    );
    manager.start();
    workspace.getLeavesOfType.mockClear();

    manager.handleLivePreviewEditorUpdate(editorDom, {
      reconcileSource: false,
      geometryChanged: false
    });

    expect(workspace.getLeavesOfType).not.toHaveBeenCalled();
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
      manager.initialize({ cleanup: vi.fn() } as any, { removeImage: vi.fn() } as any);
      const processImage = vi.spyOn(manager, 'processImage').mockImplementation(() => undefined);

      manager.start();
      await Promise.resolve();
      processImage.mockClear();

      expect(instances).toHaveLength(1);
      expect(instances[0].observe).toHaveBeenCalledWith(contentEl);
      const coordinator = [...(manager as any).layoutCoordinators.values()][0];
      const target = resolveRenderedMediaLayoutTarget(image);
      expect(target).not.toBeNull();
      coordinator.registerTarget(target!, 'source-key', {
        standalone: true,
        scope: 'root',
        alignment: 'left',
        wrap: false
      });
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

  it('observes only renderer identity and intrinsic-size attributes', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'MutationObserver');
    const observeCalls: MutationObserverInit[] = [];
    class TestMutationObserver {
      readonly observe = vi.fn((_target: Node, options?: MutationObserverInit) => {
        if (options) observeCalls.push(options);
      });
      readonly disconnect = vi.fn();
      readonly takeRecords = vi.fn(() => [] as MutationRecord[]);
      constructor(_callback: MutationCallback) {}
    }
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: TestMutationObserver
    });

    try {
      const contentEl = document.createElement('div');
      const view = {
        contentEl,
        file: { path: 'notes/observer-contract.md' },
        getMode: () => 'source',
        editor: {
          getValue: vi.fn(() => ''),
          cm: { state: { field: vi.fn(() => true), doc: { toString: () => '' } } }
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
      manager.initialize({ cleanup: vi.fn() } as any, { removeImage: vi.fn() } as any);

      manager.start();

      const mediaObserver = observeCalls.find(options => options.attributes === true);
      expect(mediaObserver).toBeDefined();
      expect(mediaObserver?.attributeFilter).toEqual([
        'src', 'width', 'height', 'filesource', 'fileSource'
      ]);
      expect(mediaObserver?.attributeFilter).not.toContain('alt');
      expect(mediaObserver?.attributeFilter).not.toContain('class');
      expect(mediaObserver?.attributeFilter).not.toContain('style');
      manager.onunload();
    } finally {
      if (original) Object.defineProperty(window, 'MutationObserver', original);
      else delete (window as unknown as { MutationObserver?: unknown }).MutationObserver;
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
        cm: {
          state: { field: vi.fn(() => true), doc: { toString: () => '' } },
          dispatch: vi.fn(),
          requestMeasure: vi.fn((request: any) => request.write(request.read()))
        }
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
    manager.initialize(alignment, { removeImage: vi.fn() } as any);
    const applyImageResolution = vi.spyOn(manager as any, 'applyImageResolution')
      .mockImplementation(() => undefined);

    manager.start();
    expect((manager as any).observers.size).toBe(2);
    firstContent.appendChild(document.createElement('img'));
    secondContent.appendChild(document.createElement('img'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(applyImageResolution).toHaveBeenCalledTimes(2);

    manager.onunload();
    expect((manager as any).observers.size).toBe(0);
    expect(alignment.cleanup).toHaveBeenCalledWith(firstContent);
    expect(alignment.cleanup).toHaveBeenCalledWith(secondContent);
  });

});
