import {
    CanvasText,
    Hierarchy,
    LazyTexture,
    LocalTransform,
    RenderOrder,
    SpriteFrame,
    SpriteRenderer,
    createSpriteRenderer,
    type CanvasTextValue,
    type Entity,
    type LocalTransformValue,
    type SpriteRendererValue,
    type World
} from 'hilo3d';

export async function loadExampleTexture(source: string): Promise<LazyTexture> {
    const texture = new LazyTexture({ src: source, autoLoad: false, flipY: true });
    await texture.load();
    return texture;
}

export function createGridFrames(
    texture: LazyTexture,
    columns: number,
    rows: number
): SpriteFrame[] {
    const width = texture.origWidth / columns;
    const height = texture.origHeight / rows;
    const frames: SpriteFrame[] = [];
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            frames.push(
                new SpriteFrame({
                    texture,
                    x: column * width,
                    y: row * height,
                    width,
                    height
                })
            );
        }
    }
    return frames;
}

export function createSpriteEntity(
    world: World,
    sprite: SpriteRendererValue,
    transform: LocalTransformValue = {},
    order = 0,
    parent?: Entity
): Entity {
    const entity = world.createEntity(LocalTransform, transform);
    if (parent !== undefined) world.add(entity, Hierarchy, { parent });
    world.add(entity, SpriteRenderer, createSpriteRenderer(sprite));
    world.add(entity, RenderOrder, { sortingLayer: order });
    return entity;
}

export function createTextEntity(
    world: World,
    text: CanvasTextValue,
    transform: LocalTransformValue = {},
    order = 100,
    parent?: Entity
): Entity {
    const entity = world.createEntity(LocalTransform, transform);
    if (parent !== undefined) world.add(entity, Hierarchy, { parent });
    world.add(entity, CanvasText, text);
    world.add(entity, RenderOrder, { sortingLayer: order });
    return entity;
}
