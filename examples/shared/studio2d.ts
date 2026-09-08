import * as Hilo3d from '../../src/Hilo3d';
import { resolveExampleBackend } from './backend';

const EXHIBITS = [
    [
        '2d_sprite_animation',
        'Luminous garden',
        '精灵动画',
        'A little light, brought to life.',
        '逐帧动画、透明图集与 2D / 3D 多相机合成。'
    ],
    [
        '2d_sprite_batch',
        'Stardust atelier',
        '精灵合批',
        'Thousands of tiny possibilities.',
        '同一张图集，数千个独立的变换、颜色与透明度。'
    ],
    [
        '2d_text',
        'Letters to the moon',
        '动态文字',
        'Every word has a little magic.',
        'Canvas 文字栅格化、描边、动态内容与交互命中。'
    ],
    [
        '2d_text_layout',
        'The field journal',
        '文字排版',
        'Room for every kind of story.',
        '中英混排、实测宽度换行、字距、段落和省略号。'
    ],
    [
        '2d_ui_button',
        'The travel bureau',
        '九宫格 UI',
        'Small details. Endless dimensions.',
        '九宫格保留圆角与边线，按钮响应真实指针状态。'
    ],
    [
        '2d_sorting_town',
        'Maple afternoon',
        '层级排序',
        'A world with a sense of place.',
        '脚底 Y 排序、序列帧行走、A* 寻路与场景树。'
    ]
] as const;

