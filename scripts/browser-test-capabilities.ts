/** Whether a browser test harness must reject WebGPU swapchain acquisition. */
export type BrowserCanvasTestPolicy = 'unrestricted' | 'reject-linux-headless-coverage';

export interface BrowserTestHarness {
    readonly platform: string;
    readonly coverage: boolean;
    /** The actual Playwright launch channel; omission selects Chromium headless shell. */
    readonly chromiumChannel: string | undefined;
}

/** Derive restrictions from the selected process, without pretending local CI flags change its OS. */
export function browserCanvasTestPolicy(harness: BrowserTestHarness): BrowserCanvasTestPolicy {
    return harness.platform === 'linux' && harness.coverage && harness.chromiumChannel === undefined
        ? 'reject-linux-headless-coverage'
        : 'unrestricted';
}

interface CanvasTextureAcquisition {
    getCurrentTexture(): unknown;
}

/**
 * Stop unsupported presentation before Chromium creates a swapchain and destroys the GPU device.
 * Canvas configuration and all offscreen work remain untouched. Pass the native prototype only;
 * portable RHI doubles are outside this guard. The returned cleanup restores its exact descriptor.
 */
export function installWebGPUCanvasTestGuard(
    prototype: CanvasTextureAcquisition | undefined,
    policy: BrowserCanvasTestPolicy
): () => void {
    if (prototype === undefined || policy === 'unrestricted')
        return (): void => {
            // No native method was changed.
        };

    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getCurrentTexture');
    if (descriptor === undefined)
        throw new Error('Cannot guard the native GPUCanvasContext.getCurrentTexture method');

    Object.defineProperty(prototype, 'getCurrentTexture', {
        ...descriptor,
        value: (): never => {
            throw new Error(
                'WebGPU canvas presentation is unavailable in Linux headless-shell coverage. ' +
                    'This test attempted GPUCanvasContext.getCurrentTexture; acquisition was blocked ' +
                    'before touching the native swapchain. Put presentation cases in ' +
                    'test/surface-render/ (npm run test:surface:render), which is discovered by ' +
                    'the required macOS full-compositor lane. Share fixtures with coverage tests; ' +
                    'offscreen renderToTarget tests can remain in test/spec/.'
            );
        }
    });

    return (): void => {
        Object.defineProperty(prototype, 'getCurrentTexture', descriptor);
    };
}
