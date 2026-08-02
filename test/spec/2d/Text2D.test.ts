import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

describe('Text2D', () => {
    it('rasterizes multiline Canvas 2D text once and refreshes only after a change', () => {
        const text = new Hilo3d.Text2D({
            text: 'Hilo\n2D',
            style: {
                font: '20px sans-serif',
                fillStyle: '#00ffcc',
                padding: 4,
                resolution: 2
            }
        });
        const firstMaterial = text.material;
        const firstTexture = text.frames[0]?.texture;
        const firstTextureRevision = firstTexture?.updateRevision ?? 0;
        const firstWidth = text.width;
        text.renderOrder = 42;

        expect(text.frames).toHaveLength(1);
        expect(text.width).toBeGreaterThan(0);
        expect(text.height).toBeGreaterThan(30);
        expect(text.material).toBe(firstMaterial);
        expect(Object.isFrozen(text.style)).toBe(true);

        text.setText('Hilo3D sprite text');

        expect(text.text).toBe('Hilo3D sprite text');
        expect(text.width).toBeGreaterThan(firstWidth);
        expect(text.material).toBe(firstMaterial);
        expect(text.frames[0]?.texture).toBe(firstTexture);
        expect(text.frames[0]?.texture.updateRevision).toBeGreaterThan(firstTextureRevision);
        expect(text.renderOrder).toBe(42);
        expect(text.useInstanced).toBe(true);
    });

    it('reuses Canvas, Texture, and Material identities across rendered text updates', async () => {
        const stage = await Hilo3d.Stage.create({
            backend: 'webgl2',
            width: 64,
            height: 32,
            pixelRatio: 1,
            camera: new Hilo3d.Camera2D({ width: 64, height: 32 })
        });
        const text = new Hilo3d.Text2D({
            text: 'A',
            style: { font: '16px sans-serif', resolution: 2 },
            x: 4,
            y: 4,
            anchorX: 0,
            anchorY: 0
        }).addTo(stage);
        const material = text.material;
        const texture = text.frames[0]?.texture;

        stage.tick(16);
        text.setText('A wider label');
        stage.tick(16);
        stage.tick(16);

        expect(text.material).toBe(material);
        expect(text.frames[0]?.texture).toBe(texture);
        expect(stage.renderer.renderInfo.drawCount).toBe(1);
        stage.destroy();
    });

    it('wraps measured mixed-language text and supports bounded ellipsis layout', () => {
        const text = new Hilo3d.Text2D({
            text: '枫叶镇 Maple Post 2026 快递服务',
            style: {
                font: '20px sans-serif',
                maxWidth: 120,
                maxLines: 2,
                overflow: 'ellipsis',
                lineHeight: 24,
                letterSpacing: 1,
                paragraphSpacing: 6,
                padding: 4
            }
        });

        expect(text.width).toBe(128);
        expect(text.height).toBe(56);
        expect(text.style.maxWidth).toBe(120);
        expect(text.style.maxLines).toBe(2);

        text.setStyle({ maxWidth: 220, maxLines: 1, wordWrap: false });

        expect(text.width).toBe(228);
        expect(text.height).toBe(32);
        expect(text.frames).toHaveLength(1);
    });
});
