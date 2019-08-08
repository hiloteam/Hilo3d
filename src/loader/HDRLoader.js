import parseHDR from 'parse-hdr';
import Class from '../core/Class';
import BasicLoader from './BasicLoader';
import Texture from '../texture/Texture';
import Loader from './Loader';
import log from '../utils/log';
import constants from '../constants';

const {
    RGBA,
    NEAREST,
    CLAMP_TO_EDGE,
    FLOAT
} = constants;

/**
 * @class
 */
const HDRLoader = Class.create(/** @lends HDRLoader.prototype */{
    Extends: BasicLoader,
    /**
     * @default true
     * @type {boolean}
     */
    isHDRLoader: true,
    /**
     * @default HDRLoader
     * @type {string}
     */
    className: 'HDRLoader',
    constructor() {
        HDRLoader.superclass.constructor.call(this);
    },
    /**
     * load
     * @param  {Object} params
     * @return {Promise}
     */
    load(params) {
        return this.loadRes(params.src, 'buffer')
            .then((buffer) => {
                try {
                    const img = parseHDR(buffer);
                    const shape = img.shape;
                    const pixels = img.data;

                    const texture = new Texture({
                        width: shape[0],
                        height: shape[1],
                        flipY: params.flipY || false,
                        image: pixels,
                        type: FLOAT,
                        magFilter: NEAREST,
                        minFilter: NEAREST,
                        wrapS: CLAMP_TO_EDGE,
                        wrapT: CLAMP_TO_EDGE,
                        internalFormat: RGBA,
                        format: RGBA
                    });

                    Object.assign(texture, params);

                    return texture;
                } catch (e) {
                    log.error('HDRLoader:parse error => ', e);
                }
                return null;
            });
    }
});

Loader.addLoader('hdr', HDRLoader);

export default HDRLoader;
