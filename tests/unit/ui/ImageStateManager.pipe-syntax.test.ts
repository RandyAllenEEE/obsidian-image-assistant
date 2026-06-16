import { describe, expect, it, vi } from 'vitest';
import { ImageStateManager } from '../../../src/ui/ImageStateManager';

function makeManager() {
  const plugin = {
    settings: {
      alignment: {
        default: 'center'
      }
    }
  } as any;
  const manager = new ImageStateManager({} as any, plugin);
  (manager as any).alignment = {
    applyAlignmentToImage: vi.fn(),
    ensureReadingModeLayout: vi.fn()
  };
  (manager as any).resizer = {
    applySize: vi.fn()
  };
  (manager as any).caption = {
    applyCaption: vi.fn()
  };
  return manager;
}

describe('ImageStateManager pipe syntax integration', () => {
  it('maps reading-mode pipe syntax into alignment, size, and caption delegates', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'Caption|left-wrap|320x200');

    manager.processReadingModeImage(img);

    expect((manager as any).alignment.applyAlignmentToImage).toHaveBeenCalledWith(img, {
      position: 'left',
      wrap: true,
      width: '320',
      height: '200'
    });
    expect((manager as any).alignment.ensureReadingModeLayout).toHaveBeenCalledWith(img, 'left');
    expect((manager as any).resizer.applySize).toHaveBeenCalledWith(img, 320, 200);
    expect((manager as any).caption.applyCaption).toHaveBeenCalledWith(img, 'Caption');
  });

  it('uses the default alignment when the link has size but no align attribute', () => {
    const manager = makeManager();
    const img = document.createElement('img') as HTMLImageElement;
    img.setAttribute('alt', 'Caption|640');

    manager.processReadingModeImage(img);

    expect((manager as any).alignment.applyAlignmentToImage).toHaveBeenCalledWith(img, {
      position: 'center',
      wrap: false,
      width: '640',
      height: undefined
    });
    expect((manager as any).resizer.applySize).toHaveBeenCalledWith(img, 640, undefined);
    expect((manager as any).caption.applyCaption).toHaveBeenCalledWith(img, 'Caption');
  });
});
