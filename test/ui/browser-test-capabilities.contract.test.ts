import { describe, expect, it, vi } from 'vitest';
import {
    browserCanvasTestPolicy,
    installWebGPUCanvasTestGuard
} from '../../scripts/browser-test-capabilities';

describe('browser test presentation capability', () => {
    it.each([
        ['linux', true, undefined, 'reject-linux-headless-coverage'],
        ['linux', false, undefined, 'unrestricted'],
        ['linux', true, 'chromium', 'unrestricted'],
        ['darwin', true, undefined, 'unrestricted'],
        ['darwin', true, 'chromium', 'unrestricted'],
        ['win32', true, undefined, 'unrestricted']
    ] as const)(
        'derives %s coverage=%s channel=%s restrictions from the actual harness',
        (platform, coverage, chromiumChannel, expected) => {
            expect(browserCanvasTestPolicy({ platform, coverage, chromiumChannel })).toBe(expected);
        }
    );

    it('blocks acquisition before the native operation while retaining configuration and offscreen work', () => {
        const acquire = vi.fn(() => ({ texture: 'swapchain' }));
        const configure = vi.fn();
        const submitOffscreen = vi.fn(() => ({ texture: 'offscreen' }));
        class NativeCanvasDouble {
            configure(): void {
                configure();
            }
            getCurrentTexture(): { texture: string } {
                return acquire();
            }
        }
        const descriptor = Object.getOwnPropertyDescriptor(
            NativeCanvasDouble.prototype,
            'getCurrentTexture'
        );
        const restore = installWebGPUCanvasTestGuard(
            NativeCanvasDouble.prototype,
            'reject-linux-headless-coverage'
        );
        const canvas = new NativeCanvasDouble();
        try {
            canvas.configure();
            expect(submitOffscreen()).toEqual({ texture: 'offscreen' });
            expect(configure).toHaveBeenCalledOnce();
            expect(() => canvas.getCurrentTexture()).toThrow(
                /Linux headless-shell coverage.*test\/surface-render\/.*required macOS/u
            );
            expect(acquire).not.toHaveBeenCalled();
        } finally {
            restore();
        }
        expect(
            Object.getOwnPropertyDescriptor(NativeCanvasDouble.prototype, 'getCurrentTexture')
        ).toEqual(descriptor);
        expect(canvas.getCurrentTexture()).toEqual({ texture: 'swapchain' });
        expect(acquire).toHaveBeenCalledOnce();
    });

    it('preserves supported acquisition identity, receiver, returned texture and native errors', () => {
        const texture = { texture: 'swapchain' };
        const error = new Error('Native device is lost');
        class NativeCanvasDouble {
            fail = false;
            readonly texture = texture;
            getCurrentTexture(): typeof texture {
                if (this.fail) throw error;
                return this.texture;
            }
        }
        const descriptor = Object.getOwnPropertyDescriptor(
            NativeCanvasDouble.prototype,
            'getCurrentTexture'
        );
        const restore = installWebGPUCanvasTestGuard(NativeCanvasDouble.prototype, 'unrestricted');
        const canvas = new NativeCanvasDouble();
        expect(canvas.getCurrentTexture()).toBe(texture);
        canvas.fail = true;
        expect(() => canvas.getCurrentTexture()).toThrow(error);
        restore();
        expect(
            Object.getOwnPropertyDescriptor(NativeCanvasDouble.prototype, 'getCurrentTexture')
        ).toEqual(descriptor);
    });

    it('does not require WebGPU globals and does not intercept portable RHI canvas doubles', () => {
        expect(() => {
            installWebGPUCanvasTestGuard(undefined, 'reject-linux-headless-coverage')();
        }).not.toThrow();
        const texture = { texture: 'portable-double' };
        class NativeCanvasDouble {
            getCurrentTexture(): typeof texture {
                return texture;
            }
        }
        const portableCanvas = { getCurrentTexture: vi.fn(() => texture) };
        const restore = installWebGPUCanvasTestGuard(
            NativeCanvasDouble.prototype,
            'reject-linux-headless-coverage'
        );
        try {
            expect(portableCanvas.getCurrentTexture()).toBe(texture);
        } finally {
            restore();
        }
    });
});
