import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from 'playwright';
import { installRenderHealthProbe } from '../../test/ui/render-health';
import { captureStableFrame } from '../../test/ui/stable-capture';
import { PNG } from 'pngjs';

const activeCaptures = new WeakSet<Page>();
const captureDiagnostics = new WeakMap<Page, string[]>();

/** Local editor observations; these are never enrolled RHI regression-baseline evidence. */
interface FrameProbe {
    recording: boolean;
    samples: { interval: number; cpu: number }[];
    draws: number;
    instancedDraws: number;
    lastTime: number;
}
interface CaptureControl {
    waitForFrames(count: number): Promise<void>;
    pause(): Promise<void>;
    resume(): void;
}
type ProbeWindow = Window & {
    __EDITOR_LOCAL_BENCHMARK__?: FrameProbe;
    __HILO3D_TEST_CAPTURE__?: CaptureControl;
};
type Backend = 'webgl2' | 'webgpu';
interface AdapterSummary {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
    isFallbackAdapter?: boolean;
}
interface GPUProbe {
    requestAdapter(): Promise<{ info?: AdapterSummary; isFallbackAdapter?: boolean } | null>;
}
interface Options {
    origin: string;
    profile: 'native' | 'software';
    output: string;
    smokeOnly: boolean;
    authoringSmoke: boolean;
    counts: readonly (300 | 1000)[];
    browsers: 'chromium' | 'firefox' | 'webkit' | 'all';
}

function options(): Options {
    const values = new Map(
        process.argv.slice(2).map(argument => {
            const [name, ...value] = argument.replace(/^--/u, '').split('=');
            return [name ?? '', value.join('=') || 'true'];
        })
    );
    const profile = values.get('profile') ?? 'native';
    const browsers = values.get('browsers') ?? 'chromium';
    if (profile !== 'native' && profile !== 'software')
        throw new Error('profile must be native or software');
    if (
        browsers !== 'chromium' &&
        browsers !== 'firefox' &&
        browsers !== 'webkit' &&
        browsers !== 'all'
    )
        throw new Error('browsers must be chromium, firefox, webkit or all');
    const origin = values.get('origin') ?? 'http://127.0.0.1:5174';
    const url = new URL(origin);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        throw new Error('Benchmark origin must be a local editor server.');
    return {
        origin,
        profile,
        browsers,
        smokeOnly: values.has('smoke-only'),
        authoringSmoke: values.has('authoring-smoke'),
        counts: (values.get('counts') ?? '300,1000').split(',').map(value => {
            if (value === '300') return 300;
            if (value === '1000') return 1000;
            throw new Error('counts accepts300 and1000');
        }),
        output: resolve(values.get('output') ?? `reports/editor/benchmark-${profile}.json`)
    };
}

function percentile(values: readonly number[], fraction: number): number | null {
    if (values.length === 0) return null;
    const ordered = [...values].sort((a, b) => a - b);
    return Math.round((ordered[Math.floor((ordered.length - 1) * fraction)] ?? 0) * 100) / 100;
}

function sceneSource(count: number): string {
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    return JSON.stringify({
        format: 'hilo3d-scene',
        version: 2,
        name: `Editor benchmark ${String(count)}`,
        units: 'meters',
        environment: { background: '#343639', ambientIntensity: 1 },
        materials: {
            shared: { name: 'Shared clay', color: '#be7957', metallic: 0.05, roughness: 0.72 }
        },
        nodes: Object.fromEntries(
            Array.from({ length: count }, (_, index) => [
                `item-${String(index).padStart(4, '0')}`,
                {
                    name: `Object ${String(index).padStart(4, '0')}`,
                    type: 'mesh',
                    geometry: 'cube',
                    material: 'shared',
                    parent: null,
                    visible: true,
                    transform: {
                        position: {
                            x: ((index % columns) - (columns - 1) / 2) * 1.1,
                            y: 0.4,
                            z: (Math.floor(index / columns) - (rows - 1) / 2) * 1.1
                        },
                        rotation: { x: 0, y: 0, z: 0 },
                        scale: { x: 0.7, y: 0.7, z: 0.7 }
                    }
                }
            ])
        )
    });
}

