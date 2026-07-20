import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Crop } from '../../../src/ui/Crop';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';
import { makeJpegBytes } from '../../factories/image';

function setRect(el: Element, rect: Partial<DOMRect>) {
  (el as any).getBoundingClientRect = () => ({
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 0),
    bottom: (rect.top ?? 0) + (rect.height ?? 0),
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    toJSON: () => {}
  } as DOMRect);
}

function openCropWithImage(bytesLen = 32) {
  const bytes = new ArrayBuffer(bytesLen);
  const files = [fakeTFile({ path: 'imgs/pic.jpg', name: 'pic.jpg', extension: 'jpg' })];
  const vault = fakeVault({ files, binaryContents: new Map([[files[0].path, bytes]]) });
  const app = fakeApp({ vault });
  const crop = new Crop(app as any, files[0]);
  return { crop, app };
}

describe('Crop integration behaviors (21.1–21.10)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('21.1 Selection drawing: drag creates a selection rect with expected bounds', async () => {
    // Arrange
    const { crop } = openCropWithImage(16);

    // Act
    // Do not await onOpen; allow image load microtask to resolve
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const cropContainer = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;
    const selection = root.querySelector('.selection-area') as HTMLDivElement;

    // Provide sizes for bounding client rects
    setRect(cropContainer, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // Start draw on original image
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 220, clientY: 160, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // Assert
    expect(cropContainer).toBeTruthy();
    expect(originalImg).toBeTruthy();
    expect(selection).toBeTruthy();
    expect(selection.style.display).toBe('block');
    expect(parseInt(selection.style.left || '0', 10)).toBe(100);
    expect(parseInt(selection.style.top || '0', 10)).toBe(100);
    expect(parseInt(selection.style.width || '0', 10)).toBe(120);
    expect(parseInt(selection.style.height || '0', 10)).toBe(60);
  });

  it('21.2 Move and bounds: selection moves within container', async () => {
    const { crop } = openCropWithImage();
    // Do not await onOpen; allow image load microtask to resolve
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // draw
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selection = root.querySelector('.selection-area') as HTMLDivElement;
    // drag selection
    selection.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 150, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000, clientY: 1000, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // should be clamped within container
    const left = parseInt(selection.style.left || '0', 10);
    const top = parseInt(selection.style.top || '0', 10);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
  }, 20000);

  it('21.3 Resize handles with aspect ratio preserved and orthogonal adjustment', async () => {
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // draw
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // set 1:1 aspect
    const button = root.querySelector('.aspect-ratio-button:nth-child(2)') as HTMLButtonElement; // free, 1:1, 16:9, 4:3
    button.click();

    const selection = root.querySelector('.selection-area') as HTMLDivElement;
    const seHandle = selection.querySelector('.se-resize') as HTMLDivElement;
    seHandle.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, clientY: 200, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 260, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selWidth = parseInt(selection.style.width || '0', 10);
    const selHeight = parseInt(selection.style.height || '0', 10);
    expect(Math.abs(selWidth - selHeight) <= 2).toBe(true);
  }, 20000);

  it('21.4/21.5 Aspect ratio presets and custom ratio adjust existing selection', async () => {
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // draw
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 240, clientY: 200, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // preset 16:9
    const buttons = root.querySelectorAll('.aspect-ratio-button');
    (buttons[2] as HTMLButtonElement).click();
    const selection = root.querySelector('.selection-area') as HTMLDivElement;
    const w1 = parseInt(selection.style.width || '0', 10);
    const h1 = parseInt(selection.style.height || '0', 10);
    expect(Math.abs(w1 / Math.max(h1,1) - 16/9) < 0.2).toBe(true);

    // custom 4:3 via inputs
    const inputs = root.querySelectorAll('.custom-ratio-input');
    (inputs[0] as HTMLInputElement).value = '4';
    (inputs[1] as HTMLInputElement).value = '3';
    (inputs[0] as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
    (inputs[1] as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));

    const w2 = parseInt(selection.style.width || '0', 10);
    const h2 = parseInt(selection.style.height || '0', 10);
    expect(Math.abs(w2 / Math.max(h2,1) - 4/3) < 0.2).toBe(true);
  }, 20000);

  it('21.8 Apply crop: modifyBinary is called when selection present', async () => {
    const { crop, app } = openCropWithImage();
    // Do not await; simulate image load manually
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // Simulate underlying image load to let onOpen() register listeners
    originalImg.dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // draw
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const spy = (app.vault as any).modifyBinary as any;

    // Stub toBlob to complete synchronously for deterministic tests
    const realToBlob = (HTMLCanvasElement.prototype as any).toBlob;
    (HTMLCanvasElement.prototype as any).toBlob = function(cb: any, type?: string) {
      const mime = typeof type === 'string' ? type : 'image/png';
      const blob = new Blob([makeJpegBytes({ w: 1, h: 1 })], { type: mime });
      cb(blob);
    };

    // Stub getContext to provide a minimal 2D context
    const realGetContext = (HTMLCanvasElement.prototype as any).getContext;
    (HTMLCanvasElement.prototype as any).getContext = function(_type: string) {
      return {
        drawImage: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        clearRect: () => {}
      } as any;
    };

    // Directly invoke save to avoid UI wiring races
    await (crop as any).saveImage();

    // Restore stubs
    (HTMLCanvasElement.prototype as any).toBlob = realToBlob;
    (HTMLCanvasElement.prototype as any).getContext = realGetContext;

    expect(spy).toHaveBeenCalled();
  }, 20000);

  it('21.9 No selection: full image saved without cropping', async () => {
    const { crop, app } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const root = (crop as any).contentEl as HTMLElement;
    const spy = (app.vault as any).modifyBinary as any;

    // Simulate load
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;
    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });
    originalImg.dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Stub toBlob to complete synchronously for deterministic tests
    const realToBlob = (HTMLCanvasElement.prototype as any).toBlob;
    (HTMLCanvasElement.prototype as any).toBlob = function(cb: any, type?: string) {
      const mime = typeof type === 'string' ? type : 'image/png';
      const blob = new Blob([makeJpegBytes({ w: 1, h: 1 })], { type: mime });
      cb(blob);
    };

    // Stub getContext to provide a minimal 2D context
    const realGetContext = (HTMLCanvasElement.prototype as any).getContext;
    (HTMLCanvasElement.prototype as any).getContext = function(_type: string) {
      return {
        drawImage: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        clearRect: () => {}
      } as any;
    };

    // Directly invoke save to avoid UI wiring races
    await (crop as any).saveImage();

    // Restore stubs
    (HTMLCanvasElement.prototype as any).toBlob = realToBlob;
    (HTMLCanvasElement.prototype as any).getContext = realGetContext;

    expect(spy).toHaveBeenCalled();
  });

  it('does not reset the active view while refreshing a saved image', async () => {
    const { crop, app } = openCropWithImage();
    const currentState = { type: 'markdown', state: { file: 'note.md' } };
    const leaf = {
      getViewState: vi.fn(() => currentState),
      setViewState: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('refresh failed'))
        .mockResolvedValueOnce(undefined)
    };
    (app.workspace as any).getMostRecentLeaf = vi.fn(() => leaf);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect((crop as any).refreshActiveView()).resolves.toBe(true);

    expect(leaf.setViewState).not.toHaveBeenCalled();
  });

  it('ignores a duplicate crop save while one is already running', async () => {
    const { crop, app } = openCropWithImage();
    (crop as any).saving = true;

    await (crop as any).saveImage();

    expect((app.vault as any).modifyBinary).not.toHaveBeenCalled();
  });

  it('does not write when the crop modal closes during canvas export', async () => {
    const { crop, app } = openCropWithImage();
    const opening = crop.onOpen();
    await Promise.resolve();
    const originalImg = crop.contentEl.querySelector('.crop-original-image') as HTMLImageElement;
    originalImg.dispatchEvent(new Event('load'));
    await opening;

    let finishExport: ((blob: Blob | null) => void) | null = null;
    const realToBlob = HTMLCanvasElement.prototype.toBlob;
    const realGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = function(callback) {
      finishExport = callback;
    };
    HTMLCanvasElement.prototype.getContext = function() {
      return {
        drawImage: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        clearRect: () => {}
      } as any;
    };

    try {
      const saving = (crop as any).saveImage();
      await Promise.resolve();
      crop.onClose();
      expect(finishExport).not.toBeNull();
      (finishExport as unknown as (blob: Blob | null) => void)(
        new Blob([makeJpegBytes({ w: 1, h: 1 })], { type: 'image/jpeg' })
      );
      await saving;

      expect((app.vault as any).modifyBinary).not.toHaveBeenCalled();
    } finally {
      HTMLCanvasElement.prototype.toBlob = realToBlob;
      HTMLCanvasElement.prototype.getContext = realGetContext;
    }
  });

  it('21.10 Reset clears current selection and keeps modal open', async () => {
    const { crop } = openCropWithImage();
    // Do not await onOpen; allow image load microtask to resolve
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const cropContainer = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;

    setRect(cropContainer, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    // draw a selection
    originalImg.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mousemove', { clientX: 220, clientY: 160, bubbles: true }));
    cropContainer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const selection = root.querySelector('.selection-area') as HTMLDivElement;
    expect(selection.style.display).toBe('block');

    // trigger reset via Escape key (matches onOpen handler)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // selection cleared (hidden)
    expect(
      selection.style.display === 'none' ||
      selection.style.width === '0' ||
      selection.style.height === '0' ||
      selection.style.width === '' ||
      selection.style.height === ''
    ).toBe(true);
    // modal still present
    expect(root.querySelector('.crop-container')).toBeTruthy();
  });

  it('21.11 Middle mouse pans the image without creating a selection', async () => {
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;
    const selection = root.querySelector('.selection-area') as HTMLDivElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    originalImg.dispatchEvent(new MouseEvent('mousedown', { button: 1, clientX: 100, clientY: 100, bubbles: true, cancelable: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { button: 1, clientX: 130, clientY: 125, bubbles: true, cancelable: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }));

    expect(selection.style.display).toBe('none');
    expect(originalImg.style.transform).toContain('translate(30px, 25px)');
  });

  it('21.12 Right mouse down does not start a crop selection', async () => {
    const { crop } = openCropWithImage();
    crop.onOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const root = (crop as any).contentEl as HTMLElement;
    const container = root.querySelector('.crop-container') as HTMLDivElement;
    const originalImg = root.querySelector('.crop-original-image') as HTMLImageElement;
    const selection = root.querySelector('.selection-area') as HTMLDivElement;

    setRect(container, { left: 0, top: 0, width: 600, height: 400 });
    setRect(originalImg, { left: 0, top: 0, width: 600, height: 400 });

    originalImg.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 100, clientY: 100, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { button: 2, clientX: 220, clientY: 180, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));

    expect(selection.style.display).toBe('none');
    expect(parseInt(selection.style.width || '0', 10)).toBe(0);
    expect(parseInt(selection.style.height || '0', 10)).toBe(0);
  });

  it('closes instead of leaving a modal stuck when image loading times out', async () => {
    vi.useFakeTimers();
    try {
      const { crop } = openCropWithImage();
      const close = vi.spyOn(crop, 'close');

      crop.onOpen();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not close a second time when a pending image load is cancelled by the user', async () => {
    vi.useFakeTimers();
    try {
      const { crop } = openCropWithImage();
      const close = vi.spyOn(crop, 'close');

      crop.onOpen();
      await vi.advanceTimersByTimeAsync(0);
      crop.onClose();
      await Promise.resolve();

      expect(close).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a vault read that completes after the crop modal closes', async () => {
    let resolveRead!: (data: ArrayBuffer) => void;
    const { crop, app } = openCropWithImage();
    (app.vault as any).readBinary = vi.fn(() => new Promise<ArrayBuffer>(resolve => {
      resolveRead = resolve;
    }));

    const opening = crop.onOpen();
    crop.onClose();
    resolveRead(new ArrayBuffer(16));
    await opening;

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect((crop as any).originalImage).toBeFalsy();
  });

  it('does not let a stale first open close a reopened crop modal', async () => {
    let resolveFirstRead!: (data: ArrayBuffer) => void;
    const { crop, app } = openCropWithImage();
    (app.vault as any).readBinary = vi.fn()
      .mockImplementationOnce(() => new Promise<ArrayBuffer>(resolve => {
        resolveFirstRead = resolve;
      }))
      .mockResolvedValueOnce(new ArrayBuffer(16));
    const close = vi.spyOn(crop, 'close');

    const firstOpen = crop.onOpen();
    crop.onClose();
    const secondOpen = crop.onOpen();
    resolveFirstRead(new ArrayBuffer(16));
    await firstOpen;
    await Promise.resolve();
    const secondImage = (crop as any).originalImage as HTMLImageElement;
    secondImage.onload?.(new Event('load'));
    await secondOpen;

    expect(close).not.toHaveBeenCalled();
    expect((crop as any).originalImage).toBeTruthy();
    crop.onClose();
  });
});
