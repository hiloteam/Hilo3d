import { EventDispatcher } from '../core/EventMixin';
import Loader from './Loader';
import type { LoaderRequest } from './BasicLoader';

export type LoadQueueItem<Request extends LoaderRequest = LoaderRequest> = Request & {
    id?: string;
    size?: number;
    loaded?: boolean;
    content?: unknown;
    error?: unknown;
};

export type LoadQueueSource<Request extends LoaderRequest = LoaderRequest> =
    LoadQueueItem<Request> | readonly LoadQueueItem<Request>[];

function isLoadQueueItemList<Request extends LoaderRequest>(
    source: LoadQueueSource<Request>
): source is readonly LoadQueueItem<Request>[] {
    return Array.isArray(source);
}

/** Concurrent resource queue with typed progress and completion state. */
class LoadQueue<Request extends LoaderRequest = LoaderRequest> extends EventDispatcher {
    readonly isLoadQueue = true;
    readonly className = 'LoadQueue';
    private maxConnectionCount = 2;
    private readonly source: LoadQueueItem<Request>[] = [];
    private loadedCount = 0;
    private connections = 0;
    private currentIndex = -1;
    private loader: Loader | null = null;

    constructor(source?: LoadQueueSource<Request>) {
        super();
        if (source) this.add(source);
    }

    get maxConnections(): number {
        return this.maxConnectionCount;
    }

    set maxConnections(value: number) {
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new RangeError('LoadQueue.maxConnections must be a positive integer.');
        }
        this.maxConnectionCount = value;
    }

    add(source: LoadQueueSource<Request>): this {
        this.source.push(...(isLoadQueueItemList(source) ? source : [source]));
        return this;
    }

    get(id: string): LoadQueueItem<Request> | null {
        return this.source.find(item => item.id === id || item.src === id) ?? null;
    }

    getContent(id: string): unknown {
        return this.get(id)?.content;
    }

    start(): this {
        this.loader ??= new Loader();
        this.loadNext();
        return this;
    }

    private loadNext(): void {
        if (this.loadedCount >= this.source.length) {
            this.fire('complete', { items: this.source });
            return;
        }

        while (
            this.currentIndex < this.source.length - 1 &&
            this.connections < this.maxConnections
        ) {
            const index = ++this.currentIndex;
            const item = this.source[index];
            if (!item || !this.loader) break;
            this.connections++;
            void this.loader.load(item).then(
                content => {
                    this.onItemLoad(index, content);
                },
                (error: unknown) => {
                    this.onItemError(index, error);
                }
            );
        }
    }

    private onItemLoad(index: number, content: unknown): void {
        const item = this.source[index];
        if (!item) {
            throw new RangeError(`LoadQueue item ${String(index)} does not exist.`);
        }
        item.loaded = true;
        item.content = content;
        this.connections--;
        this.loadedCount++;
        this.fire('load', item);
        this.loadNext();
    }

    private onItemError(index: number, error: unknown): void {
        const item = this.source[index];
        if (!item) {
            throw new RangeError(`LoadQueue item ${String(index)} does not exist.`);
        }
        item.error = error;
        this.connections--;
        this.loadedCount++;
        this.fire('error', item);
        this.loadNext();
    }

    getSize(loaded: boolean): number {
        return this.source.reduce((total, item) => {
            return total + (loaded && !item.loaded ? 0 : (item.size ?? 0));
        }, 0);
    }

    getLoaded(): number {
        return this.loadedCount;
    }

    getTotal(): number {
        return this.source.length;
    }

    getAllContent(): unknown[] {
        return this.source.map(item => item.content);
    }
}

export default LoadQueue;
