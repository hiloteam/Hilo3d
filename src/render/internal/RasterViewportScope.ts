import type { RenderPipelineContext } from '../pipeline/RenderPipeline';
import type { RendererViewport } from '../RendererCore';

const active = new WeakMap<object, RendererViewport>();

/** @internal Attachment-sized viewport for addon passes recorded at an internal render scale. */
export function resolveRasterViewport(
    context: object,
    fallback: RendererViewport
): RendererViewport {
    return active.get(context) ?? fallback;
}

/** @internal Snapshot once per addon phase; draw records copy it into their reusable parameters. */
export function withRasterViewport<T>(
    context: RenderPipelineContext,
    scale: number,
    record: () => T
): T {
    if (scale === 1) return record();
    const viewport = context.viewport;
    const previous = active.get(context);
    active.set(
        context,
        Object.freeze([
            Math.floor(viewport[0] * scale),
            Math.floor(viewport[1] * scale),
            Math.max(1, Math.floor(viewport[2] * scale)),
            Math.max(1, Math.floor(viewport[3] * scale))
        ])
    );
    try {
        return record();
    } finally {
        if (previous === undefined) active.delete(context);
        else active.set(context, previous);
    }
}
