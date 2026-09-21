import type { ScriptableRenderPass } from '../../ScriptableRenderGraph';
import type { ComputeRenderPass, ComputeRenderPassParameters } from '../ComputeRenderPass';
import type { FullscreenRenderPass, FullscreenRenderPassParameters } from '../FullscreenRenderPass';
import type { GPUDrivenRenderPass, GPUDrivenRenderPassParameters } from '../GPUDrivenRenderPass';
import type { SceneRenderPassParameters } from '../SceneRenderPass';
import type { GPUDrivenRenderBatchPassParameters } from './GPUDrivenRenderBatchPass';

/** @internal Setup-only preparation services shared by the built-in pass adapters. */
export interface ScriptablePassAdapterTarget {
    configureFullscreen(
        pass: FullscreenRenderPass,
        parameters: FullscreenRenderPassParameters
    ): void;
    configureCompute(pass: ComputeRenderPass, parameters: ComputeRenderPassParameters): void;
    configureGPUDriven(pass: GPUDrivenRenderPass, parameters: GPUDrivenRenderPassParameters): void;
    configureGPUDrivenBatch(parameters: GPUDrivenRenderBatchPassParameters): void;
    configureScene(parameters: SceneRenderPassParameters): void;
}

type ScriptablePassAdapter<P extends object> = (
    target: ScriptablePassAdapterTarget,
    parameters: P
) => void;

const adapters = new WeakMap<object, ScriptablePassAdapter<object>>();

/**
 * @internal Associate preparation with a pass at construction, outside frame and draw hot paths.
 * Keeping the registration private to the engine avoids exposing RHI access through public passes.
 */
export function registerScriptablePassAdapter<P extends object>(
    pass: ScriptableRenderPass<P>,
    adapter: ScriptablePassAdapter<P>
): void {
    if (adapters.has(pass)) throw new Error('Scriptable pass already has a preparation adapter');
    // Graph recording preserves the pass/parameter pairing; setup validates runtime parameters
    // before the erased adapter is called. The cast is confined to this registry boundary.
    adapters.set(pass, (target, parameters) => {
        adapter(target, parameters as P);
    });
}

/** @internal Configure built-in work after setup; ordinary custom passes need no adapter. */
export function configureScriptablePass(
    pass: ScriptableRenderPass<object>,
    parameters: object,
    target: ScriptablePassAdapterTarget
): void {
    adapters.get(pass)?.(target, parameters);
}
