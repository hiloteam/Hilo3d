import { describe, expect, it } from 'vitest';
import {
    RHIValidationError,
    type RHIDevice,
    type RHISurface
} from '../../../../src/render/rhi/core';
import { createWebGL2RHIDevice } from '../../../../src/render/rhi/backends/webgl2';
import { WebGPUV2Device } from '../../../../src/render/rhi/backends/webgpu';
import { createStructuredWebGPUMock } from './StructuredWebGPUMock';

interface SurfaceLifecycleHarness {
    readonly device: RHIDevice;
    readonly canvas: HTMLCanvasElement;
    lose(): Promise<void>;
}

interface SurfaceLifecycleBackend {
    readonly name: string;
    create(): SurfaceLifecycleHarness | null;
}

function expectStateError(
    action: () => unknown,
    code: 'destroyed-object' | 'stale-generation'
): void;
function expectStateError(action: () => unknown, code?: 'invalid-state'): void;
function expectStateError(
    action: () => unknown,
    code: 'destroyed-object' | 'invalid-state' | 'stale-generation' = 'invalid-state'
): void {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(RHIValidationError);
        expect((error as RHIValidationError).code).toBe(code);
        return;
    }
    throw new Error(`expected RHIValidationError(${code})`);
}

function configure(surface: RHISurface, width = 16, height = 8): void {
    surface.configure({ format: 'rgba8unorm', width, height });
}

const backends: readonly SurfaceLifecycleBackend[] = [
    {
        name: 'WebGL2',
        create() {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('webgl2');
            if (context === null) return null;
            const device = createWebGL2RHIDevice(context);
            return {
                device,
                canvas,
                async lose() {
                    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
                    await device.lost;
                }
            };
        }
    },
    {
        name: 'WebGPU',
        create() {
            const native = createStructuredWebGPUMock();
            const device = new WebGPUV2Device(native.device);
            return {
                device,
                canvas: native.canvas,
                async lose() {
                    native.loseDevice();
                    await device.lost;
                }
            };
        }
    }
];

describe.each(backends)('$name RHI v2 surface lifecycle contract', backend => {
    it('uses the same configured, acquired, active-frame, and destroyed transitions', () => {
        const harness = backend.create();
        if (harness === null) return;
        const { device, canvas } = harness;
        const surface = device.createSurface(canvas);
        try {
            expect(surface.state).toBe('unconfigured');
            expectStateError(() => {
                surface.getCurrentTexture();
            });
            expectStateError(() => {
                surface.present();
            });

            configure(surface);
            configure(surface, 24, 12);
            expect(surface.state).toBe('configured');
            expect(surface.configuration).toMatchObject({ width: 24, height: 12 });

            const frame = device.graphicsQueue.beginFrame();
            expectStateError(() => {
                configure(surface, 32, 16);
            });

            const texture = surface.getCurrentTexture();
            expect(surface.state).toBe('acquired');
            expect(texture.destroyed).toBe(false);
            expectStateError(() => {
                surface.getCurrentTexture();
            });
            expectStateError(() => {
                configure(surface, 32, 16);
            });
            expectStateError(() => {
                surface.present();
            });
            expect(texture.destroyed).toBe(false);

            device.graphicsQueue.abortFrame(frame);
            expectStateError(() => {
                configure(surface, 32, 16);
            });
            expect(texture.destroyed).toBe(false);
            surface.present();
            expect(texture.destroyed).toBe(true);
            expect(surface.state).toBe('configured');

            surface.destroy();
            expect(surface.state).toBe('destroyed');
            expectStateError(() => {
                configure(surface);
            }, 'destroyed-object');
            expectStateError(() => {
                surface.getCurrentTexture();
            }, 'destroyed-object');
            expectStateError(() => {
                surface.present();
            }, 'destroyed-object');
        } finally {
            device.destroy();
        }
    });

    it('rejects every surface operation after device loss', async () => {
        const harness = backend.create();
        if (harness === null) return;
        const { device, canvas } = harness;
        const surface = device.createSurface(canvas);
        try {
            configure(surface);
            const texture = surface.getCurrentTexture();
            await harness.lose();

            expect(device.graphicsQueue.state).toBe('lost');
            expectStateError(() => {
                configure(surface);
            }, 'stale-generation');
            expectStateError(() => {
                surface.getCurrentTexture();
            }, 'stale-generation');
            expectStateError(() => {
                surface.present();
            }, 'stale-generation');
            expectStateError(() => {
                texture.createView();
            }, 'stale-generation');
        } finally {
            device.destroy();
        }
    });
});
