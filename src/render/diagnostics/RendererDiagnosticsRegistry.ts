import { RendererDiagnostics } from '../RendererDiagnostics';

const diagnosticsByCanvas = new WeakMap<HTMLCanvasElement, RendererDiagnostics>();

/**
 * Opt a canvas into renderer diagnostics before constructing its Renderer/Engine.
 * Registration is a setup-only operation; frame hot paths never consult this WeakMap.
 */
export function registerRendererDiagnostics(
    canvas: HTMLCanvasElement,
    diagnostics: RendererDiagnostics = new RendererDiagnostics()
): RendererDiagnostics {
    const current = diagnosticsByCanvas.get(canvas);
    if (current && current !== diagnostics) {
        throw new Error('Renderer diagnostics are already registered for this canvas');
    }
    diagnosticsByCanvas.set(canvas, diagnostics);
    return diagnostics;
}

/** @internal Resolve diagnostics once while constructing a renderer. */
export function getRegisteredRendererDiagnostics(
    canvas: HTMLCanvasElement
): RendererDiagnostics | null {
    return diagnosticsByCanvas.get(canvas) ?? null;
}

/**
 * Remove a setup channel. Supplying the expected instance prevents stale cleanup from removing a
 * newer registration. Already-constructed renderers retain their directly attached sink.
 */
export function unregisterRendererDiagnostics(
    canvas: HTMLCanvasElement,
    expected?: RendererDiagnostics
): boolean {
    const current = diagnosticsByCanvas.get(canvas);
    if (!current || (expected !== undefined && current !== expected)) return false;
    return diagnosticsByCanvas.delete(canvas);
}
