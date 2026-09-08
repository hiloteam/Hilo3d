import * as Hilo3d from '../../src/Hilo3d';
import type { StudioScene } from './studio2d';

const ASSET_URLS = Object.freeze({
    background: new URL('../image/2d/luminous-garden.png', import.meta.url).href,
    moth: new URL('../image/2d/moon-moth-strip.png', import.meta.url).href,
    seeds: new URL('../image/2d/star-seeds-atlas.png', import.meta.url).href
});

export type MoonlitAssetName = keyof typeof ASSET_URLS;
/** Load one ImageGen-authored example asset into the portable Sprite texture path. */
export async function loadMoonlitTexture(
    name: MoonlitAssetName,
    premultiplyAlpha = false
): Promise<Hilo3d.Texture> {
    const image = await new Hilo3d.BasicLoader().loadImg(ASSET_URLS[name]);
    return new Hilo3d.Texture({
        image,
        internalFormat: Hilo3d.constants.SRGB8_ALPHA8,
        flipY: true,
        premultiplyAlpha,
        minFilter: Hilo3d.constants.webgl.LINEAR,
        magFilter: Hilo3d.constants.webgl.LINEAR,
        wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        name: `Moonlit2D:${name}`
    });
}

/** Build precise atlas frames even when an ImageGen source is not evenly divisible in pixels. */
export function createGridFrames(
    texture: Hilo3d.Texture,
    columns: number,
    rows: number
): Hilo3d.SpriteFrame[] {
    if (
        !Number.isSafeInteger(columns) ||
        columns <= 0 ||
        !Number.isSafeInteger(rows) ||
        rows <= 0
    ) {
        throw new RangeError('Atlas columns and rows must be positive safe integers.');
    }
    const frames: Hilo3d.SpriteFrame[] = [];
    for (let row = 0; row < rows; row += 1) {
        const top = (texture.origHeight * row) / rows;
        const bottom = (texture.origHeight * (row + 1)) / rows;
        for (let column = 0; column < columns; column += 1) {
            const left = (texture.origWidth * column) / columns;
            const right = (texture.origWidth * (column + 1)) / columns;
            frames.push(
                new Hilo3d.SpriteFrame({
                    texture,
                    x: left,
                    y: top,
                    width: right - left,
                    height: bottom - top
                })
            );
        }
    }
    return frames;
}

/** Add one cover-scaled ImageGen background without changing its aspect ratio. */
export function addMoonlitBackground(
    scene: StudioScene,
    texture: Hilo3d.Texture,
    layer = Hilo3d.DEFAULT_2D_LAYER
): Hilo3d.Sprite {
    const background = new Hilo3d.Sprite({
        texture,
        layer,
        pointerEnabled: false,
        autoPlay: false,
        z: -100
    }).addTo(scene.stage);
    background.sortingLayer = -1000;
    scene.addLayout((width, height) => {
        const scale = Math.max(width / texture.origWidth, height / texture.origHeight);
        background.width = texture.origWidth * scale;
        background.height = texture.origHeight * scale;
        background.x = width * 0.5;
        background.y = height * 0.5;
    });
    return background;
}

/** Move Canvas-backed UI text above world and decoration sprite batches. */
export function setTextOrder(text: Hilo3d.Text2D, order: number): Hilo3d.Text2D {
    text.sortingLayer = order;
    return text;
}

/** Require an authored atlas cell before constructing a Sprite. */
export function atlasFrame(
    frames: readonly Hilo3d.SpriteFrame[],
    index: number
): Hilo3d.SpriteFrame {
    const frame = frames[index];
    if (!frame) throw new RangeError(`Atlas frame ${String(index)} is missing.`);
    return frame;
}
