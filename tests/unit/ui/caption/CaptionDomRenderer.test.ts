import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptionDomRenderer } from '../../../../src/ui/caption/CaptionDomRenderer';
import { ResolvedCaptionState } from '../../../../src/ui/caption/CaptionResolver';
import { resolveRenderedMediaLayoutTarget } from '../../../../src/ui/RenderedMediaLayoutTarget';

function state(caption: string | null): ResolvedCaptionState {
  return {
    path: 'image.png',
    caption,
    align: null,
    linkType: 'markdown',
    shouldRender: !!caption
  };
}

describe('CaptionDomRenderer', () => {
  let renderer: CaptionDomRenderer;

  beforeEach(() => {
    document.body.innerHTML = '';
    renderer = new CaptionDomRenderer();
  });

  it('appends a caption inside image embed containers', () => {
    const embed = document.createElement('span');
    embed.className = 'internal-embed image-embed';
    const img = document.createElement('img');
    embed.appendChild(img);
    document.body.appendChild(embed);

    const caption = renderer.render(img, state('Embed caption'));

    expect(caption?.parentElement).toBe(embed);
    expect(caption?.textContent).toBe('Embed caption');
    expect(embed.classList.contains('has-image-assistant-caption')).toBe(true);
  });

  it('does not make an Obsidian image-wrapper the caption layout owner', () => {
    const wrapper = document.createElement('span');
    wrapper.className = 'image-wrapper';
    const img = document.createElement('img');
    wrapper.appendChild(img);
    document.body.appendChild(wrapper);

    renderer.render(img, state('First caption'));
    renderer.render(img, state('Updated caption'));

    const captions = document.body.querySelectorAll('.image-assistant-caption');
    expect(captions).toHaveLength(1);
    expect(captions[0].parentElement).toBe(wrapper);
    expect(captions[0].previousElementSibling).toBe(img);
    expect(captions[0].textContent).toBe('Updated caption');
  });

  it('supports bare network images without wrapping or moving the image', () => {
    const paragraph = document.createElement('p');
    const img = document.createElement('img');
    img.setAttribute('src', 'https://example.com/photo.png');
    paragraph.appendChild(img);
    document.body.appendChild(paragraph);

    const caption = renderer.render(img, state('Network caption'));

    expect(img.parentElement).toBe(paragraph);
    expect(caption?.previousElementSibling).toBe(img);
    expect(caption?.textContent).toBe('Network caption');
    expect(caption?.tagName).toBe('SPAN');
    expect(caption?.getAttribute('aria-hidden')).toBe('true');
    expect(caption?.getAttribute('data-image-assistant-caption-renderer')).toBe('dom');
  });

  it('uses the unified outer owner for an Excalidraw IMG source render', () => {
    const view = document.body.appendChild(document.createElement('div'));
    view.className = 'markdown-preview-view';
    const embed = view.appendChild(document.createElement('span'));
    embed.className = 'internal-embed image-embed';
    const img = embed.appendChild(document.createElement('img'));
    img.className = 'excalidraw-embedded-img';
    img.setAttribute('fileSource', 'Drawing.excalidraw.md');

    const caption = renderer.render(img, state('Drawing caption'));

    expect(caption?.parentElement).toBe(embed);
    expect(caption?.textContent).toBe('Drawing caption');
    expect(img.style.width).toBe('');
    expect(img.style.maxWidth).toBe('');
  });

  it('keeps captions distinct for multiple bare images in one container', () => {
    const paragraph = document.createElement('p');
    const first = document.createElement('img');
    const second = document.createElement('img');
    paragraph.append(first, second);
    document.body.appendChild(paragraph);

    renderer.render(first, state('First caption'));
    renderer.render(second, state('Second caption'));
    renderer.render(first, state('First caption updated'));

    expect([...paragraph.querySelectorAll('.image-assistant-caption')]
      .map(node => node.textContent)).toEqual(['First caption updated', 'Second caption']);
  });

  it('removes an existing caption when state is no longer renderable', () => {
    const img = document.createElement('img');
    Object.defineProperty(img, 'width', { configurable: true, value: 320 });
    document.body.appendChild(img);

    renderer.render(img, state('Caption'));
    expect(img.style.getPropertyValue('--img-width')).toBe('320px');
    renderer.render(img, state(null));

    expect(document.body.querySelector('.image-assistant-caption')).toBeNull();
    expect(img.hasAttribute('data-image-assistant-caption-owner')).toBe(false);
    expect(img.style.getPropertyValue('--img-width')).toBe('');
  });

  it('cleans up captions and marker classes from a root', () => {
    const embed = document.createElement('span');
    embed.className = 'external-embed';
    const img = document.createElement('img');
    embed.appendChild(img);
    document.body.appendChild(embed);
    renderer.render(img, state('Caption'));

    renderer.cleanup(document.body);

    expect(document.body.querySelector('.image-assistant-caption')).toBeNull();
    expect(embed.classList.contains('has-image-assistant-caption')).toBe(false);
    expect(embed.hasAttribute('data-image-assistant-caption-owner')).toBe(false);
  });

  it('does not remove CodeMirror-owned caption widgets during DOM cleanup', () => {
    const codeMirrorCaption = document.createElement('span');
    codeMirrorCaption.className = 'image-assistant-caption';
    codeMirrorCaption.setAttribute('data-image-assistant-caption-renderer', 'codemirror');
    document.body.appendChild(codeMirrorCaption);

    renderer.cleanup(document.body);

    expect(codeMirrorCaption.isConnected).toBe(true);
  });

  it('applies container width and line clamp without changing image attributes', () => {
    const img = document.createElement('img');
    img.setAttribute('alt', 'Original alt');
    img.setAttribute('title', 'Original title');
    document.body.appendChild(img);

    const caption = renderer.render(img, state('A long caption'), {
      widthMode: 'container',
      maxLines: 2
    });

    expect(caption?.style.getPropertyValue('--img-width')).toBe('100%');
    expect(caption?.getAttribute('data-image-assistant-caption-width')).toBe('container');
    expect(caption?.style.getPropertyValue('--image-assistant-caption-max-lines')).toBe('2');
    expect(caption?.title).toBe('A long caption');
    expect(img.getAttribute('alt')).toBe('Original alt');
    expect(img.getAttribute('title')).toBe('Original title');
  });

  it('does not mutate the DOM when the rendered state is unchanged', async () => {
    const img = document.createElement('img');
    document.body.appendChild(img);
    renderer.render(img, state('Stable caption'));

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });

    renderer.render(img, state('Stable caption'));
    await new Promise(resolve => setTimeout(resolve, 0));
    observer.disconnect();

    expect(mutations).toHaveLength(0);
  });

  it('writes independent figure-placement and caption-text metadata', () => {
    const embed = document.createElement('span');
    embed.className = 'internal-embed image-embed';
    const img = embed.appendChild(document.createElement('img'));
    document.body.appendChild(embed);

    const caption = renderer.render(img, state('Aligned caption'), {
      sourceKey: '10:40:0:image.png',
      standalone: true,
      layout: {
        placement: 'right',
        textAlignment: 'center',
        wrap: true,
        source: 'pipe'
      }
    });

    expect(caption?.getAttribute('data-image-assistant-caption-text-align')).toBe('center');
    expect(caption?.hasAttribute('data-image-assistant-caption-align')).toBe(false);
    expect(caption?.getAttribute('data-image-assistant-caption-wrap')).toBe('true');
    expect(caption?.getAttribute('data-image-assistant-caption-standalone')).toBe('true');
    expect(caption?.getAttribute('data-image-assistant-source-key')).toBe('10:40:0:image.png');
    expect(embed.getAttribute('data-image-assistant-caption-placement')).toBe('right');
  });

  it('anchors an external Excalidraw caption to its actual SVG surface', () => {
    const view = document.body.appendChild(document.createElement('div'));
    view.className = 'markdown-preview-view';
    const embed = view.appendChild(document.createElement('span'));
    embed.className = 'internal-embed image-embed';
    const marker = embed.appendChild(document.createElement('div'));
    marker.className = 'excalidraw-embedded-img';
    marker.setAttribute('fileSource', 'Drawing.excalidraw.md');
    const svg = marker.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    svg.classList.add('excalidraw-svg');
    const target = resolveRenderedMediaLayoutTarget(svg)!;
    const diagramState = {
      ...state('Drawing caption'),
      size: { width: 160, format: 'W' as const }
    };

    const caption = renderer.renderTarget(target, diagramState, {
      widthMode: 'auto',
      layout: {
        placement: 'left',
        textAlignment: 'center',
        wrap: false,
        source: 'pipe'
      }
    })!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 500,
      width: 320
    } as DOMRect);
    vi.spyOn(caption, 'getBoundingClientRect').mockImplementation(() => {
      const offset = Number.parseFloat(
        caption.style.getPropertyValue('--image-assistant-caption-offset')
      ) || 0;
      return { left: 40 + offset, width: 320 } as DOMRect;
    });

    renderer.renderTarget(target, diagramState, { widthMode: 'auto' });

    expect(caption.style.getPropertyValue('--img-width')).toBe('320px');
    expect(caption.getAttribute('data-image-assistant-caption-positioned')).toBe('true');
    expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('460px');
    expect(svg.style.width).toBe('');
    expect(svg.style.maxWidth).toBe('');
    renderer.cleanup(view);
  });

  it('tracks popout image widths with the owner window ResizeObserver', () => {
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    const observe = vi.fn();
    const disconnect = vi.fn();
    const OwnerResizeObserver = vi.fn(function () {
      return { observe, disconnect };
    });
    Object.defineProperty(popoutDocument, 'defaultView', {
      configurable: true,
      value: { ResizeObserver: OwnerResizeObserver }
    });
    const img = popoutDocument.createElement('img');
    popoutDocument.body.appendChild(img);

    renderer.render(img, state('Popout caption'), {
      document: popoutDocument
    });

    expect(OwnerResizeObserver).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledWith(img);

    renderer.cleanup(popoutDocument);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('shares one observer per document and defers resize writes to animation frame', () => {
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    let resizeCallback!: ResizeObserverCallback;
    let frameCallback: FrameRequestCallback | null = null;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    const OwnerResizeObserver = vi.fn(function (callback: ResizeObserverCallback) {
      resizeCallback = callback;
      return { observe, unobserve, disconnect };
    });
    Object.defineProperty(popoutDocument, 'defaultView', {
      configurable: true,
      value: {
        ResizeObserver: OwnerResizeObserver,
        requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
          frameCallback = callback;
          return 1;
        }),
        cancelAnimationFrame: vi.fn()
      }
    });
    const first = popoutDocument.body.appendChild(popoutDocument.createElement('img'));
    const second = popoutDocument.body.appendChild(popoutDocument.createElement('img'));
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ width: 100 } as DOMRect);
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ width: 120 } as DOMRect);

    const firstCaption = renderer.render(first, state('First'), {
      document: popoutDocument
    });
    renderer.render(second, state('Second'), { document: popoutDocument });

    expect(OwnerResizeObserver).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledTimes(2);
    expect(firstCaption?.style.getPropertyValue('--img-width')).toBe('100px');

    resizeCallback([
      { target: first, contentRect: { width: 240 } as DOMRectReadOnly }
    ] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    expect(firstCaption?.style.getPropertyValue('--img-width')).toBe('100px');

    expect(frameCallback).not.toBeNull();
    (frameCallback as unknown as FrameRequestCallback)(0);
    expect(firstCaption?.style.getPropertyValue('--img-width')).toBe('240px');

    renderer.cleanup(popoutDocument);
    expect(unobserve).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