async function installProbe(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const probe: FrameProbe = {
            recording: false,
            samples: [],
            draws: 0,
            instancedDraws: 0,
            lastTime: 0
        };
        (window as ProbeWindow).__EDITOR_LOCAL_BENCHMARK__ = probe;
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback =>
            raf(timestamp => {
                const started = performance.now();
                callback(timestamp);
                if (probe.recording && probe.samples.length < 1000) {
                    if (probe.lastTime !== 0)
                        probe.samples.push({
                            interval: timestamp - probe.lastTime,
                            cpu: performance.now() - started
                        });
                    probe.lastTime = timestamp;
                }
            });
        const instrument = (constructorName: string, methods: readonly string[]): void => {
            const constructor: unknown = Reflect.get(globalThis, constructorName);
            if (typeof constructor !== 'function') return;
            const prototype: unknown = Reflect.get(constructor, 'prototype');
            if (!prototype || typeof prototype !== 'object') return;
            for (const method of methods) {
                const native: unknown = Reflect.get(prototype, method);
                if (typeof native !== 'function') continue;
                Object.defineProperty(prototype, method, {
                    configurable: true,
                    writable: true,
                    value(this: object, ...parameters: unknown[]): unknown {
                        const result: unknown = Reflect.apply(native, this, parameters);
                        if (probe.recording) {
                            probe.draws++;
                            if (
                                method.includes('Instanced') ||
                                ((method === 'draw' || method === 'drawIndexed') &&
                                    typeof parameters[1] === 'number' &&
                                    parameters[1] > 1)
                            )
                                probe.instancedDraws++;
                        }
                        return result;
                    }
                });
            }
        };
        instrument('WebGL2RenderingContext', [
            'drawArrays',
            'drawElements',
            'drawArraysInstanced',
            'drawElementsInstanced'
        ]);
        instrument('GPURenderPassEncoder', [
            'draw',
            'drawIndexed',
            'drawIndirect',
            'drawIndexedIndirect'
        ]);
    });
}

async function environment(page: Page): Promise<object> {
    return page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        const renderer: unknown =
            gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
        const provider = Reflect.get(navigator, 'gpu') as GPUProbe | undefined;
        let adapter: object | null = null;
        if (provider) {
            try {
                const selected = await provider.requestAdapter();
                if (selected)
                    adapter = {
                        vendor: selected.info?.vendor ?? null,
                        architecture: selected.info?.architecture ?? null,
                        device: selected.info?.device ?? null,
                        description: selected.info?.description ?? null,
                        isFallbackAdapter:
                            selected.isFallbackAdapter ?? selected.info?.isFallbackAdapter ?? null
                    };
            } catch {
                /* Adapter support is recorded independently of the requested renderer. */
            }
        }
        return {
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            devicePixelRatio,
            webglRenderer: typeof renderer === 'string' ? renderer : null,
            offeredWebGPUAdapter: adapter
        };
    });
}

async function frames(page: Page, count = 2): Promise<void> {
    await page.evaluate(async requested => {
        const capture = (window as ProbeWindow).__HILO3D_TEST_CAPTURE__;
        if (!capture) throw new Error('Editor frame capture is unavailable.');
        await Promise.race([
            capture.waitForFrames(requested),
            new Promise<never>((_resolve, reject) =>
                setTimeout(() => {
                    reject(new Error('Rendered frames did not progress within 15 seconds.'));
                }, 15_000)
            )
        ]);
        await capture.pause();
        capture.resume();
    }, count);
}

