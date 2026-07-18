import { EventDispatcher } from '../core/EventDispatcher';

export const LoadState = {
    PENDING: 1,
    LOADED: 2,
    FAILED: 3
} as const;

export type LoadStateValue = (typeof LoadState)[keyof typeof LoadState];

export interface LoadCacheFile<Data = unknown> {
    key: string;
    state: LoadStateValue;
    data: Data | undefined;
}

/** Shared resource cache with event-backed pending request coordination. */
class LoadCache<Data = unknown> extends EventDispatcher {
    static readonly PENDING = LoadState.PENDING;
    static readonly LOADED = LoadState.LOADED;
    static readonly FAILED = LoadState.FAILED;

    readonly isLoadCache = true;
    readonly className = 'LoadCache';
    enabled = true;
    private readonly files = new Map<string, LoadCacheFile<Data>>();

    private failure(reason: Data | undefined, key: string): Error {
        if (reason instanceof Error) return reason;
        return new Error(`Resource ${key} failed to load.`, { cause: reason });
    }

    update(key: string, state: LoadStateValue, data?: Data): void {
        if (!this.enabled) return;
        const file: LoadCacheFile<Data> = { key, state, data };
        this.files.set(key, file);
        this.fire('update', file);
        this.fire(`update:${key}`, file);
    }

    get(key: string): LoadCacheFile<Data> | null {
        if (!this.enabled) return null;
        return this.files.get(key) ?? null;
    }

    getLoaded(key: string): Data | null {
        const file = this.get(key);
        return file?.state === LoadCache.LOADED && file.data !== undefined ? file.data : null;
    }

    remove(key: string): void {
        this.files.delete(key);
    }

    clear(): void {
        this.files.clear();
    }

    wait(file: LoadCacheFile<Data> | null): Promise<Data> {
        if (!file) return Promise.reject(new Error('Cannot wait for a missing cache entry.'));
        if (file.state === LoadCache.LOADED) {
            return file.data === undefined
                ? Promise.reject(new Error(`Loaded cache entry ${file.key} has no data.`))
                : Promise.resolve(file.data);
        }
        if (file.state === LoadCache.FAILED) {
            return Promise.reject(this.failure(file.data, file.key));
        }

        return new Promise((resolve, reject) => {
            this.on(
                `update:${file.key}`,
                () => {
                    const updated = this.files.get(file.key);
                    if (updated?.state === LoadCache.LOADED) {
                        if (updated.data === undefined) {
                            reject(new Error(`Loaded cache entry ${file.key} has no data.`));
                        } else {
                            resolve(updated.data);
                        }
                    } else if (updated?.state === LoadCache.FAILED) {
                        reject(this.failure(updated.data, file.key));
                    }
                },
                true
            );
        });
    }
}

export default LoadCache;
