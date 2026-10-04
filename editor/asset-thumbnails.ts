import { assetDecodedImageBytes, assetURL, validateAsset, type ProjectAsset } from './assets';

export interface AssetThumbnailOptions {
    maxEntries?: number;
    maxBytes?: number;
}
export interface AssetThumbnailLease {
    readonly url: string;
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
    release(): void;
}
interface ThumbnailEntry {
    key: string;
    url: string;
    width: number;
    height: number;
    bytes: number;
    users: number;
}
const MAX_ENTRIES = 64;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_EDGE = 256;
// All cache instances share the queue: simultaneous panel replacements cannot run decoders in parallel.
let thumbnailQueue: Promise<void> = Promise.resolve();

function stopped(): Error {
    return new DOMException('Thumbnail request canceled', 'AbortError');
}
function capacity(value: number | undefined, maximum: number, name: string): number {
    if (value === undefined) return maximum;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new Error(`${name} must be a positive integer at most ${String(maximum)}`);
    return value;
}

/** Bounded derivative images. Original full-resolution URLs are never returned to thumbnail cards. */
export class AssetThumbnailCache {
    private readonly entries = new Map<string, ThumbnailEntry>();
    private readonly sources = new Set<string>();
    private readonly maxEntries: number;
    private readonly maxBytes: number;
    private bytes = 0;
    private destroyed = false;

    constructor(options: AssetThumbnailOptions = {}) {
        this.maxEntries = capacity(options.maxEntries, MAX_ENTRIES, 'maxEntries');
        this.maxBytes = capacity(options.maxBytes, MAX_BYTES, 'maxBytes');
    }
    get memoryUsage(): { entries: number; bytes: number; pinned: number } {
        return {
            entries: this.entries.size,
            bytes: this.bytes,
            pinned: [...this.entries.values()].filter(entry => entry.users > 0).length
        };
    }

    async acquire(source: ProjectAsset, signal?: AbortSignal): Promise<AssetThumbnailLease> {
        this.assertActive(signal);
        const asset = validateAsset(source);
        if (asset.kind !== 'texture') throw new Error('Only texture assets have image thumbnails');
        const key = `${asset.mimeType}:${asset.hash}`;
        const cached = this.entries.get(key);
        if (cached) return this.lease(cached);
        const operation = thumbnailQueue.then(async () => {
            this.assertActive(signal);
            const existing = this.entries.get(key);
            if (existing) return this.lease(existing);
            const derivative = await this.generate(asset, signal);
            this.assertActive(signal);
            this.makeRoom(derivative.blob.size);
            const entry: ThumbnailEntry = {
                key,
                url: URL.createObjectURL(derivative.blob),
                width: derivative.width,
                height: derivative.height,
                bytes: derivative.blob.size,
                users: 0
            };
            this.entries.set(key, entry);
            this.bytes += entry.bytes;
            return this.lease(entry);
        });
        thumbnailQueue = operation.then(
            () => undefined,
            () => undefined
        );
        return operation;
    }

    destroy(): void {
        this.destroyed = true;
        for (const entry of this.entries.values()) URL.revokeObjectURL(entry.url);
        this.entries.clear();
        this.bytes = 0;
        for (const url of this.sources) URL.revokeObjectURL(url);
        this.sources.clear();
    }
    private assertActive(signal?: AbortSignal): void {
        if (this.destroyed || signal?.aborted) throw stopped();
    }
    private lease(entry: ThumbnailEntry): AssetThumbnailLease {
        this.entries.delete(entry.key);
        this.entries.set(entry.key, entry);
        entry.users += 1;
        let released = false;
        return {
            url: entry.url,
            width: entry.width,
            height: entry.height,
            bytes: entry.bytes,
            release: () => {
                if (!released) {
                    released = true;
                    entry.users -= 1;
                }
            }
        };
    }
    private makeRoom(additional: number): void {
        if (additional > this.maxBytes)
            throw new Error('Thumbnail exceeds the derivative image budget');
        while (this.entries.size >= this.maxEntries || this.bytes + additional > this.maxBytes) {
            const oldest = [...this.entries.values()].find(entry => entry.users === 0);
            if (!oldest)
                throw new Error(
                    'Thumbnail preview capacity is busy. Try again after other previews load.'
                );
            this.entries.delete(oldest.key);
            this.bytes -= oldest.bytes;
            URL.revokeObjectURL(oldest.url);
        }
    }
    private async generate(
        asset: ProjectAsset,
        signal?: AbortSignal
    ): Promise<{ blob: Blob; width: number; height: number }> {
        const sourceBytes = assetDecodedImageBytes(asset);
        if (sourceBytes > 64 * 1024 * 1024)
            throw new Error('Source thumbnail image exceeds 16,777,216 pixels');
        const sourceURL = assetURL(asset);
        this.sources.add(sourceURL);
        let bitmap: ImageBitmap | null = null;
        const canvas = document.createElement('canvas');
        try {
            const response = await fetch(sourceURL, signal ? { signal } : {});
            const blob = await response.blob();
            this.assertActive(signal);
            bitmap = await createImageBitmap(blob);
            this.assertActive(signal);
            if (
                bitmap.width < 1 ||
                bitmap.height < 1 ||
                bitmap.width > 8192 ||
                bitmap.height > 8192 ||
                bitmap.width * bitmap.height * 4 !== sourceBytes
            )
                throw new Error(`Invalid decoded dimensions for ${asset.name}`);
            const scale = Math.min(1, MAX_EDGE / bitmap.width, MAX_EDGE / bitmap.height);
            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Thumbnail canvas is unavailable');
            context.imageSmoothingQuality = 'high';
            context.drawImage(bitmap, 0, 0, width, height);
            bitmap.close();
            bitmap = null;
            const output = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(value => {
                    if (value) resolve(value);
                    else reject(new Error('Thumbnail image could not be encoded'));
                }, 'image/png');
            });
            this.assertActive(signal);
            return { blob: output, width, height };
        } finally {
            bitmap?.close();
            canvas.width = 0;
            canvas.height = 0;
            URL.revokeObjectURL(sourceURL);
            this.sources.delete(sourceURL);
        }
    }
}
