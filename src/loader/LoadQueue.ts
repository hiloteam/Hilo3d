import { EventObject, EventMixinCallback } from '../core/EventMixin';
import Loader from './Loader';
import log from '../utils/log';
import BasicLoader from './BasicLoader';

interface EventListener {
    listener: EventMixinCallback;
    once?: boolean;
}

interface LoadQueueSource {
    src?: string;
    id?: string;
    type?: string;
    size?: number;
    loaded?: boolean;
    content?: any;
    error?: Error;
    [key: string]: any;
}

/**
 * 队列加载器，用于批量加载
 * @class
 * @fires complete 完成事件
 * @fires load 加载事件
 * @fires error 错误事件
 * @example
 * var loadQueue = new Hilo3d.LoadQueue([{
 *     type: 'CubeTexture',
 *     images: [
 *         '//gw.alicdn.com/tfs/TB1Ss.ORpXXXXcNXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1YhUDRpXXXXcyaXXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1Y1MORpXXXXcpXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1ZgAqRpXXXXa0aFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1IVZNRpXXXXaNXFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1M3gyRpXXXXb9apXXXXXXXXXX-2048-2048.jpg_960x960.jpg'
 *     ]
 * }, {
 *     src: '//ossgw.alicdn.com/tmall-c3/tmx/0356679fd543809bba95dfaea32e1d45.gltf'
 * }]).on('complete', function () {
 *     var result = loadQueue.getAllContent();
 *     var box = new Hilo3d.Mesh({
 *         geometry: geometry,
 *         material: new Hilo3d.BasicMaterial({
 *             lightType: 'NONE',
 *             cullFaceType: Hilo3d.constants.FRONT,
 *             diffuse: result[0]
 *         })
 *     }).addTo(stage);
 *     box.setScale(20);
 *     var material = new Hilo3d.BasicMaterial({
 *         diffuse: new Hilo3d.Color(0, 0, 0),
 *         skyboxMap: result[0],
 *         refractRatio: 1/1.5,
 *         refractivity: 0.8,
 *         reflectivity: 0.2
 *     });
 *     var model = result[1];
 *     model.node.setScale(0.001);
 *     model.meshes.forEach(function (m) {
 *         m.material = material;
 *     });
 *     stage.addChild(model.node);
 * }).start();
 */
class LoadQueue {
    /**
     * @default true
     * @type {boolean}
     */
    isLoadQueue: boolean = true;

    /**
     * @default LoadQueue
     * @type {string}
     */
    className: string = 'LoadQueue';

    /**
     * 最大并发连接数
     * @default 2
     * @type {number}
     */
    maxConnections: number = 2;

    private _listeners: Record<string, EventListener[]> | null = null;
    private _source: LoadQueueSource[] = [];
    private _loaded: number = 0;
    private _connections: number = 0;
    private _currentIndex: number = -1;
    private _loader?: Loader;

    /**
     * 给LoadQueue类添加扩展Loader
     * @static
     * @param {string} ext 资源扩展，如gltf, png 等
     * @param {typeof BasicLoader} LoaderClass 用于加载的类，需要继承BasicLoader
     */
    static addLoader(ext: string, LoaderClass: typeof BasicLoader): void {
        log.warn('LoadQueue.addLoader is duplicated, please use Loader.addLoader');
        Loader.addLoader(ext, LoaderClass);
    }

    /**
     * @constructs
     * @param {Array} [source] 需要加载的资源列表
     */
    constructor(source?: LoadQueueSource | LoadQueueSource[]) {
        this._source = [];
        this.add(source);
    }

    /**
     * 增加一个事件监听。
     * @param {String} type 要监听的事件类型。
     * @param {EventMixinCallback} listener 事件监听回调函数。
     * @param {Boolean} [once] 是否是一次性监听，即回调函数响应一次后即删除，不再响应。
     * @return {LoadQueue} 对象本身。链式调用支持。
     */
    on(type: string, listener: EventMixinCallback, once?: boolean): this {
        let listeners = (this._listeners = this._listeners || {});
        let eventListeners = (listeners[type] = listeners[type] || []);
        for (let i = 0, len = eventListeners.length; i < len; i++) {
            let el = eventListeners[i];
            if (el.listener === listener) {
                return this;
            }
        }
        eventListeners.push({
            listener,
            once
        });
        return this;
    }

    /**
     * 删除一个事件监听。如果不传入任何参数，则删除所有的事件监听；如果不传入第二个参数，则删除指定类型的所有事件监听。
     * @param {String} [type] 要删除监听的事件类型。
     * @param {EventMixinCallback} [listener] 要删除监听的回调函数。
     * @returns {LoadQueue} 对象本身。链式调用支持。
     */
    off(type?: string, listener?: EventMixinCallback): this {
        if (arguments.length === 0) {
            this._listeners = null;
            return this;
        }

        let eventListeners = this._listeners && this._listeners[type!];
        if (eventListeners && eventListeners.length > 0) {
            if (arguments.length === 1) {
                delete this._listeners![type!];
                return this;
            }

            for (let i = 0, len = eventListeners.length; i < len; i++) {
                let el = eventListeners[i];
                if (el.listener === listener) {
                    eventListeners.splice(i, 1);
                    break;
                }
            }
        }
        return this;
    }

