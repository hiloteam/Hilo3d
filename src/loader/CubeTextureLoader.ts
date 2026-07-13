import BasicLoader, { type LoaderRequest } from './BasicLoader';
import CubeTexture, { type CubeTextureParameters } from '../texture/CubeTexture';
import Loader from './Loader';
import { textureOptions } from './textureOptions';

export type CubeTextureLoadRequest = LoaderRequest &
    Partial<Omit<CubeTextureParameters, 'image' | 'type'>> & {
        images?: readonly string[];
        right?: string;
        left?: string;
        top?: string;
        bottom?: string;
        front?: string;
        back?: string;
    };

function resolveImageUrls(params: CubeTextureLoadRequest): readonly string[] {
    const urls = params.images ?? [
        params.right,
        params.left,
        params.top,
        params.bottom,
        params.front,
        params.back
    ];
    if (
        urls.length !== 6 ||
        !urls.every((url): url is string => {
            return typeof url === 'string' && url.length > 0;
        })
    ) {
        throw new TypeError('CubeTextureLoader requires exactly six image URLs.');
    }
    return urls;
}

class CubeTextureLoader {
    readonly isCubeTextureLoader = true;
    readonly className = 'CubeTextureLoader';
    private readonly resourceLoader = new BasicLoader();

    async load(params: CubeTextureLoadRequest): Promise<CubeTexture> {
        const image = await Promise.all(
            resolveImageUrls(params).map(url => {
                return this.resourceLoader.loadImg(url, params.crossOrigin);
            })
        );
        return new CubeTexture({ ...textureOptions(params), image });
    }
}

Loader.addLoader('CubeTexture', CubeTextureLoader);

export default CubeTextureLoader;