async function openEditor(
    browser: Browser,
    origin: string,
    backend: Backend,
    benchmark: boolean
): Promise<{ page: Page; errors: string[]; ready: boolean }> {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC'
    });
    const errors: string[] = [];
    page.on('pageerror', cause => {
        errors.push(cause.message);
        process.stderr.write(`PAGE ERROR: ${cause.message}\n`);
    });
    page.on('console', entry => {
        if (entry.type() !== 'error') return;
        const text = entry.text();
        // WebKit enforces the opaque worker-frame CSP even against Playwright's temporary
        // screenshot caret/animation stylesheet. Preserve this diagnostic in the report; do not
        // relax production CSP or ignore any graphics/application error.
        if (
            activeCaptures.has(page) &&
            text ===
                "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' appears in neither the style-src directive nor the default-src directive of the Content Security Policy."
        ) {
            const diagnostics = captureDiagnostics.get(page) ?? [];
            diagnostics.push(text);
            captureDiagnostics.set(page, diagnostics);
            return;
        }
        errors.push(text);
        process.stderr.write(`CONSOLE ERROR: ${text}\n`);
    });
    await installProbe(page);
    if (!benchmark) await installRenderHealthProbe(page);
    await page.goto(
        `${origin}/editor/?backend=${backend}&test=1${benchmark ? '&benchmark=1' : ''}`
    );
    try {
        await page.waitForFunction(
            () =>
                document.querySelector('#app')?.getAttribute('data-ready') === 'true' ||
                document
                    .querySelector('#viewport-loading')
                    ?.textContent.includes('Renderer unavailable'),
            undefined,
            { timeout: 30_000 }
        );
    } catch (cause) {
        const state = await page.locator('body').innerText();
        await page.screenshot({ path: resolve(`reports/editor/failure-${backend}.png`) });
        await page.close();
        throw new Error(
            `${cause instanceof Error ? cause.message : String(cause)}\n${errors.join('\n')}\n${state.slice(-2500)}`,
            { cause }
        );
    }
    return {
        page,
        errors,
        ready: (await page.locator('#app').getAttribute('data-ready')) === 'true'
    };
}

async function measure(
    browser: Browser,
    settings: Options,
    backend: Backend,
    count: number
): Promise<object> {
    const { page, errors, ready } = await openEditor(browser, settings.origin, backend, true);
    try {
        const device = await environment(page);
        if (!ready)
            return {
                backend,
                count,
                status: 'unsupported',
                reason: await page.locator('#viewport-loading').textContent(),
                device,
                errors
            };
        if ((await page.locator('#backend-label').innerText()).toLowerCase() !== backend)
            throw new Error('Requested backend silently changed.');
        await page.locator('[data-action="source"]').first().click();
        await page.locator('#scene-source').fill(sceneSource(count));
        const importStart = performance.now();
        await page.locator('[data-action="apply-source"]').click();
        await page.locator('#source-dialog').waitFor({ state: 'hidden' });
        await frames(page, 3);
        const importMs = performance.now() - importStart;
        await page
            .getByRole('button', { name: 'Frame selection (F)', exact: true })
            .first()
            .click();
        await frames(page, 3);
        await page.evaluate(() => {
            const probe = (window as ProbeWindow).__EDITOR_LOCAL_BENCHMARK__;
            if (!probe) throw new Error('Missing performance probe.');
            probe.samples = [];
            probe.draws = 0;
            probe.instancedDraws = 0;
            probe.lastTime = 0;
            probe.recording = true;
        });
        await page.waitForTimeout(3000);
        const sample = await page.evaluate(async () => {
            const probe = (window as ProbeWindow).__EDITOR_LOCAL_BENCHMARK__;
            const capture = (window as ProbeWindow).__HILO3D_TEST_CAPTURE__;
            if (!probe || !capture) throw new Error('Missing capture state.');
            probe.recording = false;
            const start = performance.now();
            await capture.pause();
            const gpuDrainMs = performance.now() - start;
            capture.resume();
            return {
                samples: probe.samples,
                draws: probe.draws,
                instancedDraws: probe.instancedDraws,
                gpuDrainMs
            };
        });
        await page.locator('[data-select="item-0000"]').click();
        const input = page.locator('[data-field="position.x"]');
        const initial = Number(await input.inputValue());
        const edits: number[] = [];
        const undos: number[] = [];
        for (let index = 0; index < 3; index++) {
            const started = performance.now();
            await input.fill(String(initial + 0.2));
            await input.press('Tab');
            await frames(page);
            edits.push(performance.now() - started);
            const undoStarted = performance.now();
            await page.locator('#undo').click();
            await frames(page);
            undos.push(performance.now() - undoStarted);
            if (Math.abs(Number(await input.inputValue()) - initial) > 1e-5)
                throw new Error('Undo did not restore the edited transform.');
        }
        if (sample.draws < 1 || sample.samples.length < 3)
            throw new Error('Benchmark did not observe native render commands and live frames.');
        if (errors.length > 0) throw new Error(errors.join('\n'));
        return {
            backend,
            count,
            status: 'passed',
            device,
            importMs: Math.round(importMs),
            frameSamples: sample.samples.length,
            frameCallbackCpuMs: {
                median: percentile(
                    sample.samples.map(value => value.cpu),
                    0.5
                ),
                p95: percentile(
                    sample.samples.map(value => value.cpu),
                    0.95
                )
            },
            frameIntervalMs: {
                median: percentile(
                    sample.samples.map(value => value.interval),
                    0.5
                ),
                p95: percentile(
                    sample.samples.map(value => value.interval),
                    0.95
                )
            },
            nativeDrawsPerSample: Math.round((sample.draws / sample.samples.length) * 100) / 100,
            nativeInstancedDraws: sample.instancedDraws,
            gpuDrainMs: Math.round(sample.gpuDrainMs * 100) / 100,
            editToTwoCompletedFramesMs: {
                median: percentile(edits, 0.5),
                samples: edits.map(value => Math.round(value))
            },
            undoToTwoCompletedFramesMs: {
                median: percentile(undos, 0.5),
                samples: undos.map(value => Math.round(value))
            },
            errors
        };
    } finally {
        await page.close();
    }
}