    /**
     * 发送事件。当第一个参数类型为Object时，则把它作为一个整体事件对象。
     * @param {String|EventObject} [type] 要发送的事件类型或者一个事件对象。
     * @param {Object} [detail] 要发送的事件的具体信息，即事件随带参数。
     * @returns {Boolean} 是否成功调度事件。
     */
    fire(type: string | EventObject, detail?: any): boolean {
        let event: EventObject | undefined;
        let eventType: string;
        if (typeof type === 'string') {
            eventType = type;
        } else {
            event = type;
            eventType = type.type;
        }

        let listeners = this._listeners;
        if (!listeners) return false;

        let eventListeners = listeners[eventType];
        if (eventListeners && eventListeners.length > 0) {
            let eventListenersCopy = eventListeners.slice(0);
            event = event || new EventObject(eventType, this, detail);
            if (event._stopped) return false;

            for (let i = 0; i < eventListenersCopy.length; i++) {
                let el = eventListenersCopy[i];
                el.listener.call(this, event);
                if (el.once) {
                    let index = eventListeners.indexOf(el);
                    if (index > -1) {
                        eventListeners.splice(index, 1);
                    }
                }
            }

            return true;
        }
        return false;
    }

    /**
     * 添加需要加载的资源
     *
     * @param {object} source 资源信息
     * @param {string} source.src 资源地址
     * @param {string} [source.id] 资源id
     * @param {string} [source.type] 资源类型，对应ext，不传的话自动根据src来获取
     * @param {number} [source.size] 资源大小，用于精确计算当前加载进度
     */
    add(source?: LoadQueueSource | LoadQueueSource[]): this {
        if (source) {
            const sourceArray = Array.isArray(source) ? source : [source];
            this._source = this._source.concat(sourceArray);
        }
        return this;
    }

    /**
     * 获取指定id的资源
     *
     * @param {string} id id
     * @return {object} 返回对应的资源信息
     */
    get(id: string): LoadQueueSource | null {
        if (!id) {
            return null;
        }
        const source = this._source;
        for (let i = 0; i < source.length; i++) {
            let item = source[i];
            if (item.id === id || item.src === id) {
                return item;
            }
        }
        return null;
    }

    /**
     * 获取指定id加载完后的数据
     *
     * @param {string} id id
     * @return {object} 加载完的结果
     */
    getContent(id: string): any {
        const item = this.get(id);
        return item && item.content;
    }

    /**
     * 开始加载资源
     * @return {LoadQueue} 返回this
     */
    start(): this {
        if (!this._loader) {
            this._loader = new Loader();
        }
        this._loadNext();
        return this;
    }

    private _loadNext(): void {
        const source = this._source;
        const len = source.length;

        // all items loaded
        if (this._loaded >= len) {
            this.fire('complete');
            return;
        }

        if (this._currentIndex < len - 1 && this._connections < this.maxConnections) {
            let index = ++this._currentIndex;
            let item = source[index];

            this._connections++;
            this._loader!.load(item).then((data: any) => {
                this._onItemLoad(index, data);
            }, (err: Error) => {
                this._onItemError(index, err);
            });
        }
    }

    private _onItemLoad(index: number, content: any): void {
        const item = this._source[index];
        item.loaded = true;
        item.content = content;
        this._connections--;
        this._loaded++;
        this.fire('load', item);
        this._loadNext();
    }

    private _onItemError(index: number, e: Error): void {
        const item = this._source[index];
        item.error = e;
        this._connections--;
        this._loaded++;
        this.fire('error', item);
        this._loadNext();
    }

    getSize(loaded?: boolean): number {
        let size = 0;
        const source = this._source;
        for (let i = 0; i < source.length; i++) {
            const item = source[i];
            size += (loaded ? item.loaded && item.size : item.size) || 0;
        }
        return size;
    }

    /**
     * 获取当前已经加载完的资源数量
     * @return {number}
     */
    getLoaded(): number {
        return this._loaded;
    }

    /**
     * 获取需要加载的资源总数
     * @return {number}
     */
    getTotal(): number {
        return this._source.length;
    }

    /**
     * 获取加载的所有资源结果
     *
     * @return {Array} 加载的所有资源结果
     */
    getAllContent(): any[] {
        return this._source.map(r => r.content);
    }
}

export default LoadQueue;
export { LoadQueueSource };
