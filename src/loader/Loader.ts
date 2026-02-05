import BasicLoader from './BasicLoader';
import {
    getExtension
} from '../utils/util';

interface LoaderData {
    src: string;
    type?: string;
    [key: string]: any;
}

type LoaderConstructor = new () => BasicLoader;

/**
 * @class
 */
class Loader {
    /**
     * @default true
     * @type {boolean}
     */
    isLoader: boolean = true;

    /**
     * @default Loader
     * @type {string}
     */
    className: string = 'Loader';

    maxConnections: number = 2;

    /**
     * url 预处理函数
     * @type {Function}
     */
    preHandlerUrl: ((url: string) => string) | null = null;

    private static _loaderClassMap: Record<string, LoaderConstructor> = {};

    private static _loaders: Record<string, BasicLoader> = {};

    /**
     * 给Loader类添加扩展Loader
     * @param {string} ext 资源扩展，如gltf, png 等
     * @param {LoaderConstructor} LoaderClass 用于加载的类，需要继承BasicLoader
     */
    static addLoader(ext: string, LoaderClass: LoaderConstructor): void {
        Loader._loaderClassMap[ext] = LoaderClass;
    }

    /**
     * 获取对应类型的 loader
     * @param  {string} ext
     * @return {BasicLoader} loader
     */
    static getLoader(ext: string): BasicLoader {
        if (!Loader._loaders[ext]) {
            const LoaderClass = Loader._loaderClassMap[ext] ? Loader._loaderClassMap[ext] : BasicLoader;
            Loader._loaders[ext] = new LoaderClass();
        }
        return Loader._loaders[ext];
    }

    /**
     * load
     * @param  {Object|Array} data
     * @return {Promise<any>}
     */
    load(data: LoaderData | LoaderData[]): Promise<any> {
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
}

export default Loader;
