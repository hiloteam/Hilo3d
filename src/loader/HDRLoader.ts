import parseRadianceHDR from './RadianceHDRParser';
import BasicLoader, { type BasicLoadRequest } from './BasicLoader';
import Texture from '../texture/Texture';
import Loader from './Loader';
import { CLAMP_TO_EDGE, FLOAT, NEAREST, RGBA } from '../constants/webgl';
import { RGBA32F } from '../constants/webgl2';
import { textureOptions, type LoaderTextureOptions } from './textureOptions';

export type HDRLoadRequest = BasicLoadRequest &
    LoaderTextureOptions<Float32Array> & { src: string };

class HDRLoader {
    readonly isHDRLoader = true;
    readonly className = 'HDRLoader';
    private readonly resourceLoader = new BasicLoader();

    async load(params: HDRLoadRequest): Promise<Texture<Float32Array>> {
        const resource = await this.resourceLoader.loadRes(params.src, BasicLoader.TYPE_BUFFER);
        if (!(resource instanceof ArrayBuffer)) {
            throw new TypeError(`HDR resource ${params.src} did not return binary data.`);
        }

        const image = parseRadianceHDR(resource);
        return new Texture<Float32Array>({
            width: image.shape[0],
            height: image.shape[1],
            image: image.data,
            type: FLOAT,
            magFilter: NEAREST,
            minFilter: NEAREST,
            wrapS: CLAMP_TO_EDGE,
            wrapT: CLAMP_TO_EDGE,
            internalFormat: RGBA32F,
            format: RGBA,
            ...textureOptions(params)
        });
    }
}

Loader.addLoader('hdr', HDRLoader);

export default HDRLoader;
