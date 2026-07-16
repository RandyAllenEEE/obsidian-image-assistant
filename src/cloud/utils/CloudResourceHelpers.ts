import path from "path-browserify";
import ImageConverterPlugin from "../../main";
import { isDomainBlacklisted } from "../../utils/NetworkPolicy";

export class CloudResourceHelpers {
    constructor(private plugin: ImageConverterPlugin) { }

    /**
     * Checks if a URL domain is in the blacklist
     */
    public isBlacklistedDomain(url: string): boolean {
        return isDomainBlacklisted(
            url,
            this.plugin.settings.pasteHandling.cloud.newWorkBlackDomains
        );
    }

    /**
     * Checks if a file path has a supported image extension
     */
    public isImageFile(filePath: string): boolean {
        // Use path.extname from path-browserify
        const ext = path.extname(filePath).toLowerCase();
        const imageExts = [
            '.png', '.jpg', '.jpeg', '.bmp', '.gif', '.svg', '.tif', '.tiff',
            '.webp', '.avif', '.heic', '.heif', '.ico'
        ];
        return imageExts.includes(ext);
    }
}
