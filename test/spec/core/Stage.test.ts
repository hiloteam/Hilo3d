import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Stage = Hilo3d.Stage;
const WebGLRenderer = Hilo3d.WebGLRenderer;

describe('Stage', () => {
    it('create', () => {
        const stage = new Stage({});
        expect(stage.isStage).toBe(true);
        expect(stage.className).toBe('Stage');
        expect(stage.width).toBe(innerWidth);
        expect(stage.height).toBe(innerHeight);
        expect(stage.pixelRatio).toBeGreaterThanOrEqual(1);
        expect(stage.pixelRatio).toBeLessThanOrEqual(2);
        expect(stage.renderer).toBeInstanceOf(WebGLRenderer);
    });

    it('resize', () => {
        const stage = new Stage({
            width: 800,
            height: 600
        });

        stage.resize(1000, 800, 2);
        expect(stage.width).toBe(1000);
        expect(stage.height).toBe(800);
        expect(stage.pixelRatio).toBe(2);
        expect(stage.rendererWidth).toBe(2000);
        expect(stage.rendererHeight).toBe(1600);
        expect(stage.canvas.style.width).toBe('1000px');
        expect(stage.canvas.style.height).toBe('800px');
    });
});
