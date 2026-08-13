import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'styles.css'), 'utf8');

describe('image layout stylesheet', () => {
  it('positions only the semantic layout owner in Live Preview', () => {
    expect(styles).toContain(
      '.markdown-source-view [data-image-assistant-layout-owner="true"][data-image-assistant-layout-positioned="true"]'
    );
    expect(styles).not.toContain(
      '.markdown-source-view [data-image-assistant-layout-positioned="true"] {'
    );
  });

  it('does not size or position an external renderer descendant placement', () => {
    expect(styles).not.toMatch(
      /external-renderer[^{}]*\s+\[data-image-assistant-layout-placement="true"\]/u
    );
    expect(styles).not.toMatch(
      /external-renderer[^{}]*\{[^}]*inline-size:\s*fit-content/gu
    );
  });

  it('keeps semantic caption fallback until measured geometry is available', () => {
    for (const placement of ['left', 'center', 'right']) {
      expect(styles).toContain(
        `:not([data-image-assistant-caption-positioned="true"])[data-image-assistant-caption-placement="${placement}"]`
      );
    }
  });
});
