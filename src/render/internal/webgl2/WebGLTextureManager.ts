import {
    observeTextureDestroy,
    unobserveTextureDestroy,
    getTextureUploadMipmaps,
    type default as Texture,
    type TextureDestroyObserver,
    type TextureMipmap
} from '../../../texture/Texture';
import Cache from '../../../utils/Cache';
import requireGLResource from './requireGLResource';
import {
    createWebGLTextureUploadCache,
    synchronizeWebGLTexture,
    type WebGLTextureState,
    type WebGLTextureUploadCache
} from './WebGLTextureUploader';

interface WebGLContentDescriptor {
    target: GLenum;
    internalFormat: GLenum;
    format: GLenum;
    type: GLenum;
    width: number;
    height: number;
    depth: number;
    compressed: boolean;
    premultiplyAlpha: boolean;
    flipY: boolean;
    useMipmap: boolean;
    mipmapSource: readonly TextureMipmap[] | null;
    mipmapShape: number[];
}

interface CachedWebGLTexture {
    readonly texture: Texture<unknown>;
    readonly glTexture: WebGLTexture;
    readonly destroyObserver: TextureDestroyObserver;
    readonly uploadCache: WebGLTextureUploadCache;
    contentDescriptor: WebGLContentDescriptor | null;
    revision: number;
}

function mipmapShapeMatches(
    shape: readonly number[],
    mipmaps: readonly TextureMipmap[] | null
): boolean {
    if (shape.length !== (mipmaps?.length ?? 0) * 4) return false;
    return (mipmaps ?? []).every((mipmap, index) => {
        const offset = index * 4;
        return (
            shape[offset] === mipmap.width &&
            shape[offset + 1] === mipmap.height &&
            shape[offset + 2] === (mipmap.depth ?? 1) &&
            shape[offset + 3] === (mipmap.face ?? -1)
        );
    });
}

function contentDescriptorChanged(
    resource: CachedWebGLTexture,
    texture: Texture<unknown>,
    mipmaps: readonly TextureMipmap[] | null
): boolean {
    const descriptor = resource.contentDescriptor;
    if (!descriptor) return true;
    const descriptorChanged =
        descriptor.internalFormat !== texture.internalFormat ||
        descriptor.format !== texture.format ||
        descriptor.type !== texture.type ||
        descriptor.width !== texture.width ||
        descriptor.height !== texture.height ||
        descriptor.depth !== texture.depth ||
        descriptor.compressed !== texture.compressed ||
        descriptor.premultiplyAlpha !== texture.premultiplyAlpha ||
        descriptor.flipY !== texture.flipY ||
        descriptor.useMipmap !== texture.useMipmap;
    if (descriptorChanged || descriptor.mipmapSource === mipmaps) return descriptorChanged;
    if (resource.revision === texture.updateRevision) return true;
    return !mipmapShapeMatches(descriptor.mipmapShape, mipmaps);
}

function captureContentDescriptor(
    texture: Texture<unknown>,
    mipmaps: readonly TextureMipmap[] | null
): WebGLContentDescriptor {
    const mipmapShape: number[] = [];
    for (const mipmap of mipmaps ?? []) {
        mipmapShape.push(mipmap.width, mipmap.height, mipmap.depth ?? 1, mipmap.face ?? -1);
    }
    return {
        target: texture.target,
        internalFormat: texture.internalFormat,
        format: texture.format,
        type: texture.type,
        width: texture.width,
        height: texture.height,
        depth: texture.depth,
        compressed: texture.compressed,
        premultiplyAlpha: texture.premultiplyAlpha,
        flipY: texture.flipY,
        useMipmap: texture.useMipmap,
        mipmapSource: mipmaps,
        mipmapShape
    };
}

/** Owns one context's native texture namespace and backend-local upload revisions. */
export class WebGLTextureManager {
    private readonly state: WebGLTextureState;
    private readonly resources = new WeakMap<Texture<unknown>, CachedWebGLTexture>();
    private readonly liveResources = new Set<CachedWebGLTexture>();
    readonly cache = new Cache<WebGLTexture>();

    constructor(state: WebGLTextureState) {
        this.state = state;
    }

    get(texture: Texture<unknown>): WebGLTexture {
        if (texture.needDestroy) {
            texture.destroy();
            texture.needDestroy = false;
        }
        let resource = this.resources.get(texture);
        if (resource?.contentDescriptor?.target !== texture.target) {
            this.release(texture);
            resource = undefined;
        }
        if (!resource) {
            const glTexture = requireGLResource(this.state.gl.createTexture(), 'a texture');
            const destroyObserver: TextureDestroyObserver = () => {
                this.release(texture);
            };
            resource = {
                texture,
                glTexture,
                destroyObserver,
                uploadCache: createWebGLTextureUploadCache(),
                contentDescriptor: null,
                revision: 0
            };
            this.resources.set(texture, resource);
            this.liveResources.add(resource);
            this.cache.add(texture.id, glTexture);
            observeTextureDestroy(texture, destroyObserver);
        }
        try {
            const mipmaps = getTextureUploadMipmaps(texture);
            const forceFullUpload = contentDescriptorChanged(resource, texture, mipmaps);
            const revisionChanged = resource.revision !== texture.updateRevision;
            if (!forceFullUpload && !revisionChanged && !texture.autoUpdate) {
                return resource.glTexture;
            }
            const nextRevision = synchronizeWebGLTexture(
                this.state,
                texture,
                resource.glTexture,
                resource.revision,
                resource.uploadCache,
                forceFullUpload
            );
            resource.revision = nextRevision;
            texture.releaseImageIfAllowed();
            if (forceFullUpload || revisionChanged || !resource.contentDescriptor) {
                resource.contentDescriptor = captureContentDescriptor(
                    texture,
                    getTextureUploadMipmaps(texture)
                );
            }
            return resource.glTexture;
        } catch (error: unknown) {
            this.release(texture);
            throw error;
        }
    }

    release(texture: Texture<unknown>): boolean {
        const resource = this.resources.get(texture);
        if (!resource) return false;
        unobserveTextureDestroy(texture, resource.destroyObserver);
        this.state.gl.deleteTexture(resource.glTexture);
        this.cache.remove(texture.id);
        this.liveResources.delete(resource);
        this.resources.delete(texture);
        return true;
    }

    destroy(): void {
        for (const resource of [...this.liveResources]) this.release(resource.texture);
        this.cache.removeAll();
    }
}
