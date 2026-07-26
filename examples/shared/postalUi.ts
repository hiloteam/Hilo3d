import * as Hilo3d from '../../src/Hilo3d';

export const POSTAL_UI_FRAME_WIDTH = 384;
export const POSTAL_UI_FRAME_HEIGHT = 144;
export const POSTAL_UI_INSETS = Object.freeze({
    left: 18,
    right: 18,
    top: 18,
    bottom: 18
});

export async function loadPostalUiTexture(): Promise<Hilo3d.Texture> {
    const image = await new Hilo3d.BasicLoader().loadImg(
        new URL('../image/2d/postal-ui-buttons.png', import.meta.url).href
    );
    return new Hilo3d.Texture({
        image,
        flipY: true,
        premultiplyAlpha: true,
        minFilter: Hilo3d.constants.webgl.NEAREST,
        magFilter: Hilo3d.constants.webgl.NEAREST,
        wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        name: 'PostalUI:button-states'
    });
}

export function createPostalButtonFrames(texture: Hilo3d.Texture): Hilo3d.UiButtonFrames {
    const frames = Array.from(
        { length: 4 },
        (_, index) =>
            new Hilo3d.SpriteFrame({
                texture,
                x: index * POSTAL_UI_FRAME_WIDTH,
                y: 0,
                width: POSTAL_UI_FRAME_WIDTH,
                height: POSTAL_UI_FRAME_HEIGHT
            })
    );
    const up = frames[0];
    const hover = frames[1];
    const down = frames[2];
    const disabled = frames[3];
    if (!up || !hover || !down || !disabled) {
        throw new Error('Postal UI atlas is incomplete.');
    }
    return { up, hover, down, disabled };
}

export function createPostalBackground(): Hilo3d.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Postal UI examples require Canvas 2D.');
    const gradient = context.createLinearGradient(0, 0, 32, 32);
    gradient.addColorStop(0, '#173b45');
    gradient.addColorStop(0.55, '#102c38');
    gradient.addColorStop(1, '#091d2b');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
    return new Hilo3d.Texture({
        image: canvas,
        flipY: true,
        premultiplyAlpha: false,
        minFilter: Hilo3d.constants.webgl.LINEAR,
        magFilter: Hilo3d.constants.webgl.LINEAR,
        wrapS: Hilo3d.constants.webgl.REPEAT,
        wrapT: Hilo3d.constants.webgl.REPEAT,
        name: 'PostalUI:background'
    });
}
