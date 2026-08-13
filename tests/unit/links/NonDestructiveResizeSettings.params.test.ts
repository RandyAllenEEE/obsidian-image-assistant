import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkFormatter } from '../../../src/utils/LinkFormatter';
import type { EmbedResizeSettings } from '../../../src/settings/NonDestructiveResizeSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';
import { setMockImageSize } from '../../helpers/test-setup';

type NonDestructiveResizePreset = EmbedResizeSettings & { name?: string };

function makeFormatterForImage(path: string, width: number, height: number) {
  const file = fakeTFile({ path });
  const app = fakeApp({ vault: fakeVault({ files: [file] }) as any }) as any;
  (app.vault as any).getResourcePath = vi.fn(() => 'app://mock');
  const formatter = new LinkFormatter(app as any);
  setMockImageSize(width, height);
  return { app, file, formatter };
}

async function params(preset: NonDestructiveResizePreset, img: string, width: number, height: number) {
  const { formatter, file } = makeFormatterForImage(img, width, height);
  const out = await formatter.formatLink(file.path, 'wikilink', 'absolute', null, preset);
  // ![[/path|W]] or ![[/path|WxH]]
  const match = out.match(/\|([^\]]+)\]\]$/);
  return match ? match[1] : '';
}

describe('Non-destructive resize parameter computation (via LinkFormatter)', () => {
  beforeEach(() => {
    // Default editor width for editor-max-width tests
    vi.spyOn(LinkFormatter.prototype as any, 'getEditorMaxWidth').mockReturnValue(800);
  });

  it('20.1 Width (pixels) uses intrinsic height: 1000x800 → |500', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'W500', resizeDimension: 'width', width: 500,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('500');
  });

  it('20.2 Height (percentage) converts through intrinsic ratio: 50% of 1000x800 → |500', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'H50%', resizeDimension: 'height', height: 50,
      resizeScaleMode: 'auto', resizeUnits: 'percentage'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('500');
  });

  it('20.3 Both (custom) no aspect → exactly |300x100', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Both', resizeDimension: 'both', width: 300, height: 100,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('300x100');
  });

  it('20.4 Both (percentage) 50x25 on 1200x800 → |600x200', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Both %', resizeDimension: 'both', width: 50, height: 25,
      resizeScaleMode: 'auto', resizeUnits: 'percentage'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1200, 800);
    expect(sizeSpec).toBe('600x200');
  });

  it('20.5 Longest edge 1000 converts 2000x1000 to canonical |1000', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Longest 1000', resizeDimension: 'longest-edge', longestEdge: 1000,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 2000, 1000);
    expect(sizeSpec).toBe('1000');
  });

  it('20.5 Longest edge 1000 converts 1000x2000 to canonical |500', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Longest 1000', resizeDimension: 'longest-edge', longestEdge: 1000,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 2000);
    expect(sizeSpec).toBe('500');
  });

  it('20.6 Shortest edge 500 converts 2000x1000 to canonical |1000', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Shortest 500', resizeDimension: 'shortest-edge', shortestEdge: 500,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 2000, 1000);
    expect(sizeSpec).toBe('1000');
  });

  it('20.6 Shortest edge 500 converts 1000x2000 to canonical |500', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Shortest 500', resizeDimension: 'shortest-edge', shortestEdge: 500,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 2000);
    expect(sizeSpec).toBe('500');
  });

  it('20.8 Editor max width (pixels): editor=800, value=400 → |400', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Editor 400', resizeDimension: 'editor-max-width', editorMaxWidthValue: 400,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('400');
  });

  it('20.9 Editor max width (percentage): editor=800, value=50% → |400', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Editor 50%', resizeDimension: 'editor-max-width', editorMaxWidthValue: 50,
      resizeScaleMode: 'auto', resizeUnits: 'percentage'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('400');
  });

  it('20.11 Scale mode reduce clamps width above original', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Reduce W1200', resizeDimension: 'width', width: 1200,
      resizeScaleMode: 'reduce', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('1000');
  });

  it('20.13 None → empty string', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'None', resizeDimension: 'none',
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const { formatter, file } = makeFormatterForImage('img/p.png', 1000, 800);
    const out = await formatter.formatLink(file.path, 'wikilink', 'absolute', null, preset);
    expect(out).toBe('![[/img/p.png]]');
  });

  it('20.7 Original width emits only the original width', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Original Width keep aspect', resizeDimension: 'original-width',
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('1000');
  });

  it('20.7 Original width remains single-axis', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Original Width no aspect', resizeDimension: 'original-width',
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('1000');
  });

  it('20.10 Fixed width is not rewritten to the current editor width', async () => {
    vi.spyOn(LinkFormatter.prototype as any, 'getEditorMaxWidth').mockReturnValue(800);
    const preset: NonDestructiveResizePreset = {
      name: 'W1200 clamp to editor', resizeDimension: 'width', width: 1200,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('1200');
  });

  it('20.11 Scale mode enlarge raises below-original width to original', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Enlarge W500', resizeDimension: 'width', width: 500,
      resizeScaleMode: 'enlarge', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('1000');
  });

  it('20.11 Scale mode auto leaves width unchanged', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Auto W500', resizeDimension: 'width', width: 500,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('500');
  });

  it('20.14 Both with width only emits canonical W', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Both width only', resizeDimension: 'both', width: 300,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('300');
  });

  it('20.14 Both with height only derives canonical W from intrinsic ratio', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Both height only', resizeDimension: 'both', height: 200,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('250');
  });

  it('does not emit a zero token when a sub-pixel fixed width rounds down', async () => {
    const preset: NonDestructiveResizePreset = {
      name: 'Sub-pixel width', resizeDimension: 'width', width: 0.1,
      resizeScaleMode: 'auto', resizeUnits: 'pixels'
    };
    const sizeSpec = await params(preset, 'img/p.png', 1000, 800);
    expect(sizeSpec).toBe('');
  });
});