async function currentSceneSource(page: Page): Promise<string> {
    await page.getByRole('button', { name: 'Scene JSON', exact: true }).click();
    const source = await page.locator('#scene-source').inputValue();
    await page
        .locator('#source-dialog')
        .getByRole('button', { name: 'Close dialog', exact: true })
        .click();
    return source;
}

async function stableFrame(page: Page, backend: Backend, frameCount = 0): Promise<Buffer> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    activeCaptures.add(page);
    try {
        return await Promise.race([
            captureStableFrame(page, backend, { frames: frameCount }),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new Error('Stable rendered capture did not complete within15seconds.'));
                }, 15000);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
        activeCaptures.delete(page);
    }
}

async function viewportPixels(page: Page, backend: Backend): Promise<Buffer> {
    const box = await page.locator('#viewport canvas').boundingBox();
    if (!box) throw new Error('Viewport canvas is unavailable.');
    const image = PNG.sync.read(await stableFrame(page, backend, 2));
    const width = Math.floor(box.width) - 2;
    const height = Math.floor(box.height) - 2;
    const output = Buffer.alloc(width * height * 4);
    for (let row = 0; row < height; row++) {
        const offset = ((Math.ceil(box.y) + row) * image.width + Math.ceil(box.x)) * 4;
        image.data.copy(output, row * width * 4, offset, offset + width * 4);
    }
    return output;
}

function pixelChanges(a: Buffer, b: Buffer): number {
    if (a.length !== b.length) throw new Error('Viewport changed size during capture.');
    let count = 0;
    for (let index = 0; index < a.length; index += 4) {
        if (
            Math.abs((a[index] ?? 0) - (b[index] ?? 0)) +
                Math.abs((a[index + 1] ?? 0) - (b[index + 1] ?? 0)) +
                Math.abs((a[index + 2] ?? 0) - (b[index + 2] ?? 0)) >
            45
        )
            count++;
    }
    return count;
}

