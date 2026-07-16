import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessingHandler } from '../../../../src/ui/contextMenu/handlers/ProcessingHandler';
import { ProcessSingleImageModal } from '../../../../src/ui/modals/ProcessSingleImageModal';
import { Crop } from '../../../../src/ui/Crop';
import { ImageAnnotationModal } from '../../../../src/ui/ImageAnnotation';
import { fakeApp, fakeTFile, fakeVault, fakeWorkspace } from '../../../factories/obsidian';

describe('ProcessingHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeFixture() {
    const note = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
    const wrongDuplicate = fakeTFile({ path: 'other/pic.png', name: 'pic.png', extension: 'png' });
    const resolvedImage = fakeTFile({ path: 'assets/pic.png', name: 'pic.png', extension: 'png' });
    const app = fakeApp({
      vault: fakeVault({ files: [note, wrongDuplicate, resolvedImage] }),
      workspace: fakeWorkspace({
        activeFile: note,
        activeView: {
          file: note,
          getViewType: () => 'markdown',
          contentEl: document.body,
          containerEl: document.body,
          editor: {}
        }
      })
    }) as any;
    const folderManagement = {
      getImagePath: vi.fn(() => resolvedImage.path)
    };
    const plugin = {
      settings: { operationDefaults: {} },
      getDefaultSingleImageOperationSettings: vi.fn(() => ({
        outputFormat: 'NONE', quality: 0.8, colorDepth: 1, resizeMode: 'None',
        desiredWidth: 0, desiredHeight: 0, desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto', allowLargerFiles: true
      }))
    } as any;
    const handler = new ProcessingHandler(app, plugin, folderManagement as any);
    const img = document.createElement('img');
    img.setAttribute('src', 'app://local/pic.png');

    return { app, folderManagement, handler, img, resolvedImage };
  }

  it('resolves the image by exact vault path instead of the first duplicate filename', () => {
    const { app, folderManagement, handler, img, resolvedImage } = makeFixture();
    const getFilesSpy = vi.spyOn(app.vault, 'getFiles');

    const result = (handler as any).resolveLocalImageFile(img);

    expect(folderManagement.getImagePath).toHaveBeenCalledWith(img);
    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(resolvedImage.path);
    expect(getFilesSpy).not.toHaveBeenCalled();
    expect(result).toBe(resolvedImage);
  });

  it('does not resolve network images for local processing actions', () => {
    const { folderManagement, handler, img } = makeFixture();
    folderManagement.getImagePath.mockReturnValue('https://example.com/pic.png');

    expect((handler as any).resolveLocalImageFile(img)).toBeNull();
  });

  it('returns null when the resolved vault path no longer exists', () => {
    const { folderManagement, handler, img } = makeFixture();
    folderManagement.getImagePath.mockReturnValue('missing/pic.png');

    expect((handler as any).resolveLocalImageFile(img)).toBeNull();
  });

  it('only exposes in-place editors for formats with verified canvas encoders', () => {
    const { handler, img, resolvedImage } = makeFixture();

    expect(handler.canEditImage(img)).toBe(true);
    (resolvedImage as any).extension = 'gif';
    expect(handler.canEditImage(img)).toBe(false);
    (resolvedImage as any).extension = 'tiff';
    expect(handler.canEditImage(img)).toBe(false);
    (resolvedImage as any).extension = 'webp';
    expect(handler.canEditImage(img)).toBe(true);
  });

  it('opens image tools even when another non-Markdown leaf is active', async () => {
    const { app, handler, img, resolvedImage } = makeFixture();
    app.workspace.getActiveViewOfType = vi.fn(() => null);
    const processOpen = vi.spyOn(ProcessSingleImageModal.prototype, 'open');
    const cropOpen = vi.spyOn(Crop.prototype, 'open');
    const annotationOpen = vi.spyOn(ImageAnnotationModal.prototype, 'open');

    await handler.processImage(img);
    await handler.cropRotateFlip(img);
    await handler.annotateImage(img);

    expect(processOpen).toHaveBeenCalledOnce();
    expect(cropOpen).toHaveBeenCalledOnce();
    expect(annotationOpen).toHaveBeenCalledOnce();
    expect((processOpen.mock.instances[0] as any).imageFile).toBe(resolvedImage);
    expect((cropOpen.mock.instances[0] as any).imageFile).toBe(resolvedImage);
    expect((annotationOpen.mock.instances[0] as any).file).toBe(resolvedImage);
  });
});
