import * as Hilo3d from '../../src/Hilo3d';

/** Source pixel insets enclose the complete gems and scrollwork of both generated skins. */
export const ORNATE_UI_INSETS = Object.freeze({ left: 154, right: 154, top: 140, bottom: 140 });
/** Preserve source pixels while displaying fixed corners at 22 × 20 logical pixels. */
export const ORNATE_UI_SCALE = 1 / 7;
export interface OrnateUiSkin {
    readonly name: string;
    readonly image: HTMLImageElement;
    readonly texture: Hilo3d.Texture;
    readonly frames: Hilo3d.UiButtonFrames;
}

const SKINS = [
    {
        name: 'Astral Guild · 翡翠鎏金',
        url: new URL('../image/2d/astral-guild-ui.png', import.meta.url),
        rects: [
            [38, 88, 694, 344],
            [805, 88, 694, 344],
            [37, 568, 695, 345],
            [805, 568, 694, 345]
        ]
    },
    {
        name: 'Rose Reliquary · 玫瑰秘藏',
        url: new URL('../image/2d/rose-reliquary-ui.png', import.meta.url),
        rects: [
            [17, 109, 732, 326],
            [787, 109, 730, 326],
            [17, 596, 731, 327],
            [787, 597, 730, 326]
        ]
    }
] as const;

/** Load real alpha atlases unchanged; SpriteFrame selects the authored bounds of each state. */
export async function loadOrnateUiSkins(): Promise<readonly OrnateUiSkin[]> {
    return Promise.all(
        SKINS.map(async skin => {
            const image = await new Hilo3d.BasicLoader().loadImg(skin.url.href);
            const texture = new Hilo3d.Texture({
                image,
                flipY: true,
                premultiplyAlpha: false,
                internalFormat: Hilo3d.constants.SRGB8_ALPHA8,
                minFilter: Hilo3d.constants.webgl.LINEAR,
                magFilter: Hilo3d.constants.webgl.LINEAR,
                name: skin.name
            });
            const [up, hover, down, disabled] = skin.rects.map(
                ([x, y, width, height]) => new Hilo3d.SpriteFrame({ texture, x, y, width, height })
            );
            if (!up || !hover || !down || !disabled)
                throw new Error('Ornate UI atlas requires four states.');
            return { name: skin.name, image, texture, frames: { up, hover, down, disabled } };
        })
    );
}
