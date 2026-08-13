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
