import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

function frame(texture: Hilo3d.Texture, x = 0): Hilo3d.SpriteFrame {
    return new Hilo3d.SpriteFrame({
        texture,
        x,
        y: 0,
        width: 90,
        height: 90
    });
}

describe('SlicedSprite', () => {
    it('preserves corners while resizing nine adjacent batched Sprites', () => {
        const texture = new Hilo3d.Texture({ width: 180, height: 90 });
        const panel = new Hilo3d.SlicedSprite({
            frame: frame(texture),
            insets: { left: 20, right: 20, top: 18, bottom: 18 },
            width: 240,
            height: 120
        });

        expect(panel.parts).toHaveLength(9);
        expect(new Set(panel.parts.map(part => part.material)).size).toBe(1);
        expect(panel.parts.map(part => [part.width, part.height])).toEqual([
            [20, 18],
            [200, 18],
            [20, 18],
            [20, 84],
            [200, 84],
            [20, 84],
            [20, 18],
            [200, 18],
            [20, 18]
        ]);

        panel.setSize(300, 160);

        expect([panel.parts[4]?.width, panel.parts[4]?.height]).toEqual([260, 124]);
        expect([panel.parts[8]?.x, panel.parts[8]?.y]).toEqual([280, 142]);
    });

    it('replaces all nine source frames without recreating part nodes', () => {
        const texture = new Hilo3d.Texture({ width: 180, height: 90 });
        const panel = new Hilo3d.SlicedSprite({
            frame: frame(texture),
            insets: { left: 20, right: 20, top: 20, bottom: 20 }
        });
        const parts = [...panel.parts];

        panel.setFrame(frame(texture, 90));

        expect(panel.parts).toEqual(parts);
        expect(panel.parts[0]?.frames[0]?.x).toBe(90);
    });
});

describe('UiButton', () => {
    it('changes visual state and preserves click events', () => {
        const texture = new Hilo3d.Texture({ width: 360, height: 90 });
        const button = new Hilo3d.UiButton({
            frames: {
                up: frame(texture, 0),
                hover: frame(texture, 90),
                down: frame(texture, 180),
                disabled: frame(texture, 270)
            },
            insets: { left: 20, right: 20, top: 20, bottom: 20 },
            width: 240,
            height: 72,
            label: 'PLAY'
        });
        const onClick = vi.fn();
        button.on('click', onClick);

        button.fire('pointerover');
        expect(button.state).toBe('hover');
        expect(button.parts[0]?.frames[0]?.x).toBe(90);
        const hoverPartFrame = button.parts[0]?.frames[0];
        button.fire('pointerdown');
        expect(button.state).toBe('down');
        button.fire('pointerup');
        expect(button.parts[0]?.frames[0]).toBe(hoverPartFrame);
        button.fire('click');

        expect(button.state).toBe('hover');
        expect(onClick).toHaveBeenCalledOnce();

        button.setEnabled(false);
        button.fire('pointerover');
        expect(button.state).toBe('disabled');
        expect(button.pointerEnabled).toBe(false);
        expect(button.parts.every(part => !part.pointerEnabled)).toBe(true);
    });
});
