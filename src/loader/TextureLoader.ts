import BasicLoader, { type BasicLoadRequest } from './BasicLoader';
import Texture, { type TextureParameters } from '../texture/Texture';
import Loader from './Loader';
import { textureOptions } from './textureOptions';

export type TextureLoadRequest = BasicLoadRequest &
    Omit<TextureParameters<HTMLImageElement>, 'image' | 'type'> & { src: string };

class TextureLoader {
    readonly isTextureLoader = true;
    readonly className = 'TextureLoader';
    private readonly resourceLoader = new BasicLoader();

    async load(params: TextureLoadRequest): Promise<Texture<HTMLImageElement>> {
        const image = await this.resourceLoader.loadImg(params.src, params.crossOrigin);
        return new Texture<HTMLImageElement>({ ...textureOptions(params), image });
    }
}

Loader.addLoader('Texture', TextureLoader);

export default TextureLoader;
