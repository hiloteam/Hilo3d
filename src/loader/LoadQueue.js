import Class from '../core/Class';
import EventMixin from '../core/EventMixin';
import Loader from './Loader';
import log from '../utils/log';

/**
 * 队列加载器，用于批量加载
 * @class
 * @mixes EventMixin
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
const LoadQueue = Class.create(/** @lends LoadQueue.prototype */ {
    Mixes: EventMixin,
    /**
     * @default true
     * @type {boolean}
     */
    isLoadQueue: true,
    /**
     * @default LoadQueue
     * @type {string}
     */
    className: 'LoadQueue',
    Statics: {
        /**
         * 给LoadQueue类添加扩展Loader
         * @memberOf LoadQueue
         * @static
         * @param {string} ext 资源扩展，如gltf, png 等
         * @param {BasicLoader} LoaderClass 用于加载的类，需要继承BasicLoader
         */
        addLoader(ext, LoaderClass) {
            log.warn('LoadQueue.addLoader is duplicated, please use Loader.addLoader');
            Loader.addLoader(ext, LoaderClass);
        }
    },
    /**
     * @constructs
     * @param {Array} [source] 需要加载的资源列表
     */
    constructor(source) {
        this._source = [];
        this.add(source);
    },

    /**
     * 最大并发连接数
     * @default 2
     * @type {number}
     */
    maxConnections: 2,

    _source: null,
    _loaded: 0,
    _connections: 0,
    _currentIndex: -1,

    /**
     * 添加需要加载的资源
     *
     * @param {object} source 资源信息
     * @param {string} source.src 资源地址
     * @param {string} [source.id] 资源id
     * @param {string} [source.type] 资源类型，对应ext，不传的话自动根据src来获取
     * @param {number} [source.size] 资源大小，用于精确计算当前加载进度
     */
    add(source) {
        if (source) {
            source = Array.isArray(source) ? source : [source];
            this._source = this._source.concat(source);
        }
        return this;
    },
    /**
     * 获取指定id的资源
     *
     * @param {string} id id
     * @return {object} 返回对应的资源信息
     */
    get(id) {
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
    },
    /**
     * 获取指定id加载完后的数据
     *
     * @param {string} id id
     * @return {object} 加载完的结果
     */
    getContent(id) {
        const item = this.get(id);
        return item && item.content;
    },
    /**
     * 开始加载资源
     * @return {LoadQueue} 返回this
     */
    start() {
        if (!this._loader) {
            this._loader = new Loader();
        }
        this._loadNext();
        return this;
    },

    _loadNext() {
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
            this._loader.load(item).then((data) => {
                this._onItemLoad(index, data);
            }, (err) => {
                this._onItemError(index, err);
            });
        }
    },

    _onItemLoad(index, content) {
        const item = this._source[index];
        item.loaded = true;
        item.content = content;
        this._connections--;
        this._loaded++;
        this.fire('load', item);
        this._loadNext();
    },

    _onItemError(index, e) {
        const item = this._source[index];
        item.error = e;
        this._connections--;
        this._loaded++;
        this.fire('error', item);
        this._loadNext();
    },
    getSize(loaded) {
        let size = 0;
        const source = this._source;
        for (let i = 0; i < source.length; i++) {
            const item = source[i];
            size += (loaded ? item.loaded && item.size : item.size) || 0;
        }
        return size;
    },
    /**
     * 获取当前已经加载完的资源数量
     * @return {number}
     */
    getLoaded() {
        return this._loaded;
    },
    /**
     * 获取需要加载的资源总数
     * @return {number}
     */
    getTotal() {
        return this._source.length;
    },
    /**
     * 获取加载的所有资源结果
     *
     * @return {Array} 加载的所有资源结果
     */
    getAllContent() {
        return this._source.map(r => r.content);
    }
});

export default LoadQueue;
