import { describe, expect, it } from 'vitest';
import { CloudLinkFormatter } from '../../../src/cloud/CloudLinkFormatter';
import type { CloudUploadSettings } from '../../../src/settings/types';

function settings(overrides: Partial<CloudUploadSettings> = {}): CloudUploadSettings {
    return {
        uploader: 'PicGo',
        uploadServer: '',
        deleteServer: '',
        picgoCorePath: '',
        remoteServerMode: false,
        imageSizeWidth: undefined,
        imageSizeHeight: undefined,
        imageSizeSource: 'settings',
        workOnNetWork: false,
        newWorkBlackDomains: '',
        applyImage: true,
        cloudLinkFormat: 'markdown',
        ...overrides
    };
}

describe('CloudLinkFormatter canonical sizes', () => {
    it('generates a normal empty-alt Markdown image', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/image.png',
            settings()
        )).toBe('![](https://example.com/image.png)');
    });

    it('extracts uploader Markdown and safely angle-wraps spaces or parentheses', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            '![uploaded](https://example.com/image(1).png "title")',
            settings()
        )).toBe('![](<https://example.com/image(1).png>)');
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/image with space.png',
            settings()
        )).toBe('![](<https://example.com/image with space.png>)');
    });

    it('writes W without an empty leading pipe token', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/image.png',
            settings({ imageSizeWidth: 500 })
        )).toBe('![500](https://example.com/image.png)');
    });

    it('writes explicit WxH when both settings are available', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/image.png',
            settings({ imageSizeWidth: 800, imageSizeHeight: 600 })
        )).toBe('![800x600](https://example.com/image.png)');
    });

    it('safely omits a remote height-only setting because no ratio is available', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/image.png',
            settings({ imageSizeHeight: 400 })
        )).toBe('![](https://example.com/image.png)');
    });

    it('does not write configured dimensions in actual-size mode', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/image.png',
            settings({
                imageSizeSource: 'actual',
                imageSizeWidth: 800,
                imageSizeHeight: 600
            })
        )).toBe('![](https://example.com/image.png)');
    });

    it('writes decoded actual dimensions supplied by the upload handler', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/image.png',
            settings({ imageSizeSource: 'actual' }),
            undefined,
            { width: 800, height: 600, format: 'WxH' }
        )).toBe('![800x600](https://example.com/image.png)');
    });

    it('writes a proportional width resolved from a height-only intent', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/image.png',
            settings({ imageSizeHeight: 300 }),
            undefined,
            { width: 400, format: 'W' }
        )).toBe('![400](https://example.com/image.png)');
    });

    it('preserves canonical caption, alignment, and existing size', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/new.png',
            settings({ imageSizeWidth: 800 }),
            '![Caption|right|300x200](old.png)'
        )).toBe('![Caption|right|300x200](https://example.com/new.png)');
    });

    it('does not interpret xH, Wx, or non-tail sizes', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/new.png',
            settings(),
            '![Caption|x200](old.png)'
        )).toBe('![Caption|x200](https://example.com/new.png)');
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/new.png',
            settings(),
            '![Caption|300x](old.png)'
        )).toBe('![Caption|300x](https://example.com/new.png)');
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/new.png',
            settings(),
            '![Caption|300|right](old.png)'
        )).toBe('![Caption|300|right](https://example.com/new.png)');
    });

    it('uses the same canonical attributes for Wiki output', () => {
        expect(CloudLinkFormatter.formatCloudLink(
            'https://example.com/image.png',
            settings({ cloudLinkFormat: 'wikilink', imageSizeWidth: 500 })
        )).toBe('![[https://example.com/image.png|500]]');
    });

    it('formats batches consistently', () => {
        expect(CloudLinkFormatter.formatCloudLinks([
            'https://example.com/1.png',
            'https://example.com/2.png'
        ], settings())).toEqual([
            '![](https://example.com/1.png)',
            '![](https://example.com/2.png)'
        ]);
    });
});
