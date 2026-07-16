import type { RenderGraphBuilder } from '../graph/RenderGraphBuilder';
import type { RGTextureHandle } from '../graph/RenderGraphResource';
import { RHITextureUsage, type RHISurface } from '../rhi/core';

interface SurfaceGraphImport {
    color: RGTextureHandle | null;
    depthStencil: RGTextureHandle | null;
}

const importsByBuilder = new WeakMap<RenderGraphBuilder, WeakMap<RHISurface, SurfaceGraphImport>>();

function importsFor(builder: RenderGraphBuilder, surface: RHISurface): SurfaceGraphImport {
    let surfaces = importsByBuilder.get(builder);
    if (surfaces === undefined) {
        surfaces = new WeakMap();
        importsByBuilder.set(builder, surfaces);
    }
    let imported = surfaces.get(surface);
    if (imported === undefined) {
        imported = { color: null, depthStencil: null };
        surfaces.set(surface, imported);
    }
    return imported;
}

/** Import one frame-scoped surface texture exactly once into an application graph. */
export function importSurfaceColor(
    builder: RenderGraphBuilder,
    surface: RHISurface,
    label = 'surface color'
): RGTextureHandle {
    const configuration = surface.configuration;
    if (surface.state !== 'configured' || configuration === null) {
        throw new Error(`Cannot import a surface while it is ${surface.state}`);
    }
    const imported = importsFor(builder, surface);
    if (imported.color !== null) return imported.color;
    imported.color = builder.importTextureProvider(
        label,
        {
            size: { width: configuration.width, height: configuration.height },
            mipLevelCount: 1,
            sampleCount: 1,
            dimension: '2d',
            viewDimension: '2d',
            format: configuration.format,
            usage: configuration.usage
        },
        () => surface.getCurrentTexture()
    );
    return imported.color;
}

/** Import the configured persistent depth/stencil texture once into an application graph. */
export function importSurfaceDepthStencil(
    builder: RenderGraphBuilder,
    surface: RHISurface,
    label = 'surface depth/stencil'
): RGTextureHandle {
    const configuration = surface.configuration;
    const format = configuration?.depthStencilFormat ?? null;
    if (surface.state !== 'configured' || configuration === null || format === null) {
        throw new Error('Cannot import an unavailable surface depth/stencil attachment');
    }
    const imported = importsFor(builder, surface);
    if (imported.depthStencil !== null) return imported.depthStencil;
    imported.depthStencil = builder.importTextureProvider(
        label,
        {
            size: { width: configuration.width, height: configuration.height },
            mipLevelCount: 1,
            sampleCount: 1,
            dimension: '2d',
            viewDimension: '2d',
            format,
            usage: RHITextureUsage.RENDER_ATTACHMENT
        },
        () => {
            const texture = surface.getDepthStencilTexture();
            if (texture === null) {
                throw new Error('Configured surface depth/stencil attachment is unavailable');
            }
            return texture;
        },
        'persistent'
    );
    return imported.depthStencil;
}