function quadGLB(): Buffer {
    const positions = new Float32Array([-0.6, 0, 0, 0.6, 0, 0, 0.6, 1.2, 0, -0.6, 1.2, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const json = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'Compatibility quad', mesh: 0 }],
        meshes: [
            {
                primitives: [
                    {
                        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
                        indices: 3,
                        material: 0
                    }
                ]
            }
        ],
        materials: [
            {
                doubleSided: true,
                pbrMetallicRoughness: {
                    baseColorFactor: [0.9, 0.25, 0.1, 1],
                    metallicFactor: 0,
                    roughnessFactor: 0.6
                }
            }
        ],
        buffers: [{ byteLength: 140 }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 48 },
            { buffer: 0, byteOffset: 48, byteLength: 48 },
            { buffer: 0, byteOffset: 96, byteLength: 32 },
            { buffer: 0, byteOffset: 128, byteLength: 12 }
        ],
        accessors: [
            {
                bufferView: 0,
                componentType: 5126,
                count: 4,
                type: 'VEC3',
                min: [-0.6, 0, 0],
                max: [0.6, 1.2, 0]
            },
            { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
            { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
            { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' }
        ]
    };
    const text = Buffer.from(JSON.stringify(json));
    const padded = Math.ceil(text.length / 4) * 4;
    const result = Buffer.alloc(28 + padded + 140);
    result.writeUInt32LE(0x46546c67, 0);
    result.writeUInt32LE(2, 4);
    result.writeUInt32LE(result.length, 8);
    result.writeUInt32LE(padded, 12);
    result.writeUInt32LE(0x4e4f534a, 16);
    result.fill(32, 20, 20 + padded);
    text.copy(result, 20);
    result.writeUInt32LE(140, 20 + padded);
    result.writeUInt32LE(0x004e4942, 24 + padded);
    Buffer.from(positions.buffer).copy(result, 28 + padded);
    Buffer.from(normals.buffer).copy(result, 76 + padded);
    Buffer.from(uv.buffer).copy(result, 124 + padded);
    Buffer.from(indices.buffer).copy(result, 156 + padded);
    return result;
}

function checkerPNG(): Buffer {
    const image = new PNG({ width: 4, height: 4 });
    for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
            const index = (y * 4 + x) * 4;
            image.data[index] = y < 2 ? 245 : 20;
            image.data[index + 1] = x < 2 ? 40 : 190;
            image.data[index + 2] = y < 2 ? 15 : 240;
            image.data[index + 3] = 255;
        }
    return PNG.sync.write(image);
}

