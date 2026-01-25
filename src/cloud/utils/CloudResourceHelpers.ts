import path from "path-browserify";
import ImageConverterPlugin from "../../main";

export class CloudResourceHelpers {
    constructor(private plugin: ImageConverterPlugin) { }

    /**
     * Checks if a URL domain is in the blacklist
     */
    public isBlacklistedDomain(url: string): boolean {
        try {
            const blacklist = this.plugin.settings.pasteHandling.cloud.newWorkBlackDomains;
            if (!blacklist || blacklist.trim() === '') return false;

            const domains = blacklist.split(',').map(d => d.trim().toLowerCase()).filter(d => d.length > 0);
            if (domains.length === 0) return false;

            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            return domains.some(domain => hostname === domain || hostname.endsWith('.' + domain));
        } catch (error) {
            return false;
        }
    }

    /**
     * Checks if a file path has a supported image extension
     */
    public isImageFile(filePath: string): boolean {
        // Use path.extname from path-browserify
        const ext = path.extname(filePath).toLowerCase();
        const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.svg', '.tiff', '.webp', '.avif'];
        return imageExts.includes(ext);
    }
}
