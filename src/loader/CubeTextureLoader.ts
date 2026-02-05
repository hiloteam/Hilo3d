import BasicLoader from './BasicLoader';
import CubeTexture from '../texture/CubeTexture';
import Loader from './Loader';
import log from '../utils/log';

interface CubeTextureParams {
    crossOrigin?: boolean;
    images?: string[];
    right?: string;
    left?: string;
    top?: string;
    bottom?: string;
    front?: string;
    back?: string;
    [key: string]: any;
}

/**
 * CubeTexture加载类
 * @class
 * @extends {BasicLoader}
 * @example
 * var loader = new Hilo3d.CubeTextureLoader();
 * loader.load({
 *     crossOrigin: true,
 *     images: [
 *         '//gw.alicdn.com/tfs/TB1Ss.ORpXXXXcNXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1YhUDRpXXXXcyaXXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1Y1MORpXXXXcpXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1ZgAqRpXXXXa0aFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1IVZNRpXXXXaNXFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1M3gyRpXXXXb9apXXXXXXXXXX-2048-2048.jpg_960x960.jpg'
 *     ]
 * }).then(function (skybox) {
 *     var material = new Hilo3d.BasicMaterial({
 *         diffuse: skybox
 *     });
 *     ...
 * });
 */
class CubeTextureLoader extends BasicLoader {
    /**
     * @default true
     * @type {boolean}
     */
    isCubeTextureLoader: boolean = true;

    /**
     * @default CubeTextureLoader
     * @type {string}
     */
    className: string = 'CubeTextureLoader';

    /**
     * 加载CubeTexture
     * @param {object} params 加载参数
     * @param {boolean} params.crossOrigin 是否跨域，不传将自动判断
     * @param {Array.<string>} params.images 纹理图片地址数组，顺序为 right, left, top, bottom, front, back
     * @param {string} params.right 右面的图片地址
     * @param {string} params.left 左面的图片地址
     * @param {string} params.top 上面的图片地址
     * @param {string} params.bottom 下面的图片地址
     * @param {string} params.front 前面的图片地址
     * @param {string} params.back 背面的图片地址
     * @async
     * @return {Promise<CubeTexture, Error>} 返回加载完的CubeTexture对象
     */
    load(params: CubeTextureParams): Promise<CubeTexture> {
        let images: string[];
        if (params.images && Array.isArray(params.images)) {
            if (params.images.length !== 6) {
                return Promise.reject(new Error('CubeTexture images array must contain exactly 6 images'));
            }
            images = params.images;
        } else {
            // Validate that all six face images are provided
            if (!params.right || !params.left || !params.top || !params.bottom || !params.front || !params.back) {
                return Promise.reject(new Error('CubeTexture requires all six face images (right, left, top, bottom, front, back)'));
            }
            images = [params.right, params.left, params.top, params.bottom, params.front, params.back];
        }
        return Promise.all(images.map((img: string) => {
            return this.loadImg(img, params.crossOrigin);
        })).then((images: HTMLImageElement[]) => {
            const args: any = Object.assign({}, params);
            delete args.images;
            delete args.type;
            delete args.right;
            delete args.left;
            delete args.top;
            delete args.bottom;
            delete args.front;
            delete args.back;
            args.image = images;
            return new CubeTexture(args);
        }).catch((err: Error) => {
            log.error('load CubeTexture failed', err.message, err.stack);
            throw err;
        });
    }
}

Loader.addLoader('CubeTexture', CubeTextureLoader);

export default CubeTextureLoader;
