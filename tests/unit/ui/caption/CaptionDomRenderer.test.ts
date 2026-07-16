import { beforeEach, describe, expect, it } from 'vitest';
import { CaptionDomRenderer } from '../../../../src/ui/caption/CaptionDomRenderer';
import { ResolvedCaptionState } from '../../../../src/ui/caption/CaptionResolver';

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

  it('places image-wrapper captions after the wrapper and updates without duplicates', () => {
    const wrapper = document.createElement('span');
    wrapper.className = 'image-wrapper';
    const img = document.createElement('img');
    wrapper.appendChild(img);
    document.body.appendChild(wrapper);

    renderer.render(img, state('First caption'));
    renderer.render(img, state('Updated caption'));

    const captions = document.body.querySelectorAll('.image-assistant-caption');
    expect(captions).toHaveLength(1);
    expect(captions[0].previousElementSibling).toBe(wrapper);
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

  it('writes resolved alignment, wrap, standalone, and source ownership metadata', () => {
    const embed = document.createElement('span');
    embed.className = 'internal-embed image-embed';
    const img = embed.appendChild(document.createElement('img'));
    document.body.appendChild(embed);

    const caption = renderer.render(img, state('Aligned caption'), {
      sourceKey: '10:40:0:image.png',
      standalone: true,
      layout: { alignment: 'right', wrap: true, source: 'pipe' }
    });

    expect(caption?.getAttribute('data-image-assistant-caption-align')).toBe('right');
    expect(caption?.getAttribute('data-image-assistant-caption-wrap')).toBe('true');
    expect(caption?.getAttribute('data-image-assistant-caption-standalone')).toBe('true');
    expect(caption?.getAttribute('data-image-assistant-source-key')).toBe('10:40:0:image.png');
    expect(embed.getAttribute('data-image-assistant-caption-align')).toBe('right');
  });
});
