import Texture, { isTextureImageSource, type TextureParameters } from './Texture';
import Loader from '../loader/Loader';
import type { ImageCrossOrigin } from '../loader/BasicLoader';

const placeHolder = typeof Image === 'undefined' ? null : new Image();
if (placeHolder) {
    placeHolder.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
}

export interface LazyTextureParameters extends TextureParameters {
    crossOrigin?: ImageCrossOrigin;
    autoLoad?: boolean;
    resType?: string;
    src?: string;
    placeHolder?: HTMLImageElement | null;
}

/** Texture that resolves its source through the loader registry on demand. */
class LazyTexture extends Texture {
    static loader: Loader | null = null;

    readonly isLazyTexture = true;
    override readonly className = 'LazyTexture';
    crossOrigin: ImageCrossOrigin = false;
    autoLoad = true;
    resType = '';
    placeHolder: HTMLImageElement | null = null;
    private _src = '';

    get src(): string {
        return this._src;
    }

    set src(src: string) {
        if (this._src === src) return;
        this._src = src;
        if (this.autoLoad) void this.load();
    }

    constructor(params: LazyTextureParameters = {}) {
        const {
            src,
            crossOrigin,
            autoLoad,
            resType,
            placeHolder: customPlaceHolder,
            ...texture
        } = params;
        super(texture);
        if (crossOrigin !== undefined) this.crossOrigin = crossOrigin;
        if (autoLoad !== undefined) this.autoLoad = autoLoad;
        if (resType !== undefined) this.resType = resType;
        if (customPlaceHolder !== undefined) this.placeHolder = customPlaceHolder;
        const initialImage = this.image;
        const initialOrPlaceholder = this.placeHolder ?? initialImage ?? placeHolder;
        if (initialOrPlaceholder !== initialImage) this.image = initialOrPlaceholder;
        if (src !== undefined) this.src = src;
    }

    async load(): Promise<void> {
        const loader = LazyTexture.loader ?? (LazyTexture.loader = new Loader());
        try {
            const loaded = await loader.load({
                src: this.src,
                crossOrigin: this.crossOrigin,
                defaultType: 'img',
                ...(this.resType ? { type: this.resType } : {})
            });
            if (loaded instanceof Texture) {
                this.applyLoadedTexture(loaded);
            } else if (isTextureImageSource(loaded)) {
                this.image = loaded;
                this.needUpdate = true;
                this.needDestroy = true;
            } else {
                throw new TypeError(
                    'LazyTexture loader must return a Texture or supported image source'
                );
            }
            this.fire('load');
        } catch (error: unknown) {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.fire('error', failure);
            throw new Error(`LazyTexture failed to load ${this.src}: ${failure.message}`, {
                cause: error
            });
        }
    }

    private applyLoadedTexture(texture: Texture<unknown>): void {
        const image = texture.image;
        if (image !== null && !isTextureImageSource(image)) {
            throw new TypeError('Loaded texture has an unsupported image source');
        }
        this.image = image;
        this.mipmaps = texture.mipmaps ? [...texture.mipmaps] : null;
        this.isImageCanRelease = texture.isImageCanRelease;
        this.target = texture.target;
        this.internalFormat = texture.internalFormat;
        this.format = texture.format;
        this.type = texture.type;
        this.width = texture.width;
        this.height = texture.height;
        this.depth = texture.depth;
        this.magFilter = texture.magFilter;
        this.minFilter = texture.minFilter;
        this.wrapS = texture.wrapS;
        this.wrapT = texture.wrapT;
        this.wrapR = texture.wrapR;
        this.name = texture.name;
        this.premultiplyAlpha = texture.premultiplyAlpha;
        this.flipY = texture.flipY;
        this.compressed = texture.compressed;
        this.autoUpdate = texture.autoUpdate;
        this.uv = texture.uv;
        this.anisotropic = texture.anisotropic;
        this.needUpdate = true;
        this.needDestroy = true;
    }
}

export default LazyTexture;
