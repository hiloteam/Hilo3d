import { describe, expect, it } from 'vitest';
import SpriteFrame from '../../../src/2d/SpriteFrame';
import World from '../../../src/ecs/World';
import Texture from '../../../src/texture/Texture';
import { AnimationClip, Animator } from '../../../src/scene/components/Animation';
import { PointerCapture, PointerTarget } from '../../../src/scene/components/Interaction';
import {
    CanvasText,
    SpriteAnimation,
    SpriteRenderer,
    createSpriteRenderer
} from '../../../src/scene/components/TwoD';
import { Hierarchy, LocalTransform, WorldTransform } from '../../../src/scene/components/Transform';
import { createAnimationSystem } from '../../../src/scene/systems/AnimationSystem';
import {
    INTERACTION_RUNTIME,
    createInteractionSystem
} from '../../../src/scene/systems/InteractionSystem';
import {
    createCanvasTextSystem,
    createSpriteAnimationSystem
} from '../../../src/scene/systems/TwoDSystems';
import { createTransformSystem } from '../../../src/scene/systems/TransformSystem';

describe('ECS scene domain Systems', () => {
    it('samples animation clips into Transform without per-Entity callbacks', async () => {
        const world = await World.create({
            maxDeltaMilliseconds: 1_000,
            systems: [createAnimationSystem(), createTransformSystem()]
        });
        const target = world.createEntity();
        const player = world.createEntity();
        world.add(target, LocalTransform, {});
        world.add(player, Animator, {
            clip: new AnimationClip('move', [
                {
                    target,
                    property: 'translation',
                    times: new Float32Array([0, 1]),
                    values: new Float32Array([0, 0, 0, 10, 4, -2]),
                    width: 3
                }
            ]),
            loop: false
        });

        world.update(500);

        const matrix = world.get(target, WorldTransform).matrix;
        expect(Array.from(matrix.slice(12, 15))).toEqual([5, 2, -1]);
        world.destroy();
    });

    it('delivers explicit target, ancestor propagation, and pointer capture', async () => {
        const world = await World.create({
            systems: [createInteractionSystem(), createTransformSystem()]
        });
        const parent = world.createEntity();
        const child = world.createEntity();
        world.add(parent, LocalTransform, {});
        world.add(parent, PointerTarget, {});
        world.add(child, LocalTransform, {});
        world.add(child, Hierarchy, { parent });
        world.add(child, PointerTarget, { propagation: 'ancestors' });
        world.add(child, PointerCapture, { enabled: true });
        world.update(0);
        const runtime = world.getResource(INTERACTION_RUNTIME);
        runtime.enqueue({ type: 'pointerdown', pointerId: 7, target: child, x: 1, y: 2 });
        world.update(0);
        expect(runtime.drain().map(event => event.currentTarget)).toEqual([child, parent]);

        runtime.enqueue({ type: 'pointermove', pointerId: 7, target: null, x: 3, y: 4 });
        world.update(0);
        expect(runtime.drain().map(event => event.currentTarget)).toEqual([child, parent]);
        world.destroy();
    });

    it('advances atlas frames and rasterizes CanvasText through component changes', async () => {
        const texture = new Texture({
            width: 2,
            height: 1,
            image: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])
        });
        const first = new SpriteFrame({ texture, x: 0, y: 0, width: 1, height: 1 });
        const second = new SpriteFrame({ texture, x: 1, y: 0, width: 1, height: 1 });
        const world = await World.create({
            systems: [createCanvasTextSystem(), createSpriteAnimationSystem()]
        });
        const sprite = world.createEntity();
        world.add(sprite, SpriteRenderer, createSpriteRenderer({ frame: first }));
        world.add(sprite, SpriteAnimation, { frames: [first, second], frameRate: 10 });
        const spriteRecord = world.get(sprite, SpriteRenderer);
        const text = world.createEntity();
        world.add(text, CanvasText, { text: 'ECS', padding: 2 });

        world.update(100);

        expect(world.get(sprite, SpriteRenderer).uvRect[0]).toBe(0.5);
        expect(world.get(sprite, SpriteRenderer)).toBe(spriteRecord);
        expect(world.has(text, SpriteRenderer)).toBe(true);
        world.destroy();
        texture.destroy();
    });
});
