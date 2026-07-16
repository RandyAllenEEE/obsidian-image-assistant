import { describe, expect, it, vi } from 'vitest';
import { renderAlignmentSettingsSection } from '../../../src/settings/sections/AlignmentSettingsSection';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';

function getSetting(container: HTMLElement, name: string): HTMLElement {
  const setting = Array.from(container.querySelectorAll<HTMLElement>('[data-setting-name]'))
    .find(element => element.getAttribute('data-setting-name') === name);
  if (!setting) throw new Error(`Setting not found: ${name}`);
  return setting;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function renderSection() {
  const plugin = {
    settings: { alignment: structuredClone(DEFAULT_SETTINGS.alignment) },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    applyEditModeWrapClass: vi.fn(),
    imageStateManager: { refreshAllImages: vi.fn() },
    imageCaption: { refreshAllViews: vi.fn() }
  } as any;
  const container = document.createElement('div');
  renderAlignmentSettingsSection(
    container,
    plugin,
    { imageAlignmentSectionCollapsed: false } as any,
    vi.fn()
  );
  return { container, plugin };
}

describe('AlignmentSettingsSection', () => {
  it('refreshes both image layout and captions when the default changes', async () => {
    const { container, plugin } = renderSection();
    const dropdown = getSetting(container, 'Default Alignment').querySelector('select') as HTMLSelectElement;

    dropdown.value = 'right';
    dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(plugin.settings.alignment.default).toBe('right');
    expect(plugin.imageStateManager.refreshAllImages).toHaveBeenCalledOnce();
    expect(plugin.imageCaption.refreshAllViews).toHaveBeenCalledOnce();
  });

  it('applies the edit-mode wrap class through the supplied plugin instance', async () => {
    const { container, plugin } = renderSection();
    const toggle = getSetting(container, 'Enable Text Wrap in Edit Mode')
      .querySelector('input[type="checkbox"]') as HTMLInputElement;

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(plugin.settings.alignment.enableEditModeWrap).toBe(true);
    expect(plugin.applyEditModeWrapClass).toHaveBeenCalledOnce();
    expect(plugin.imageStateManager.refreshAllImages).toHaveBeenCalledOnce();
    expect(plugin.imageCaption.refreshAllViews).toHaveBeenCalledOnce();
  });
});
