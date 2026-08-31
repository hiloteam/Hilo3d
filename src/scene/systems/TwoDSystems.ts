import { CLAMP_TO_EDGE, LINEAR } from '../../constants/webgl';
import Texture from '../../texture/Texture';
import {
    WORLD_SYSTEM_API_VERSION,
    type WorldSystem,
    type WorldSystemRuntime
} from '../../ecs/System';
import type { ComponentStore } from '../../ecs/Component';
import SpriteFrame from '../../2d/SpriteFrame';
import {
    CanvasText,
    SpriteAnimation,
    SpriteRenderer,
    createSpriteRenderer,
    type CanvasTextValue
} from '../components/TwoD';
import { ChangedComponentStore } from '../components/Rendering';

type TextCanvas = HTMLCanvasElement | OffscreenCanvas;
type TextContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function requireChangedStore<T>(store: ComponentStore<T>, name: string): ChangedComponentStore<T> {
    if (!isChangedStore(store)) {
        throw new TypeError(`${name} requires a changed-component store.`);
    }
    return store;
}

function isChangedStore<T>(store: ComponentStore<T>): store is ChangedComponentStore<T> {
    return store instanceof ChangedComponentStore;
}

function createCanvas(): TextCanvas {
    if (typeof document !== 'undefined') return document.createElement('canvas');
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
    throw new Error('CanvasText requires HTMLCanvasElement or OffscreenCanvas support.');
}

function context2D(canvas: TextCanvas): TextContext {
    const context =
        typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement
            ? canvas.getContext('2d')
            : (canvas as OffscreenCanvas).getContext('2d');
    if (!context) throw new Error('CanvasText could not create a 2D context.');
    return context;
}

function rasterizeText(
    value: CanvasTextValue,
    canvas: TextCanvas,
    texture: Texture<TextCanvas> | undefined
): Texture<TextCanvas> {
    const resolution = value.resolution ?? 1;
    const padding = value.padding ?? 0;
    const context = context2D(canvas);
    context.font = value.font ?? '16px sans-serif';
    const metrics = context.measureText(value.text);
    const logicalWidth = Math.max(1, Math.ceil(metrics.width + padding * 2));
    const logicalHeight = Math.max(
        1,
        Math.ceil(
            (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent || 16) + padding * 2
        )
    );
    canvas.width = Math.max(1, Math.ceil(logicalWidth * resolution));
    canvas.height = Math.max(1, Math.ceil(logicalHeight * resolution));
    const draw = context2D(canvas);
    draw.scale(resolution, resolution);
    draw.font = value.font ?? '16px sans-serif';
    draw.textBaseline = 'top';
    draw.fillStyle = value.fillStyle ?? '#ffffff';
    draw.fillText(value.text, padding, padding);
    if (texture) {
        texture.image = canvas;
        return texture;
    }
    return new Texture<TextCanvas>({
        image: canvas,
        flipY: true,
        premultiplyAlpha: true,
        minFilter: LINEAR,
        magFilter: LINEAR,
        wrapS: CLAMP_TO_EDGE,
        wrapT: CLAMP_TO_EDGE,
        name: `CanvasText:${value.text.slice(0, 32)}`
    });
}