async function authoringSmoke(page: Page, backend: Backend): Promise<object> {
    await page.locator('[data-select="hero-sphere"]').click();
    await page.getByRole('button', { name: 'Scripts', exact: true }).click();
    await page.getByRole('button', { name: 'New script', exact: true }).click();
    await page
        .getByRole('textbox', { name: 'Script name', exact: true })
        .fill('Compatibility motion');
    await page
        .getByRole('textbox', { name: 'Script source', exact: true })
        .fill(
            '({ start(ctx) { ctx.setPosition(1.25, 1.86, 0); }, update(ctx, dt) { ctx.translate(dt, 0, 0); } })'
        );
    await page.getByRole('button', { name: 'Save & attach to selection', exact: true }).click();
    const authored = await currentSceneSource(page);
    const before = await viewportPixels(page, backend);
    await page.getByRole('button', { name: 'Play scene', exact: true }).click();
    await page.waitForFunction(
        () =>
            document.querySelector('#app')?.getAttribute('data-play-state') === 'playing' &&
            Number(document.querySelector<HTMLInputElement>('[data-field="position.x"]')?.value) >
                1.25,
        undefined,
        { timeout: 10_000 }
    );
    await page.getByRole('button', { name: 'Pause scene', exact: true }).click();
    await page.waitForFunction(
        () => document.querySelector('#app')?.getAttribute('data-play-state') === 'paused'
    );
    const playPixelChanges = pixelChanges(before, await viewportPixels(page, backend));
    if (playPixelChanges < 500 || (await currentSceneSource(page)) !== authored)
        throw new Error('Play did not render a transient pose or modified authored data.');
    await page.getByRole('button', { name: 'Stop play mode', exact: true }).click();
    await page.waitForFunction(
        () => document.querySelector('#app')?.getAttribute('data-play-state') === 'stopped'
    );
    const stopPixelChanges = pixelChanges(before, await viewportPixels(page, backend));
    if ((await currentSceneSource(page)) !== authored || stopPixelChanges !== 0)
        throw new Error('Stop did not restore authored scene pixels and source.');
    await page.getByRole('button', { name: 'Project browser', exact: true }).click();
    const projects = page.getByRole('dialog', { name: 'Project browser', exact: true });
    await projects.getByRole('button', { name: 'New scene', exact: true }).click();
    await projects.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Assets', exact: true }).click();
    await page.getByLabel('Import asset files', { exact: true }).setInputFiles([
        { name: 'Compatibility Quad.glb', mimeType: 'model/gltf-binary', buffer: quadGLB() },
        { name: 'Direction.png', mimeType: 'image/png', buffer: checkerPNG() }
    ]);
    await page
        .getByRole('button', { name: 'Add model Compatibility Quad.glb', exact: true })
        .click();
    await page.getByRole('combobox', { name: 'Camera view', exact: true }).selectOption('front');
    await page.getByRole('button', { name: 'Frame selection (F)', exact: true }).first().click();
    const imported = await viewportPixels(page, backend);
    let warm = 0;
    for (let index = 0; index < imported.length; index += 4)
        if (
            (imported[index] ?? 0) > 90 &&
            (imported[index + 1] ?? 0) < (imported[index] ?? 0) * 0.7 &&
            (imported[index + 2] ?? 0) < (imported[index] ?? 0) * 0.6
        )
            warm++;
    if (warm < 2000) throw new Error('Imported GLB did not produce enough native colored pixels.');
    await page.getByRole('button', { name: 'Primitives', exact: true }).click();
    await page.getByRole('button', { name: 'Add Cube', exact: true }).click();
    const position = page.getByRole('spinbutton', { name: 'position.x', exact: true });
    await position.fill('2');
    await position.press('Tab');
    await page.getByRole('button', { name: 'Frame selection (F)', exact: true }).first().click();
    const plain = await viewportPixels(page, backend);
    await page.getByRole('button', { name: 'Assets', exact: true }).click();
    await page.getByRole('button', { name: 'Apply texture Direction.png', exact: true }).click();
    const texturePixelChanges = pixelChanges(plain, await viewportPixels(page, backend));
    if (texturePixelChanges < 500)
        throw new Error('Imported PNG did not change native scene pixels.');
    return {
        playPixelChanges,
        stopPixelChanges,
        authoredSourceUnchanged: true,
        importedModelWarmPixels: warm,
        texturePixelChanges
    };
}

async function smoke(
    browser: Browser,
    settings: Options,
    name: string,
    backend: Backend
): Promise<object> {
    const { page, errors, ready } = await openEditor(browser, settings.origin, backend, false);
    try {
        if (!ready) {
            const reason = await page.locator('#viewport-loading').textContent();
            const actual = await page.locator('#backend-label').innerText();
            if (backend === 'webgpu' && actual === 'WEBGL2')
                throw new Error('Explicit WebGPU silently fell back.');
            return { browser: name, backend, status: 'unsupported', reason, errors };
        }
        await frames(page, 2);
        const control = page.locator('[data-field="position.x"]');
        const before = Number(await control.inputValue());
        await control.fill(String(before + 0.25));
        await control.press('Tab');
        await frames(page);
        await page.locator('#undo').click();
        await frames(page);
        if (Math.abs(Number(await control.inputValue()) - before) > 1e-5)
            throw new Error('Browser smoke Undo failed.');
        const authoring = settings.authoringSmoke ? await authoringSmoke(page, backend) : null;
        const screenshotPath = resolve(`reports/editor/smoke-${name}-${backend}.png`);
        await mkdir(dirname(screenshotPath), { recursive: true });
        await writeFile(screenshotPath, await stableFrame(page, backend));
        if (errors.length > 0) throw new Error(errors.join('\n'));
        return {
            browser: name,
            backend,
            status: 'passed',
            version: browser.version(),
            screenshotPath,
            authoring,
            captureDiagnostics: captureDiagnostics.get(page) ?? [],
            device: await environment(page),
            errors
        };
    } finally {
        await page.close();
    }
}