export interface Studio {
    readonly container: HTMLElement;
    readonly inspector: HTMLElement;
    readonly transport: HTMLElement;
    readonly status: HTMLElement;
    section(title: string, description?: string): void;
    range(
        label: string,
        min: number,
        max: number,
        value: number,
        step: number,
        change: (value: number) => void,
        unit?: string
    ): HTMLInputElement;
    select(
        label: string,
        choices: readonly string[],
        value: string,
        change: (value: string) => void
    ): HTMLSelectElement;
    toggle(label: string, value: boolean, change: (value: boolean) => void): HTMLInputElement;
    button(label: string, action: () => void): HTMLButtonElement;
    metric(label: string, value: string): HTMLOutputElement;
    ready(backend: string): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text = ''
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

/** Shared gallery chrome. The exhibit itself is always a renderer-owned canvas. */
export function createStudio(index: number): Studio {
    const exhibit = EXHIBITS[index];
    if (!exhibit) throw new RangeError('Unknown 2D exhibit.');
    document.body.classList.add('studio');
    document.body.dataset['exhibit'] = exhibit[0];
    document.title = `${exhibit[1]} · Hilo3D 2D Studio`;
    const container = document.querySelector<HTMLElement>('#container');
    if (!container) throw new Error('2D Studio requires #container.');
    const header = element('header', 'studio-header');
    const brand = element('a', 'studio-brand');
    brand.href = './list.html#2d';
    brand.innerHTML =
        '<span class="studio-mark">h.</span><span>HILO3D <small>CREATIVE ENGINE</small></span>';
    const edition = element('span', 'studio-edition', 'THE 2D COLLECTION / VOL. 01');
    const backend = element('select', 'studio-backend');
    backend.setAttribute('aria-label', 'Rendering backend');
    for (const value of ['auto', 'webgl2', 'webgpu'])
        backend.add(new Option(value.toUpperCase(), value));
    backend.value = resolveExampleBackend();
    backend.addEventListener('change', () => {
        const url = new URL(location.href);
        url.searchParams.set('backend', backend.value);
        location.assign(url.href);
    });
    header.append(brand, edition, backend);
    const nav = element('nav', 'studio-nav');
    nav.setAttribute('aria-label', '2D exhibits');
    EXHIBITS.forEach(([path, , name], exhibitIndex) => {
        const link = element('a', 'studio-tab');
        const url = new URL(`./${path}.html`, location.href);
        url.search = location.search;
        link.href = url.href;
        link.innerHTML = `<span>0${String(exhibitIndex + 1)}</span>${name}`;
        if (exhibitIndex === index) link.setAttribute('aria-current', 'page');
        nav.append(link);
    });
    const intro = element('div', 'studio-intro');
    const heading = element('div', 'studio-heading');
    heading.append(
        element('p', 'studio-kicker', `INTERACTIVE STUDY  /  0${String(index + 1)}`),
        element('h1', '', exhibit[1])
    );
    intro.append(heading, element('p', 'studio-description', exhibit[4]));
    const main = element('main', 'studio-main');
    const viewport = element('section', 'studio-viewport');
    viewport.setAttribute('aria-label', exhibit[1]);
    const canvasWrap = element('div', 'studio-canvas-wrap');
    canvasWrap.append(container);
    const transport = element('div', 'studio-transport');
    const status = element('span', 'studio-status', exhibit[3]);
    status.setAttribute('role', 'status');
    transport.append(status);
    viewport.append(canvasWrap, transport);
    const inspector = element('aside', 'studio-inspector');
    inspector.setAttribute('aria-label', 'Exhibit controls');
    main.append(viewport, inspector);
    const footer = element('footer', 'studio-footer');
    footer.append(
        element('span', '', 'Hilo3D / 2D Studio'),
        element('span', '', 'SPRITES · TYPE · INTERACTION'),
        element('span', 'studio-live', 'INITIALIZING')
    );
    document.body.append(header, nav, intro, main, footer);
    const activeTab = nav.querySelector<HTMLElement>('[aria-current]');
    if (activeTab) nav.scrollLeft = activeTab.offsetLeft - nav.offsetLeft - nav.clientWidth / 3;

    let serial = 0;
    const field = (label: string): HTMLLabelElement => {
        const row = element('label', 'studio-field');
        row.append(element('span', 'studio-field-label', label));
        inspector.append(row);
        return row;
    };
    return {
        container,
        inspector,
        transport,
        status,
        section(title, description): void {
            const section = element('div', 'studio-section');
            section.append(element('h2', '', title));
            if (description) section.append(element('p', '', description));
            inspector.append(section);
        },
        range(label, min, max, value, step, change, unit = ''): HTMLInputElement {
            const row = field(label);
            const input = element('input', 'studio-range');
            input.id = `studio-control-${String(serial++)}`;
            input.type = 'range';
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.value = String(value);
            input.setAttribute('aria-label', label);
            const output = element('output', 'studio-value', `${String(value)}${unit}`);
            output.htmlFor = input.id;
            row.append(output, input);
            input.addEventListener('input', () => {
                output.value = `${input.value}${unit}`;
                change(input.valueAsNumber);
            });
            return input;
        },
        select(label, choices, value, change): HTMLSelectElement {
            const row = field(label);
            const select = element('select', 'studio-select');
            select.setAttribute('aria-label', label);
            choices.forEach(choice => {
                select.add(new Option(choice, choice));
            });
            select.value = value;
            select.addEventListener('change', () => {
                change(select.value);
            });
            row.append(select);
            return select;
        },
        toggle(label, value, change): HTMLInputElement {
            const row = field(label);
            row.classList.add('studio-switch');
            const input = element('input', '');
            input.type = 'checkbox';
            input.checked = value;
            input.addEventListener('change', () => {
                change(input.checked);
            });
            row.append(input);
            return input;
        },
        button(label, action): HTMLButtonElement {
            const button = element('button', 'studio-button', label);
            button.type = 'button';
            button.addEventListener('click', action);
            inspector.append(button);
            return button;
        },
        metric(label, value): HTMLOutputElement {
            const row = element('div', 'studio-metric');
            const output = element('output', '', value);
            row.append(element('span', '', label), output);
            inspector.append(row);
            return output;
        },
        ready(activeBackend): void {
            document.querySelector<HTMLElement>('#loading')?.remove();
            document.body.dataset['exampleReady'] = 'true';
            document.body.dataset['backend'] = activeBackend;
            const live = footer.querySelector('.studio-live');
            if (live) live.textContent = `${activeBackend.toUpperCase()} / LIVE`;
        }
    };
}

export interface StudioScene {
    readonly stage: Hilo3d.Stage;
    readonly ticker: Hilo3d.Ticker;
    readonly studio: Studio;
    addLayout(layout: (width: number, height: number) => void): void;
    start(): void;
}

/** Resize from the actual canvas pane, including responsive chrome and embedded galleries. */
export async function createStudioScene(
    studio: Studio,
    cameras?: readonly Hilo3d.Camera[]
): Promise<StudioScene> {
    const activeCameras = cameras ?? [new Hilo3d.Camera2D({ width: 1000, height: 620 })];
    const stage = await Hilo3d.Stage.create({
        backend: resolveExampleBackend(),
        container: studio.container,
        cameras: activeCameras,
        width: Math.max(1, studio.container.clientWidth),
        height: Math.max(1, studio.container.clientHeight),
        pixelRatio: Math.min(devicePixelRatio || 1, 2),
        antialias: true,
        alpha: false,
        useInstanced: true,
        clearColor: new Hilo3d.Color(0.009, 0.026, 0.033)
    });
    const ticker = new Hilo3d.Ticker(60);
    const layouts: ((width: number, height: number) => void)[] = [];
    const resize = (): void => {
        const width = Math.max(1, studio.container.clientWidth);
        const height = Math.max(1, studio.container.clientHeight);
        stage.resize(width, height);
        for (const camera of activeCameras) {
            if (camera instanceof Hilo3d.Camera2D) camera.resize(width, height);
            if (camera instanceof Hilo3d.PerspectiveCamera) camera.aspect = width / height;
        }
        for (const layout of layouts) layout(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(studio.container);
    let started = false;
    window.addEventListener('pagehide', () => {
        ticker.pause();
        observer.disconnect();
    });
    window.addEventListener('pageshow', event => {
        if (event.persisted) {
            observer.observe(studio.container);
            ticker.resume();
        }
    });
    return {
        stage,
        ticker,
        studio,
        addLayout(layout): void {
            layouts.push(layout);
            layout(studio.container.clientWidth, studio.container.clientHeight);
        },
        start(): void {
            if (started) return;
            started = true;
            resize();
            ticker.addTick(stage);
            ticker.start();
            studio.ready(stage.renderer.backend);
        }
    };
}

/** Canvas-native vector UI atlas: uniform edges and isolated corners remain valid at every size. */
export function createStudioAtlas(): {
    texture: Hilo3d.Texture;
    frames: Hilo3d.UiButtonFrames;
    paper: Hilo3d.SpriteFrame;
    dark: Hilo3d.SpriteFrame;
    line: Hilo3d.SpriteFrame;
} {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D Studio requires Canvas 2D.');
    const palettes = [
        ['#dfb879', '#f6dcaa'],
        ['#f4d598', '#fff0cb'],
        ['#bf9560', '#e0b67d'],
        ['#546460', '#697873'],
        ['#f6f0e3', '#e1d7c3'],
        ['#122d31', '#446161']
    ];
    palettes.forEach(([fill, stroke], index) => {
        context.fillStyle = fill ?? '#fff';
        context.strokeStyle = stroke ?? '#fff';
        context.lineWidth = 1.5;
        context.beginPath();
        context.roundRect(index * 128 + 2, 2, 124, 124, 15);
        context.fill();
        context.stroke();
        // Small corner pins stay completely within the non-stretching 20 px regions.
        context.fillStyle = stroke ?? '#fff';
        for (const x of [12, 116]) {
            for (const y of [12, 116]) {
                context.beginPath();
                context.arc(index * 128 + x, y, 2, 0, Math.PI * 2);
                context.fill();
            }
        }
    });
    const texture = new Hilo3d.Texture({
        image: canvas,
        flipY: true,
        premultiplyAlpha: false,
        internalFormat: Hilo3d.constants.SRGB8_ALPHA8,
        minFilter: Hilo3d.constants.webgl.LINEAR,
        magFilter: Hilo3d.constants.webgl.LINEAR
    });
    const frames = palettes.map(
        (_, index) =>
            new Hilo3d.SpriteFrame({ texture, x: index * 128, y: 0, width: 128, height: 128 })
    );
    const [up, hover, down, disabled, paper, dark] = frames;
    if (!up || !hover || !down || !disabled || !paper || !dark)
        throw new Error('Studio UI atlas is incomplete.');
    return {
        texture,
        frames: { up, hover, down, disabled },
        paper,
        dark,
        line: new Hilo3d.SpriteFrame({ texture, x: 32, y: 32, width: 1, height: 1 })
    };
}

export const STUDIO_INSETS = Object.freeze({ left: 20, right: 20, top: 20, bottom: 20 });

export function studioText(
    parent: Hilo3d.Node,
    text: string,
    x: number,
    y: number,
    style: Hilo3d.Text2DStyle = {}
): Hilo3d.Text2D {
    const label = new Hilo3d.Text2D({
        text,
        x,
        y,
        anchorX: 0,
        anchorY: 0,
        sortingLayer: 100,
        pointerEnabled: false,
        style: {
            font: '15px system-ui, sans-serif',
            fillStyle: '#ebdfc5',
            resolution: 2,
            padding: 3,
            ...style
        }
    }).addTo(parent);
    setStudioTextColor(label);
    return label;
}

export function fitStudioRoot(
    scene: StudioScene,
    root: Hilo3d.Node,
    designWidth = 1000,
    designHeight = 620
): void {
    scene.addLayout((width, height) => {
        const scale = Math.min(width / designWidth, height / designHeight);
        root.setScale(scale);
        root.setPosition((width - designWidth * scale) / 2, (height - designHeight * scale) / 2, 0);
    });
}

/** Authored CSS colors are sRGB; decode them once before the linear composition target. */
export function setStudioTextColor(label: Hilo3d.Text2D): void {
    const frame = label.frames[0];
    if (frame) frame.texture.internalFormat = Hilo3d.constants.SRGB8_ALPHA8;
}
