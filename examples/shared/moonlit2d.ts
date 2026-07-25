import * as Hilo3d from '../../src/Hilo3d';
import { resolveExampleBackend } from './backend';

const ASSET_URLS = Object.freeze({
    background: new URL('../image/2d/moonlit-conservatory.png', import.meta.url).href,
    moth: new URL('../image/2d/moon-moth-strip.png', import.meta.url).href,
    seeds: new URL('../image/2d/star-seeds-atlas.png', import.meta.url).href
});

export type MoonlitAssetName = keyof typeof ASSET_URLS;
export type MoonlitLayout = (width: number, height: number) => void;

export interface MoonlitScene {
    readonly stage: Hilo3d.Stage;
    readonly ticker: Hilo3d.Ticker;
    readonly cameras: readonly Hilo3d.Camera[];
    addLayout(layout: MoonlitLayout): void;
    start(): void;
}

function requireContainer(): HTMLElement {
    const container = document.querySelector<HTMLElement>('#container');
    if (!container) throw new Error('Moonlit 2D example requires #container.');
    return container;
}

/** Load one ImageGen-authored example asset into the portable Sprite texture path. */
export async function loadMoonlitTexture(
    name: MoonlitAssetName,
    premultiplyAlpha = name !== 'background'
): Promise<Hilo3d.Texture> {
    const image = await new Hilo3d.BasicLoader().loadImg(ASSET_URLS[name]);
    return new Hilo3d.Texture({
        image,
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

/** Create a responsive Stage while retaining a single ticker and layout callback array. */
export async function createMoonlitScene(
    cameras: readonly Hilo3d.Camera[] = [
        new Hilo3d.Camera2D({ width: innerWidth, height: innerHeight })
    ]
): Promise<MoonlitScene> {
    const container = requireContainer();
    const stage = await Hilo3d.Stage.create({
        backend: resolveExampleBackend(),
        container,
        cameras,
        width: innerWidth,
        height: innerHeight,
        pixelRatio: Math.min(devicePixelRatio || 1, 2),
        antialias: true,
        alpha: false,
        useInstanced: true,
        clearColor: new Hilo3d.Color(0.008, 0.02, 0.06)
    });
    const ticker = new Hilo3d.Ticker(60);
    const layouts: MoonlitLayout[] = [];
    let started = false;

    const resize = (): void => {
        const width = innerWidth;
        const height = innerHeight;
        stage.resize(width, height);
        for (const camera of cameras) {
            if (camera instanceof Hilo3d.Camera2D) camera.resize(width, height);
            else if (camera instanceof Hilo3d.PerspectiveCamera) camera.aspect = width / height;
        }
        for (const layout of layouts) layout(width, height);
    };
    window.addEventListener('resize', resize);
    resize();

    return {
        stage,
        ticker,
        cameras,
        addLayout(layout): void {
            layouts.push(layout);
            layout(innerWidth, innerHeight);
        },
        start(): void {
            if (started) return;
            started = true;
            ticker.addTick(stage);
            ticker.start();
            document.querySelector<HTMLElement>('#loading')?.remove();
            document.body.dataset['exampleReady'] = 'true';
            console.info(`Moonlit 2D example uses ${stage.renderer.backend}`);
        }
    };
}

/** Add one cover-scaled ImageGen background without changing its aspect ratio. */
export function addMoonlitBackground(
    scene: MoonlitScene,
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
    const material = background.material;
    if (material) material.renderOrder = -1000;
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
    if (text.material) text.material.renderOrder = order;
    return text;
}
