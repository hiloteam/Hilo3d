import Class from '../core/Class';
import Texture from './Texture';
import log from '../utils/log';
import constants from '../constants';

const {
    TEXTURE_CUBE_MAP,
    RGB,
    LINEAR,
    CLAMP_TO_EDGE,
    TEXTURE_CUBE_MAP_POSITIVE_X
} = constants;

/**
 * 立方体纹理
 * @class
 * @extends Texture
 * @example
 * var loadQueue = new Hilo3d.LoadQueue([{
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB15OJpQFXXXXXgXVXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1gwNqQFXXXXcIXFXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1pyNcQFXXXXb7XVXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1FilNQFXXXXcKXXXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1gIpqQFXXXXcZXFXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1RFXLQFXXXXXEXpXXXXXXXXXX-512-512.png'
 * }]).on('complete', function () {
 *     var result = loadQueue.getAllContent();
 *     var skyboxMap = new Hilo3d.CubeTexture({
 *         image: result
 *     });
 *     var skybox = new Hilo3d.Mesh({
 *         geometry: new Hilo3d.BoxGeometry(),
 *         material: new Hilo3d.BasicMaterial({
 *             lightType: 'NONE',
 *             diffuse: skyboxMap
 *         })
 *     });
 *     stage.addChild(skybox);
 * });
 */
const CubeTexture = Class.create(/** @lends CubeTexture.prototype */{
    Extends: Texture,
    /**
     * @default true
     * @type {boolean}
     */
    isCubeTexture: true,
    /**
     * @default CubeTexture
     * @type {string}
     */
    className: 'CubeTexture',

    /**
     * @default TEXTURE_CUBE_MAP
     * @type {number}
     */
    target: TEXTURE_CUBE_MAP,
    /**
     * @default RGB
     * @type {number}
     */
    internalFormat: RGB,
    /**
     * @default RGB
     * @type {number}
     */
    format: RGB,

    /**
     * @default LINEAR
     * @type {number}
     */
    magFilter: LINEAR,
    /**
     * @default LINEAR
     * @type {number}
     */
    minFilter: LINEAR,
    /**
     * @default CLAMP_TO_EDGE
     * @type {number}
     */
    wrapS: CLAMP_TO_EDGE,
    /**
     * @default CLAMP_TO_EDGE
     * @type {number}
     */
    wrapT: CLAMP_TO_EDGE,
    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     * @param {HTMLImageElement[]} [params.image] 图片列表，共6张
     */
    constructor(params) {
        CubeTexture.superclass.constructor.call(this, params);
        this.image = this.image || [];
    },
    _uploadTexture(state) {
        const images = this.image;
        if (!Array.isArray(images) || images.length !== 6) {
            log.error('CubeTexture image must be an Array of length 6', images);
            return;
        }

        if (images[0] && images[0].width) {
            this.width = images[0].width;
            this.height = images[0].height;
        }

        images.forEach((img, i) => {
            this._glUploadTexture(state, TEXTURE_CUBE_MAP_POSITIVE_X + i, img, 0);
        });
    },
    /**
     * 右侧的图片
     * @type {HTMLImageElement}
     */
    right: {
        get() {
            return this.image[0];
        },
        set(img) {
            this.image[0] = img;
        }
    },
    /**
     * 左侧的图片
     * @type {HTMLImageElement}
     */
    left: {
        get() {
            return this.image[1];
        },
        set(img) {
            this.image[1] = img;
        }
    },
    /**
     * 顶部的图片
     * @type {HTMLImageElement}
     */
    top: {
        get() {
            return this.image[2];
        },
        set(img) {
            this.image[2] = img;
        }
    },
    /**
     * 底部的图片
     * @type {HTMLImageElement}
     */
    bottom: {
        get() {
            return this.image[3];
        },
        set(img) {
            this.image[3] = img;
        }
    },
    /**
     * 朝前的图片
     * @type {HTMLImageElement}
     */
    front: {
        get() {
            return this.image[4];
        },
        set(img) {
            this.image[4] = img;
        }
    },
    /**
     * 朝后的图片
     * @type {HTMLImageElement}
     */
    back: {
        get() {
            return this.image[5];
        },
        set(img) {
            this.image[5] = img;
        }
    }
});

export default CubeTexture;
