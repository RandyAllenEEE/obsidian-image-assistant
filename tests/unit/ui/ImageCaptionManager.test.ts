import { ImageCaptionManager } from '../../../src/ui/ImageCaptionManager';
import { RefinedImageUtils } from '../../../src/utils/RefinedImageUtils';
import { pipeSyntaxParser } from '../../../src/utils/PipeSyntaxParser';
import ImageConverterPlugin from '../../../src/main';
import { App, TFile } from 'obsidian';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../../src/utils/RefinedImageUtils');
vi.mock('../../../src/main');

describe('ImageCaptionManager', () => {
    let mockPlugin: any;
    let mockApp: any;
    let manager: ImageCaptionManager;
    let mockRefinedImageUtils: any;

    beforeEach(() => {
        mockApp = {
            workspace: {
                getActiveFile: vi.fn(),
                getActiveViewOfType: vi.fn(),
            }
        };

        mockPlugin = {
            app: mockApp,
            settings: {
                enableImageCaptions: true,
                skipCaptionExtensions: 'png, jpg', // Example exclusion
            }
        };

        // Mock RefinedImageUtils instance
        mockRefinedImageUtils = {
            getImageLinkText: vi.fn()
        };
        (RefinedImageUtils as any).mockImplementation(() => mockRefinedImageUtils);

        manager = new ImageCaptionManager(mockPlugin);
        // Manually allow private method access for testing
        (manager as any).refinedImageUtils = mockRefinedImageUtils;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should set alt to space if caption is missing/empty', () => {
        const embed = document.createElement('div');
        embed.setAttribute('src', 'test.webp');
        const img = document.createElement('img');
        img.setAttribute('src', 'test.webp');
        // No alt attribute
        embed.appendChild(img);

        mockPlugin.settings.skipCaptionExtensions = ''; // Don't skip webp
        mockApp.workspace.getActiveFile.mockReturnValue({ path: 'note.md' } as TFile);
        mockRefinedImageUtils.getImageLinkText.mockReturnValue('![[test.webp]]'); // No alt in link

        (manager as any).processImageEmbed(embed);

        expect(embed.getAttribute('alt')).toBe(' ');
        expect(img.getAttribute('alt')).toBe(' ');
    });

    it('should set alt to space if caption matches filename', () => {
        const embed = document.createElement('div');
        embed.setAttribute('src', 'test.webp');
        const img = document.createElement('img');
        img.setAttribute('src', 'test.webp');
        img.setAttribute('alt', 'test.webp'); // Matches filename
        embed.appendChild(img);

        mockPlugin.settings.skipCaptionExtensions = '';
        mockApp.workspace.getActiveFile.mockReturnValue(null); // Simulate reading mode or no active file

        (manager as any).processImageEmbed(embed);

        expect(embed.getAttribute('alt')).toBe(' ');
        expect(img.getAttribute('alt')).toBe(' ');
    });

    it('should use refined caption from pipe syntax', () => {
        const embed = document.createElement('div');
        embed.setAttribute('src', 'test.webp');
        const img = document.createElement('img');
        img.setAttribute('src', 'test.webp');
        img.setAttribute('alt', 'test.webp'); // DOM might have filename
        embed.appendChild(img);

        mockPlugin.settings.skipCaptionExtensions = '';
        mockApp.workspace.getActiveFile.mockReturnValue({ path: 'note.md' } as TFile);

        // Mock finding a link with a caption
        mockRefinedImageUtils.getImageLinkText.mockReturnValue('![[test.webp|My Custom Caption]]');

        (manager as any).processImageEmbed(embed);

        expect(embed.getAttribute('alt')).toBe('My Custom Caption');
        expect(img.getAttribute('alt')).toBe('My Custom Caption');
    });

    it('should clean up size/align from caption using PipeSyntaxParser', () => {
        const embed = document.createElement('div');
        embed.setAttribute('src', 'test.webp');
        const img = document.createElement('img');
        img.setAttribute('src', 'test.webp');
        embed.appendChild(img);

        mockPlugin.settings.skipCaptionExtensions = '';
        mockApp.workspace.getActiveFile.mockReturnValue({ path: 'note.md' } as TFile);

        // Mock link with size and align
        mockRefinedImageUtils.getImageLinkText.mockReturnValue('![[test.webp|right|200x200|My Caption]]');

        (manager as any).processImageEmbed(embed);

        // PipeSyntaxParser should have parsed "My Caption" as the alt
        expect(embed.getAttribute('alt')).toBe('My Caption');
        expect(img.getAttribute('alt')).toBe('My Caption');
    });

    it('should handle excluded extensions', () => {
        const embed = document.createElement('div');
        embed.setAttribute('src', 'test.png');
        const img = document.createElement('img');
        img.setAttribute('src', 'test.png'); // Excluded
        img.setAttribute('alt', 'Caption');
        embed.appendChild(img);

        mockPlugin.settings.skipCaptionExtensions = 'png';

        (manager as any).processImageEmbed(embed);

        expect(embed.hasAttribute('alt')).toBe(false);
        expect(img.hasAttribute('alt')).toBe(false);
    });

    it('should handle Admonitions (Callouts)', () => {
        const embed = document.createElement('div');
        embed.setAttribute('src', 'test.webp'); // Src required for correct exclusion check
        const img = document.createElement('img');
        img.setAttribute('src', 'test.webp');
        embed.appendChild(img);

        mockPlugin.settings.skipCaptionExtensions = '';
        mockApp.workspace.getActiveFile.mockReturnValue(null);

        // Missing alt -> should be space
        (manager as any).processImageEmbed(embed, true); // isInCallout = true

        expect(embed.getAttribute('data-in-callout')).toBe('true');
        expect(embed.getAttribute('alt')).toBe(' ');
    });
});
