import type { RenderPassTemplate } from '../graph/RenderGraphBuilder';
import type { RGTextureHandle } from '../graph/RenderGraphResource';

/** Keeps explicitly warmed sampled textures live in their upload-only graph submission. */
export const textureUploadPass: RenderPassTemplate<readonly RGTextureHandle[]> = {
    name: 'TextureUpload',
    setup(builder, textures): void {
        for (const texture of textures) builder.readTexture(texture);
        builder.markSideEffect();
    },
    execute(): void {
        // RHIUploadBatch emits the validated writes before graph passes execute.
    }
};