async function main(): Promise<void> {
    const settings = options();
    const loopbackBypass = new Set(
        (process.env['NO_PROXY'] ?? process.env['no_proxy'] ?? '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
    );
    for (const host of ['127.0.0.1', 'localhost', '::1']) loopbackBypass.add(host);
    process.env['NO_PROXY'] = [...loopbackBypass].join(',');
    process.env['no_proxy'] = process.env['NO_PROXY'];
    const args =
        settings.profile === 'software'
            ? [
                  '--enable-unsafe-swiftshader',
                  '--enable-unsafe-webgpu',
                  '--use-angle=swiftshader',
                  '--use-webgpu-adapter=swiftshader'
              ]
            : [
                  '--disable-software-rasterizer',
                  '--enable-unsafe-webgpu',
                  '--ignore-gpu-blocklist',
                  platform() === 'darwin'
                      ? '--use-angle=metal'
                      : platform() === 'linux'
                        ? '--use-angle=vulkan'
                        : '--use-angle=default'
              ];
    const observations: object[] = [];
    const failures: { browser: string; task: string; error: string }[] = [];
    const run = async (name: string, type: BrowserType, launchArgs?: string[]): Promise<void> => {
        let browser: Browser;
        try {
            browser = await type.launch({
                headless: true,
                ...(launchArgs ? { args: launchArgs } : {}),
                ...(name === 'chromium' ? { channel: 'chromium' } : {})
            });
        } catch (cause) {
            failures.push({
                browser: name,
                task: 'launch',
                error: cause instanceof Error ? cause.message : String(cause)
            });
            return;
        }
        try {
            for (const backend of ['webgl2', 'webgpu'] as const) {
                if (name === 'chromium' && !settings.smokeOnly) {
                    for (const count of settings.counts) {
                        const task = `${backend}/${String(count)}`;
                        process.stdout.write(`Measuring ${name} ${task}\n`);
                        try {
                            observations.push(await measure(browser, settings, backend, count));
                        } catch (cause) {
                            failures.push({
                                browser: name,
                                task,
                                error: cause instanceof Error ? cause.message : String(cause)
                            });
                        }
                    }
                } else {
                    process.stdout.write(`Smoke ${name} ${backend}\n`);
                    try {
                        observations.push(await smoke(browser, settings, name, backend));
                    } catch (cause) {
                        failures.push({
                            browser: name,
                            task: backend,
                            error: cause instanceof Error ? cause.message : String(cause)
                        });
                    }
                }
            }
        } finally {
            await browser.close();
        }
    };
    if (settings.browsers === 'all' || settings.browsers === 'chromium')
        await run('chromium', chromium, args);
    if (settings.browsers === 'all' || settings.browsers === 'firefox')
        await run('firefox', firefox);
    if (settings.browsers === 'all' || settings.browsers === 'webkit') await run('webkit', webkit);
    const report = {
        kind: 'local-editor-observations',
        generatedAt: new Date().toISOString(),
        evidenceBoundary:
            'Not an enrolled RHI baseline or cross-machine regression claim. Instrumented local editor observations; no performance thresholds were weakened or inferred.',
        methodology:
            'Real editor document import and inspector edit/Undo;300/1000 opaque cubes share geometry/material, no authored shadow lights. Frame callback CPU/cadence collected over3s, without test backpressure. Input latencies include Playwright delivery and two submitted frames plus GPU drain. No GPU frame-time claim.',
        host: {
            platform: platform(),
            release: release(),
            arch: arch(),
            cpu: cpus()[0]?.model ?? null,
            logicalCpus: cpus().length,
            memoryBytes: totalmem(),
            node: process.version
        },
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        workingTreeStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
        settings,
        chromiumLaunchArguments: args,
        observations,
        failures
    };
    await mkdir(dirname(settings.output), { recursive: true });
    await writeFile(settings.output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${settings.output}\n`);
    if (failures.length > 0) process.exitCode = 1;
}
await main();
