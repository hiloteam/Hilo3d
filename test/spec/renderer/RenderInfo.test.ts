import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const RenderInfo = Hilo3d.RenderInfo;

describe('RenderInfo', () => {
    it('creates an empty public snapshot', () => {
        const info = new RenderInfo();
        expect(info.isRenderInfo).toBe(true);
        expect(info.className).toBe('RenderInfo');
        expect(info.faceCount).toBe(0);
        expect(info.drawCount).toBe(0);
    });

    it('publishes accumulated face and draw counts on reset', () => {
        const info = new RenderInfo();
        info.addFaceCount(5);
        info.addFaceCount(3.2);
        info.addDrawCount(1);
        info.addDrawCount(3);

        info.reset();
        expect(info.faceCount).toBe(8);
        expect(info.drawCount).toBe(4);

        info.reset();
        expect(info.faceCount).toBe(0);
        expect(info.drawCount).toBe(0);
    });
});
