import type { RHIExternalImageDimensionsStorage, RHIExternalImageSource } from '../../core';

interface WebGPUVideoUploadState {
    readonly canvas: HTMLCanvasElement;
    readonly context: CanvasRenderingContext2D;
    copyInFlight: boolean;
    queueError: Error | null;
    readonly copyCompleted: () => void;
    readonly copyFailed: (reason: unknown) => void;
}

function isVideoSource(source: RHIExternalImageSource): source is HTMLVideoElement {
    return (
        (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) ||
        Object.prototype.toString.call(source) === '[object HTMLVideoElement]'
    );
}

/**
 * Browser video decoder surfaces are not universally importable by WebGPU (notably SwiftShader).
 * Snapshot them through a reusable document canvas and keep that canvas immutable until its queue
 * copy completes. Other external-image kinds retain the native zero-copy path.
 */
export class WebGPUExternalImageStager {
    readonly #videos = new WeakMap<HTMLVideoElement, WebGPUVideoUploadState>();

    constructor(readonly nativeQueue: GPUQueue) {}

    prepare(
        source: RHIExternalImageSource,
        dimensions: Readonly<RHIExternalImageDimensionsStorage>
    ): GPUCopyExternalImageSource | null {
        if (!isVideoSource(source)) return source;
        const state = this.videoState(source);
        if (state.queueError !== null) {
            throw new Error('WebGPU video frame upload did not complete', {
                cause: state.queueError
            });
        }
        if (state.copyInFlight) return null;

        if (state.canvas.width !== dimensions.width) state.canvas.width = dimensions.width;
        if (state.canvas.height !== dimensions.height) state.canvas.height = dimensions.height;
        state.context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
        return state.canvas;
    }

    copied(source: RHIExternalImageSource): void {
        if (!isVideoSource(source)) return;
        const state = this.#videos.get(source);
        if (state === undefined) {
            throw new Error('WebGPU video frame was copied without a staging state');
        }
        state.copyInFlight = true;
        void this.nativeQueue.onSubmittedWorkDone().then(state.copyCompleted, state.copyFailed);
    }

    private videoState(source: HTMLVideoElement): WebGPUVideoUploadState {
        const existing = this.#videos.get(source);
        if (existing !== undefined) return existing;
        if (typeof document === 'undefined') {
            throw new TypeError('WebGPU HTMLVideoElement textures require a document canvas');
        }
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { alpha: false });
        if (context === null) throw new Error('Unable to create a WebGPU video staging canvas');
        const state = {
            canvas,
            context,
            copyInFlight: false,
            queueError: null as Error | null,
            copyCompleted: () => {
                state.copyInFlight = false;
            },
            copyFailed: (reason: unknown) => {
                state.copyInFlight = false;
                state.queueError =
                    reason instanceof Error
                        ? reason
                        : new Error('WebGPU queue rejected a video frame upload', {
                              cause: reason
                          });
            }
        } satisfies WebGPUVideoUploadState;
        this.#videos.set(source, state);
        return state;
    }
}
