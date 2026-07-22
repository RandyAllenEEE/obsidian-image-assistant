import { describe, expect, it, vi } from 'vitest';
import { CaptionRenderCoordinator } from '../../../../src/ui/caption/CaptionRenderCoordinator';
import { CaptionSectionRenderChild } from '../../../../src/ui/caption/CaptionSectionRenderChild';
import { fakeApp, fakeMetadataCache, fakeTFile } from '../../../factories/obsidian';

describe('CaptionRenderCoordinator', () => {
  it('binds repeated network images in source order', () => {
    const coordinator = new CaptionRenderCoordinator(fakeApp() as any);
    const binding = coordinator.createSectionBinding([
      '![First caption](https://cdn.example.com/photo.png)',
      '![Second caption](https://cdn.example.com/photo.png)'
    ].join('\n'), 'notes/current.md');
    const first = document.createElement('img');
    first.src = 'https://cdn.example.com/photo.png';
    const second = document.createElement('img');
    second.src = 'https://cdn.example.com/photo.png';

    expect(binding?.resolveImage(first)?.source).toContain('First caption');
    expect(binding?.resolveImage(second)?.source).toContain('Second caption');
    expect(coordinator.getLinkText(first)).toContain('First caption');
  });

  it('creates descriptors for legacy ad-* block content but not normal fences', () => {
    const coordinator = new CaptionRenderCoordinator(fakeApp() as any);
    const binding = coordinator.createSectionBinding([
      '```ad-note',
      '![[https://cdn.example.com/ad.webp|Admonition caption|300]]',
      '```',
      '```markdown',
      '![[https://cdn.example.com/code.webp|Code caption]]',
      '```'
    ].join('\n'), 'notes/current.md');
    const image = document.createElement('img');
    image.src = 'https://cdn.example.com/ad.webp';

    expect(binding?.descriptors).toHaveLength(1);
    expect(binding?.resolveImage(image)?.source).toContain('Admonition caption');
  });

  it('matches local Wiki images through resolved vault paths and app:// URLs', () => {
    const file = fakeTFile({ path: 'attachments/photo.png', name: 'photo.png', extension: 'png' });
    const metadataCache = fakeMetadataCache();
    metadataCache.getFirstLinkpathDest = vi.fn(() => file) as any;
    const app = fakeApp({ metadataCache }) as any;
    const coordinator = new CaptionRenderCoordinator(app);
    const binding = coordinator.createSectionBinding('![[photo.png|Local caption|320]]', 'notes/current.md');
    const image = document.createElement('img');
    image.src = 'app://local/C:/Vault/attachments/photo.png?mtime=123';

    expect(binding?.resolveImage(image)?.source).toContain('Local caption');
  });

  it('processes delayed Admonition images once their DOM output exists', async () => {
    const coordinator = new CaptionRenderCoordinator(fakeApp() as any);
    const binding = coordinator.createSectionBinding(
      '```ad-note\n![Caption](https://cdn.example.com/delayed.webp)\n```',
      'notes/current.md'
    );
    const container = document.createElement('div');
    const onImage = vi.fn();
    const child = new CaptionSectionRenderChild(container, binding, onImage);
    child.onload();

    const image = document.createElement('img');
    image.src = 'https://cdn.example.com/delayed.webp';
    container.appendChild(image);

    await vi.waitFor(() => expect(onImage).toHaveBeenCalledWith(
      image,
      expect.objectContaining({
        linkText: expect.stringContaining('Caption'),
        descriptor: expect.objectContaining({ context: 'admonition' })
      })
    ));
    child.onunload();
  });

  it('does not reprocess images when the plugin adds a caption node', async () => {
    const coordinator = new CaptionRenderCoordinator(fakeApp() as any);
    const binding = coordinator.createSectionBinding(
      '![Caption](https://cdn.example.com/stable.webp)',
      'notes/current.md'
    );
    const container = document.createElement('div');
    const image = document.createElement('img');
    image.src = 'https://cdn.example.com/stable.webp';
    container.appendChild(image);
    const onImage = vi.fn();
    const child = new CaptionSectionRenderChild(container, binding, onImage);

    child.onload();
    container.appendChild(document.createElement('span'));
    await Promise.resolve();

    expect(onImage).toHaveBeenCalledOnce();
    child.onunload();
  });

  it('remaps repeated URLs after a rendered image is replaced', () => {
    const coordinator = new CaptionRenderCoordinator(fakeApp() as any);
    const binding = coordinator.createSectionBinding([
      '![First](https://cdn.example.com/photo.png)',
      '![Second](https://cdn.example.com/photo.png)'
    ].join('\n'), 'notes/current.md')!;
    const first = document.createElement('img');
    const second = document.createElement('img');
    const replacement = document.createElement('img');
    for (const image of [first, second, replacement]) {
      image.src = 'https://cdn.example.com/photo.png';
    }

    const initial = binding.resolveImages([first, second]);
    const remounted = binding.resolveImages([replacement, second]);

    expect(initial.get(first)?.name).toBe('First');
    expect(initial.get(second)?.name).toBe('Second');
    expect(remounted.get(replacement)?.name).toBe('First');
    expect(remounted.get(second)?.name).toBe('Second');
  });

  it('does not let an unrelated dynamic image steal the only source descriptor', () => {
    const coordinator = new CaptionRenderCoordinator(fakeApp() as any);
    const binding = coordinator.createSectionBinding(
      '![Caption](https://cdn.example.com/expected.png)',
      'notes/current.md'
    )!;
    const dynamic = document.createElement('img');
    dynamic.src = 'data:image/png;base64,AAAA';
    const expected = document.createElement('img');
    expected.src = 'https://cdn.example.com/expected.png';

    const resolved = binding.resolveImages([dynamic, expected]);

    expect(resolved.has(dynamic)).toBe(false);
    expect(resolved.get(expected)?.name).toBe('Caption');
  });

  it('does not order-fallback a proxy image across a conflicting direct match', () => {
    const coordinator = new CaptionRenderCoordinator(fakeApp() as any);
    const binding = coordinator.createSectionBinding([
      '![First](https://cdn.example.com/first.png)',
      '![Second](https://cdn.example.com/second.png)'
    ].join('\n'), 'notes/current.md')!;
    const proxy = document.createElement('img');
    proxy.src = 'blob:https://obsidian.local/proxy';
    const directlyMatchedFirst = document.createElement('img');
    directlyMatchedFirst.src = 'https://cdn.example.com/first.png';

    const resolved = binding.resolveImages([proxy, directlyMatchedFirst]);

    expect(resolved.has(proxy)).toBe(false);
    expect(resolved.get(directlyMatchedFirst)?.name).toBe('First');
  });

  it('releases removed images from the binding and renderer callback', async () => {
    const coordinator = new CaptionRenderCoordinator(fakeApp() as any);
    const binding = coordinator.createSectionBinding(
      '![Caption](https://cdn.example.com/photo.png)',
      'notes/current.md'
    );
    const container = document.createElement('div');
    const image = document.createElement('img');
    image.src = 'https://cdn.example.com/photo.png';
    container.appendChild(image);
    const onRemove = vi.fn();
    const child = new CaptionSectionRenderChild(container, binding, vi.fn(), onRemove);
    child.onload();

    image.remove();
    await vi.waitFor(() => expect(onRemove).toHaveBeenCalledWith(image));

    expect(coordinator.getLinkText(image)).toBeNull();
    child.onunload();
  });

  it('does not run a queued section scan after the render child unloads', async () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 1);
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    const container = document.createElement('div');
    const onImage = vi.fn();
    const child = new CaptionSectionRenderChild(container, null, onImage);
    child.onload();
    container.appendChild(document.createElement('img'));
    (child as any).scheduleProcess();

    child.onunload();
    await Promise.resolve();

    expect(onImage).not.toHaveBeenCalled();
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(1);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });
});
