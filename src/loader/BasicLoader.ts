import { EventDispatcher } from '../core/EventDispatcher';
import LoadCache from './LoadCache';
import { getExtension } from '../utils/util';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type BasicResource = HTMLImageElement | ArrayBuffer | JsonValue;
export type BasicResourceType = 'img' | 'json' | 'buffer' | 'text';
export type NetworkResourceType = Exclude<BasicResourceType, 'img'>;
export type ImageCrossOrigin = boolean | '' | 'anonymous' | 'use-credentials';

export interface LoaderRequest {
    src?: string;
    type?: string;
    defaultType?: string;
    crossOrigin?: ImageCrossOrigin;
}

export interface BasicLoadRequest extends LoaderRequest {
    src: string;
}

export interface ResourceRequestOptions {
    url: string;
    type?: NetworkResourceType;
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: BodyInit | null;
    credentials?: RequestCredentials;
    signal?: AbortSignal;
}

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (typeof value !== 'object') return false;
    return Object.keys(value).every(key => isJsonValue(Reflect.get(value, key)));
}

function normalizeResourceType(type: string | undefined): NetworkResourceType {
    if (
        type === BasicLoader.TYPE_JSON ||
        type === BasicLoader.TYPE_BUFFER ||
        type === BasicLoader.TYPE_TEXT
    ) {
        return type;
    }
    return BasicLoader.TYPE_TEXT;
}

const cache = new LoadCache<BasicResource | Error>();
const utf8Decoder = new TextDecoder();

/** Browser resource loader for images, text, JSON and binary data. */
class BasicLoader extends EventDispatcher {
    static readonly TYPE_IMAGE = 'img';
    static readonly TYPE_JSON = 'json';
    static readonly TYPE_BUFFER = 'buffer';
    static readonly TYPE_TEXT = 'text';

    static readonly cache = cache;

    static enableCache(): void {
        cache.enabled = true;
    }

    static disableCache(): void {
        cache.enabled = false;
    }

    static deleteCache(key: string): void {
        cache.remove(key);
    }

    static clearCache(): void {
        cache.clear();
    }

    readonly isBasicLoader = true;
    readonly className: string = 'BasicLoader';

    async load(data: BasicLoadRequest): Promise<BasicResource> {
        const { src } = data;
        let type = data.type;
        if (!type) {
            const extension = getExtension(src);
            if (extension && /^(?:png|jpe?g|gif|webp|bmp)$/iu.test(extension)) {
                type = BasicLoader.TYPE_IMAGE;
            } else {
                type = data.defaultType;
            }
        }
        return type === BasicLoader.TYPE_IMAGE
            ? this.loadImg(src, data.crossOrigin)
            : this.loadRes(src, type);
    }

    isCrossOrigin(url: string): boolean {
        const resource = new URL(url, window.location.href);
        return resource.origin !== window.location.origin;
    }

    isBase64(url: string): boolean {
        return /^data:(.+?);base64,/u.test(url);
    }

    async loadImg(url: string, crossOrigin: ImageCrossOrigin = false): Promise<HTMLImageElement> {
        const cached = cache.get(url);
        if (cached) {
            const value = await cache.wait(cached);
            if (value instanceof HTMLImageElement) return value;
            if (value instanceof Error) throw value;
            throw new TypeError(`Cached resource ${url} is not an image.`);
        }

        return new Promise((resolve, reject) => {
            const image = new Image();
            cache.update(url, LoadCache.PENDING);
            const clearHandlers = (): void => {
                image.onerror = null;
                image.onabort = null;
                image.onload = null;
            };
            image.onload = () => {
                clearHandlers();
                cache.update(url, LoadCache.LOADED, image);
                resolve(image);
            };
            image.onerror = () => {
                clearHandlers();
                const error = new Error(`Image load failed for ${url.slice(0, 100)}`);
                cache.update(url, LoadCache.FAILED, error);
                cache.remove(url);
                reject(error);
            };
            image.onabort = image.onerror;
            if (!this.isBase64(url)) {
                if (typeof crossOrigin === 'string') {
                    image.crossOrigin = crossOrigin;
                } else if (crossOrigin || this.isCrossOrigin(url)) {
                    image.crossOrigin = 'anonymous';
                }
            }
            image.src = url;
        });
    }

    async loadRes(url: string, type?: string): Promise<JsonValue | ArrayBuffer> {
        const base64Match = /^data:(.+?);base64,(.*)$/u.exec(url);
        if (base64Match) {
            const encoded = base64Match[2];
            if (encoded === undefined) throw new TypeError('Malformed base64 resource URL.');
            const decoded = atob(encoded);
            if (type === BasicLoader.TYPE_JSON) {
                const parsed: unknown = JSON.parse(decoded);
                if (!isJsonValue(parsed))
                    throw new TypeError('JSON resource contains unsupported values.');
                return parsed;
            }
            if (type === BasicLoader.TYPE_BUFFER) {
                return Uint8Array.from(decoded, character => character.charCodeAt(0)).buffer;
            }
            return decoded;
        }

        const cached = cache.get(url);
        if (cached) {
            const value = await cache.wait(cached);
            if (value instanceof Error) throw value;
            if (value instanceof HTMLImageElement) {
                throw new TypeError(`Cached resource ${url} is an image, not ${type ?? 'text'}.`);
            }
            return value;
        }

        cache.update(url, LoadCache.PENDING);
        this.fire('beforeload', { url, type });

        try {
            const data = await this.request({
                url,
                type: normalizeResourceType(type)
            });
            this.fire('loaded', { url, type });
            cache.update(url, LoadCache.LOADED, data);
            return data;
        } catch (error: unknown) {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.fire('failed', failure);
            cache.update(url, LoadCache.FAILED, failure);
            cache.remove(url);
            throw new Error(`Resource load failed for ${url}.`, { cause: error });
        }
    }

    private async readResponse(response: Response, url: string): Promise<Uint8Array> {
        const reader = response.body?.getReader();
        if (!reader) return new Uint8Array(await response.arrayBuffer());

        const chunks: Uint8Array[] = [];
        let loaded = 0;
        const totalHeader = response.headers.get('content-length');
        const total = totalHeader === null ? 0 : Number.parseInt(totalHeader, 10);

        let result = await reader.read();
        while (!result.done) {
            chunks.push(result.value);
            loaded += result.value.byteLength;
            this.fire('progress', { url, loaded, total });
            result = await reader.read();
        }

        const bytes = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return bytes;
    }

    async request(options: ResourceRequestOptions): Promise<JsonValue | ArrayBuffer> {
        const init: RequestInit = {
            method: options.method ?? 'GET',
            credentials: options.credentials ?? 'same-origin',
            ...(options.headers ? { headers: options.headers } : {}),
            ...(options.body !== undefined && options.body !== null ? { body: options.body } : {}),
            ...(options.signal ? { signal: options.signal } : {})
        };
        const response = await fetch(options.url, init);
        if (!response.ok) {
            throw new TypeError(`Network request failed with status ${String(response.status)}.`);
        }

        const bytes = await this.readResponse(response, options.url);
        if (options.type === BasicLoader.TYPE_BUFFER) return Uint8Array.from(bytes).buffer;

        const text = utf8Decoder.decode(bytes);
        if (options.type !== BasicLoader.TYPE_JSON) return text;

        try {
            const parsed: unknown = JSON.parse(text);
            if (!isJsonValue(parsed)) throw new TypeError('JSON contains unsupported values.');
            return parsed;
        } catch (error: unknown) {
            throw new TypeError('Failed to parse JSON response.', { cause: error });
        }
    }
}

export { isJsonValue };
export default BasicLoader;
