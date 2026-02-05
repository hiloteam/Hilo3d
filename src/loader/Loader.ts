import Class from '../core/Class';
import BasicLoader from './BasicLoader';
import {
    getExtension
} from '../utils/util';

/**
 * @class
 */
const Loader = Class.create(/** @lends Loader.prototype */{
    /**
     * @default true
     * @type {boolean}
     */
    isLoader: true,
    /**
     * @default Loader
     * @type {string}
     */
    className: 'Loader',
    maxConnections: 2,
    Statics: {
        _loaderClassMap: {},
        _loaders: {},
        /**
         * 给Loader类添加扩展Loader
         * @memberOf Loader
         * @static
         * @param {string} ext 资源扩展，如gltf, png 等
         * @param {any} LoaderClass 用于加载的类，需要继承BasicLoader
         */
        addLoader(ext, LoaderClass) {
            Loader._loaderClassMap[ext] = LoaderClass;
        },
        /**
         * 获取对应类型的 loader
         * @memberOf Loader
         * @static
         * @param  {string} ext
         * @return {any} loader
         */
        getLoader(ext) {
            if (!Loader._loaders[ext]) {
                const LoaderClass = Loader._loaderClassMap[ext] ? Loader._loaderClassMap[ext] : BasicLoader;
                Loader._loaders[ext] = new LoaderClass();
            }
            return Loader._loaders[ext];
        }
    },
    /**
     * url 预处理函数
     * @type {Function}
     */
    preHandlerUrl: null,
    /**
     * load
     * @param  {Object|Array} data
     * @return {Promise<any>}
     */
    load(data) {
        if (data instanceof Array) {
            return Promise.all(data.map(d => this.load(d)));
        }
        const type = data.type || getExtension(data.src);
        const loader = Loader.getLoader(type);
        let loadData = data;
        if (this.preHandlerUrl) {
            loadData = Object.assign({}, data);
            loadData.src = this.preHandlerUrl(data.src);
        }
        return loader.load(loadData);
    }
});

export default Loader;
