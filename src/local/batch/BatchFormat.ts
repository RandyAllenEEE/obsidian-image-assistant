export type BatchOutputFormat = 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL';

export function toBatchOutputFormat(convertTo: string): BatchOutputFormat {
    switch ((convertTo || '').toLowerCase()) {
        case 'webp':
            return 'WEBP';
        case 'jpg':
        case 'jpeg':
            return 'JPEG';
        case 'png':
            return 'PNG';
        case 'disabled':
        case 'original':
        default:
            return 'ORIGINAL';
    }
}

export function getOutputExtension(sourceExtension: string, outputFormat: BatchOutputFormat): string {
    if (outputFormat === 'ORIGINAL') {
        return sourceExtension;
    }
    if (outputFormat === 'JPEG') {
        return 'jpg';
    }
    return outputFormat.toLowerCase();
}
