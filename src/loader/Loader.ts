import BasicLoader, { type LoaderRequest } from './BasicLoader';
import { getExtension } from '../utils/util';

type RegistryLoadMethod = {
    load(data: LoaderRequest): Promise<unknown>;
}['load'];

export interface ResourceLoader {
    load: RegistryLoadMethod;
}

export type ResourceLoaderConstructor = new () => ResourceLoader;

function isRequestList(
    data: LoaderRequest | readonly LoaderRequest[]
): data is readonly LoaderRequest[] {
    return Array.isArray(data);
}

function normalizeExtension(extension: string): string {
    const normalized = extension.trim().replace(/^\./u, '').toLowerCase();
    if (!normalized) throw new TypeError('Loader extension must not be empty.');
    return normalized;
}

/** Extension-based loader registry and dispatch facade. */
class Loader {
    private static readonly loaderClasses = new Map<string, ResourceLoaderConstructor>();
    private static readonly loaders = new Map<string, ResourceLoader>();

    static addLoader(extension: string, LoaderClass: ResourceLoaderConstructor): void {
        const normalized = normalizeExtension(extension);
        this.loaderClasses.set(normalized, LoaderClass);
        this.loaders.delete(normalized);
    }

    static getLoader(extension: string): ResourceLoader {
        const normalized = normalizeExtension(extension);
        const existing = this.loaders.get(normalized);
        if (existing) return existing;

        const LoaderClass = this.loaderClasses.get(normalized) ?? BasicLoader;
        const loader = new LoaderClass();
        this.loaders.set(normalized, loader);
        return loader;
    }

    readonly isLoader = true;
    readonly className = 'Loader';
    preHandlerUrl: ((url: string) => string) | null = null;

    load(data: LoaderRequest): Promise<unknown>;
    load(data: readonly LoaderRequest[]): Promise<unknown[]>;
    load(data: LoaderRequest | readonly LoaderRequest[]): Promise<unknown> | Promise<unknown[]> {
        if (isRequestList(data)) return Promise.all(data.map(item => this.load(item)));

        const extension =
            data.type ?? (data.src ? (getExtension(data.src) ?? BasicLoader.TYPE_TEXT) : null);
        if (!extension) {
            throw new TypeError('Loader requests require either a resource type or source URL.');
        }
        const loader = Loader.getLoader(extension);
        const loadData: LoaderRequest =
            this.preHandlerUrl && data.src ? { ...data, src: this.preHandlerUrl(data.src) } : data;
        return loader.load(loadData);
    }
}

export default Loader;
