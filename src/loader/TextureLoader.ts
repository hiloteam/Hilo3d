import BasicLoader from './BasicLoader';
import Texture from '../texture/Texture';
import Loader from './Loader';
import log from '../utils/log';

interface TextureLoaderParams {
    src: string;
    crossOrigin?: boolean;
    type?: string;
    [key: string]: any;
}

/**
 * Texture加载类
 * @class
 * @extends {BasicLoader}
 * @example
 * var loader = new Hilo3d.TextureLoader();
 * loader.load({
 *     crossOrigin: true,
 *     src: '//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
 * }).then(function (diffuse) {
 *     var material = new Hilo3d.BasicMaterial({
 *         diffuse: diffuse
 *     });
 *     ...
 * });
 */
class TextureLoader extends BasicLoader {
    /**
     * @default true
     * @type {boolean}
     */
    isTextureLoader: boolean = true;

    /**
     * @default TextureLoader
     * @type {string}
     */
    className: string = 'TextureLoader';

    /**
     * 加载Texture
     * @param {object} params 加载参数
     * @param {string} params.src 纹理图片地址
     * @param {boolean} params.crossOrigin 是否跨域，不传将自动判断
     * @async
     * @return {Promise<Texture, Error>} 返回加载完的Texture对象
     */
    load(params: TextureLoaderParams): Promise<Texture> {
        return this.loadImg(params.src, params.crossOrigin).then((img) => {
            const args: any = Object.assign({}, params);
            args.image = img;
            delete args.type;
            return new Texture(args);
        }).catch((err) => {
            log.error('load Texture failed', err.message, err.stack);
            throw err;
        });
    }
}

Loader.addLoader('Texture', TextureLoader);

export default TextureLoader;
