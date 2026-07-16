import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const WebGLRenderer = Hilo3d.WebGLRenderer;

describe('WebGLRenderer', () => {
    it('create', () => {
        const renderer = new WebGLRenderer();
        expect(renderer.isWebGLRenderer).toBe(true);
        expect(renderer.className).toBe('WebGLRenderer');
    });

    it('onInit', () => {
        const renderer = new WebGLRenderer({
            domElement: document.createElement('canvas')
        });
        const onInit1 = vi.fn();
        const onInit2 = vi.fn();
        const onInit3 = vi.fn();

        renderer.onInit(onInit1);
        renderer.on('init', onInit2);
        expect(onInit1).toHaveBeenCalledTimes(0);
        expect(onInit2).toHaveBeenCalledTimes(0);
        expect(onInit3).toHaveBeenCalledTimes(0);

        // init context
        renderer.initContext();
        expect(onInit1).toHaveBeenCalledTimes(1);
        expect(onInit2).toHaveBeenCalledTimes(1);
        expect(onInit3).toHaveBeenCalledTimes(0);

        renderer.onInit(onInit3);
        expect(onInit1).toHaveBeenCalledTimes(1);
        expect(onInit2).toHaveBeenCalledTimes(1);
        expect(onInit3).toHaveBeenCalledTimes(1);

        renderer.fire('init');
        expect(onInit1).toHaveBeenCalledTimes(1);
        expect(onInit2).toHaveBeenCalledTimes(2);
        expect(onInit3).toHaveBeenCalledTimes(1);
    });
});