/** Advance sprite frame sequences without per-Entity callbacks. */
export function createSpriteAnimationSystem(): WorldSystem {
    return {
        descriptor: {
            id: 'hilo3d/sprite-animation',
            version: '1.0.0',
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase: 'animation',
            access: { reads: [SpriteAnimation], writes: [SpriteRenderer] }
        },
        setup(context): WorldSystemRuntime {
            const animations = context.world.getStore(SpriteAnimation);
            const sprites = requireChangedStore(
                context.world.getStore(SpriteRenderer),
                'SpriteRenderer'
            );
            const query = context.world.query(SpriteAnimation, SpriteRenderer);
            let elapsed = new Float64Array(context.world.getDiagnostics().entityCapacity);
            let frames = new Uint32Array(context.world.getDiagnostics().entityCapacity);
            const ensureCapacity = (capacity: number): void => {
                if (capacity <= elapsed.length) return;
                const next = Math.max(capacity, elapsed.length * 2, 16);
                const nextElapsed = new Float64Array(next);
                nextElapsed.set(elapsed);
                elapsed = nextElapsed;
                const nextFrames = new Uint32Array(next);
                nextFrames.set(frames);
                frames = nextFrames;
            };
            return {
                execute(execution): void {
                    for (let index = 0; index < query.length; index++) {
                        const entityIndex = query.entityIndices[index] ?? 0;
                        ensureCapacity(entityIndex + 1);
                        const animation = animations.get(entityIndex);
                        if (animation.playing === false || animation.frames.length < 2) continue;
                        elapsed[entityIndex] =
                            (elapsed[entityIndex] ?? 0) + execution.deltaTimeMilliseconds;
                        const frameDuration = 1000 / (animation.frameRate ?? 12);
                        const rawFrame = Math.floor((elapsed[entityIndex] ?? 0) / frameDuration);
                        const nextFrame =
                            animation.loop === false
                                ? Math.min(animation.frames.length - 1, rawFrame)
                                : rawFrame % animation.frames.length;
                        if (frames[entityIndex] === nextFrame + 1) continue;
                        frames[entityIndex] = nextFrame + 1;
                        const current = sprites.get(entityIndex);
                        const frame = animation.frames[nextFrame];
                        if (!frame) continue;
                        if (current.material.texture === frame.texture) {
                            frame.writeUVRect(current.uvRect);
                            sprites.markChangedEntity(entityIndex);
                        } else {
                            sprites.set(
                                entityIndex,
                                createSpriteRenderer({
                                    frame,
                                    width: current.sizeAnchor[0] ?? 1,
                                    height: current.sizeAnchor[1] ?? 1,
                                    anchorX: current.sizeAnchor[2] ?? 0.5,
                                    anchorY: current.sizeAnchor[3] ?? 0.5,
                                    tint: [
                                        current.tint[0] ?? 1,
                                        current.tint[1] ?? 1,
                                        current.tint[2] ?? 1,
                                        current.tint[3] ?? 1
                                    ]
                                })
                            );
                        }
                    }
                }
            };
        }
    };
}

/** Rasterize changed CanvasText components into sprite resources only when authored data changes. */
export function createCanvasTextSystem(): WorldSystem {
    return {
        descriptor: {
            id: 'hilo3d/canvas-text',
            version: '1.0.0',
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase: 'update',
            access: { reads: [CanvasText], writes: [SpriteRenderer] }
        },
        setup(context): WorldSystemRuntime {
            const texts = requireChangedStore(context.world.getStore(CanvasText), 'CanvasText');
            const sprites = context.world.getStore(SpriteRenderer);
            let canvases = new Array<TextCanvas | null>(
                context.world.getDiagnostics().entityCapacity
            ).fill(null);
            let textures = new Array<Texture<TextCanvas> | null>(
                context.world.getDiagnostics().entityCapacity
            ).fill(null);
            return {
                execute(execution): void {
                    for (let index = 0; index < texts.changedEntityCount; index++) {
                        const entityIndex = texts.changedEntityIndices[index] ?? 0;
                        if (entityIndex >= canvases.length) {
                            const next = Math.max(entityIndex + 1, canvases.length * 2, 16);
                            canvases.length = next;
                            canvases.fill(null, entityIndex);
                            textures.length = next;
                            textures.fill(null, entityIndex);
                        }
                        const entity = execution.world.entityAt(entityIndex);
                        if (!texts.has(entityIndex)) {
                            if (sprites.has(entityIndex)) {
                                execution.commands.remove(entity, SpriteRenderer);
                            }
                            textures[entityIndex]?.destroy();
                            textures[entityIndex] = null;
                            canvases[entityIndex] = null;
                            continue;
                        }
                        const canvas = canvases[entityIndex] ?? createCanvas();
                        canvases[entityIndex] = canvas;
                        const texture = rasterizeText(
                            texts.get(entityIndex),
                            canvas,
                            textures[entityIndex] ?? undefined
                        );
                        textures[entityIndex] = texture;
                        const sprite = createSpriteRenderer({
                            frame: SpriteFrame.fromTexture(texture)
                        });
                        if (sprites.has(entityIndex)) {
                            sprites.set(entityIndex, sprite);
                        } else {
                            execution.commands.add(entity, SpriteRenderer, sprite);
                        }
                    }
                    texts.clearChangedEntities();
                },
                destroy(): void {
                    for (const texture of textures) texture?.destroy();
                    canvases = [];
                    textures = [];
                }
            };
        }
    };
}
