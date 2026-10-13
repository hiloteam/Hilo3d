import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { importAsset } from '../../editor/assets';
import {
    defaultAudioComponent,
    defaultParticleComponent,
    defaultPhysicsComponent
} from '../../editor/components';
import type { ComponentRuntimeDiagnostics } from '../../editor/component-runtime';
import { createProject, serializeProject } from '../../editor/project';
import { createDefaultScene, type SceneNode } from '../../editor/scene';
import { installPageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    nativeRenderProgress,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';
import { captureStableFrame } from './stable-capture';

const contentTypes: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
};
interface StaticHost {
    origin: string;
    close(): Promise<void>;
}
async function host(directory: string, prefix: string): Promise<StaticHost> {
    const root = resolve(directory);
    const serve = async (url: string, response: ServerResponse): Promise<void> => {
        const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname);
        const route =
            prefix && pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
        let path = resolve(root, `.${route}`);
        if (path !== root && !path.startsWith(`${root}${sep}`)) {
            response.writeHead(404).end();
            return;
        }
        const entry = await stat(path).catch(() => null);
        if (entry?.isDirectory()) path = resolve(path, 'index.html');
        const body = await readFile(path).catch(() => null);
        if (!body) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {
            'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        response.end(body);
    };
    const server = createServer((request, response) => {
        void serve(request.url ?? '/', response).catch(() => {
            response.writeHead(500).end();
        });
    });
    await new Promise<void>(done => {
        server.listen(0, '127.0.0.1', done);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Static host did not acquire a port.');
    return {
        origin: `http://127.0.0.1:${String(address.port)}`,
        close: async () => {
            await new Promise<void>((done, reject) => {
                server.close(error => {
                    if (error) reject(error);
                    else done();
                });
                server.closeAllConnections();
            });
        }
    };
}

/** Independent reader for the uncompressed website ZIP, never the runtime's archive importer. */
async function extractWebsite(zip: Buffer, root: string): Promise<string[]> {
    const paths: string[] = [];
    let cursor = 0;
    while (cursor + 30 <= zip.length && zip.readUInt32LE(cursor) === 0x04034b50) {
        const flags = zip.readUInt16LE(cursor + 6);
        const compression = zip.readUInt16LE(cursor + 8);
        const size = zip.readUInt32LE(cursor + 18);
        const nameLength = zip.readUInt16LE(cursor + 26);
        const extraLength = zip.readUInt16LE(cursor + 28);
        expect(compression).toBe(0);
        expect(flags & 8).toBe(0);
        const name = zip.toString('utf8', cursor + 30, cursor + 30 + nameLength);
        const path = resolve(root, name);
        expect(path.startsWith(`${resolve(root)}${sep}`)).toBe(true);
        expect(paths).not.toContain(name);
        const start = cursor + 30 + nameLength + extraLength;
        expect(start + size).toBeLessThanOrEqual(zip.length);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, zip.subarray(start, start + size));
        paths.push(name);
        cursor = start + size;
    }
    expect(paths).toContain('index.html');
    expect(paths).toContain('player.json');
    expect(paths).toContain('project.zip');
    expect(paths).toContain('LICENSE.txt');
    expect(paths).toContain('THIRD_PARTY_NOTICES.txt');
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50);
    return paths;
}

function wav(): Uint8Array<ArrayBuffer> {
    const samples = 8000;
    const bytes = new Uint8Array(44 + samples * 2);
    const view = new DataView(bytes.buffer);
    const tag = (offset: number, value: string): void => {
        bytes.set(new TextEncoder().encode(value), offset);
    };
    tag(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    tag(36, 'data');
    view.setUint32(40, samples * 2, true);
    for (let index = 0; index < samples; index++)
        view.setInt16(
            44 + index * 2,
            Math.round(Math.sin((index * Math.PI * 2 * 220) / 8000) * 6000),
            true
        );
    return bytes;
}
function node(name: string, x: number, y: number, z = 0): SceneNode {
    return {
        name,
        type: 'mesh',
        geometry: 'cube',
        material: 'orange',
        parent: null,
        visible: true,
        transform: {
            position: { x, y, z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        }
    };
}
async function projectFixture(): Promise<string> {
    const project = createProject(createDefaultScene(), 'Published component experience');
    const audio = await importAsset(new File([wav()], 'tone.wav', { type: 'audio/wav' }));
    audio.source.license = 'CC0-1.0';
    audio.source.attribution = 'Generated acceptance sine wave';
    project.assets[audio.id] = audio;
    const scene = createDefaultScene();
    scene.name = 'Physics garden';
    scene.materials = {
        orange: { name: 'Orange', color: '#e86732', metallic: 0, roughness: 0.7 },
        blue: { name: 'Blue', color: '#2668eb', metallic: 0, roughness: 0.5 }
    };
    const ball = node('Ball with components', 0, 3);
    ball.geometry = 'sphere';
    ball.scripts = ['ball-script'];
    ball.components = {
        physics: { ...defaultPhysicsComponent(), shape: 'sphere', restitution: 0.1 },
        particles: { ...defaultParticleComponent(), rate: 40, size: 0.15, color: '#4fffc4' },
        audio: { ...defaultAudioComponent(audio.id), autoplay: false, loop: true }
    };
    const ground = node('Ground', 0, -0.5);
    ground.transform.scale = { x: 10, y: 1, z: 8 };
    ground.material = 'blue';
    ground.components = { physics: { ...defaultPhysicsComponent(), body: 'static' } };
    const camera: SceneNode = {
        name: 'Visitor camera',
        type: 'camera',
        parent: null,
        visible: true,
        camera: { fov: 45, near: 0.1, far: 100 },
        transform: {
            position: { x: 0, y: 2, z: 10 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        }
    };
    const beacon = node('Animated beacon', -2, 1);
    beacon.transform.scale = { x: 0.4, y: 0.4, z: 0.4 };
    scene.nodes = { ball, ground, camera, beacon };
    const second = structuredClone(scene);
    second.name = 'Quiet room';
    const cube = node('Quiet blue cube', 0, 2);
    cube.material = 'blue';
    second.nodes = { camera: structuredClone(camera), cube };
    project.scenes = { 'scene-main': scene, 'scene-second': second };
    project.scripts = {
        'ball-script': {
            id: 'ball-script',
            name: 'Impulse and input',
            enabled: true,
            source: `({ start(ctx) { ctx.applyImpulse(0, 1, 0); ctx.emitParticles(8); ctx.playAudio(); ctx.log('components started'); }, update(ctx, dt) { if (ctx.input.keys.includes('d')) ctx.applyImpulse(0.35, 0, 0); }, stop(ctx) { ctx.log('components stopped'); } })`
        }
    };
    project.clips = {
        'beacon-motion': {
            id: 'beacon-motion',
            name: 'Beacon motion',
            sceneId: 'scene-main',
            duration: 1,
            fps: 60,
            loop: true,
            tracks: [
                {
                    id: 'beacon-x',
                    nodeId: 'beacon',
                    property: 'position.x',
                    keys: [
                        { time: 0, value: -2, interpolation: 'linear' },
                        { time: 1, value: -1, interpolation: 'linear' }
                    ]
                }
            ]
        }
    };
    return serializeProject(project);
}
interface Snapshot {
    state: string;
    time: number;
    components?: ComponentRuntimeDiagnostics;
    transforms: Record<string, { x: number; y: number; z: number } | null>;
}
type PlayerWindow = Window & {
    __HILO_PLAYER_TEST__?: { step(): Promise<void>; snapshot(): Snapshot };
};
async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(() => {
        const control = (window as PlayerWindow).__HILO_PLAYER_TEST__;
        if (!control) throw new Error('Player test diagnostics unavailable.');
        return control.snapshot();
    });
}
function warmPixels(png: Buffer): number {
    const image = PNG.sync.read(png);
    let count = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const red = image.data[offset] ?? 0;
        if (
            red > 90 &&
            red > (image.data[offset + 1] ?? 0) * 1.4 &&
            red > (image.data[offset + 2] ?? 0) * 1.5
        )
            count++;
    }
    return count;
}
let editorHost: StaticHost;
test.beforeAll(async () => {
    const editorRoot = resolve(process.env['HILO3D_PLAYER_EDITOR_ROOT'] ?? 'dist-editor');
    await stat(resolve(editorRoot, 'editor/index.html'));
    editorHost = await host(editorRoot, '/Hilo3d');
});
test.afterAll(async () => {
    await editorHost.close();
});

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`exports a complete static Player and runs components on ${backend}`, async ({
        browser
    }, info) => {
        const directory = await mkdtemp(resolve(tmpdir(), 'hilo-player-export-'));
        let published: StaticHost | undefined;
        const editorContext = await browser.newContext({ acceptDownloads: true });
        const editor = await editorContext.newPage();
        await installRenderHealthProbe(editor);
        const editorFailures = await installPageFailureMonitor(editor);
        try {
            const prefix = backend === 'webgpu' ? '/Hilo3d' : '';
            await editor.goto(`${editorHost.origin}${prefix}/editor/?backend=${backend}&test=1`);
            await expect(editor.locator('#app')).toHaveAttribute('data-ready', 'true');
            await editor.getByRole('button', { name: 'Project browser', exact: true }).click();
            await editor.getByLabel('Import project bundle', { exact: true }).setInputFiles({
                name: 'publish.hilo-project.json',
                mimeType: 'application/json',
                buffer: Buffer.from(await projectFixture())
            });
            await expect(
                editor.getByRole('dialog', { name: 'Project browser', exact: true })
            ).not.toBeVisible();
            await expect(editor.locator('#project-name')).toHaveText('Physics garden');
            await editor.getByRole('button', { name: 'Publish website', exact: true }).click();
            const dialog = editor.getByRole('dialog', { name: 'Publish website', exact: true });
            await expect(dialog).toBeVisible();
            await expect(dialog.getByLabel('Physics garden player camera')).toHaveValue('camera');
            await expect(dialog.getByLabel('Physics garden player animation')).toHaveValue(
                'beacon-motion'
            );
            const downloaded = editor.waitForEvent('download');
            await dialog.getByRole('button', { name: 'Download website ZIP', exact: true }).click();
            const download = await downloaded;
            const zipPath = info.outputPath(`complete-${backend}.zip`);
            await download.saveAs(zipPath);
            const files = await extractWebsite(await readFile(zipPath), directory);
            expect(files.some(path => path.endsWith('.js'))).toBe(true);
            expect(await readFile(resolve(directory, 'README.md'), 'utf8')).toContain(
                'Subdirectory hosting'
            );
            editorFailures.assertEmpty('Production Studio export');
            await editor.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
            });
            await waitForStableAnimationFrames(editor);
            await awaitTrackedGPUQueues(editor);
            editorFailures.assertEmpty('Production Studio post teardown');
            await editorContext.close();
            published = await host(directory, '/Hilo3d/experience');
            // The website runs on a different origin, proving independence from Studio state/services.
            const context = await browser.newContext();
            const page = await context.newPage();
            const requested: string[] = [];
            page.on('request', request => {
                requested.push(request.url());
            });
            await installRenderHealthProbe(page);
            const failures = await installPageFailureMonitor(page);
            try {
                for (const route of ['/', '/Hilo3d/experience/']) {
                    await page.goto(`${published.origin}${route}?backend=${backend}&test=1`);
                    await expect(page.locator('#player')).toHaveAttribute('data-ready', 'true');
                    await expect(page.locator('#backend')).toHaveText(backend.toUpperCase());
                    await expect
                        .poll(async () =>
                            completedRenderCommands(await readRenderHealth(page), backend)
                        )
                        .toBeGreaterThan(0);
                    expect((await snapshot(page)).state).toBe('stopped');
                    expect((await snapshot(page)).transforms['ball']?.y).toBe(3);
                    await page
                        .getByRole('button', { name: 'Start experience', exact: true })
                        .click();
                    await expect(page.locator('#player')).toHaveAttribute('data-state', 'playing');
                    await expect
                        .poll(async () => (await snapshot(page)).time)
                        .toBeGreaterThan(0.35);
                    await page.getByRole('button', { name: 'Pause', exact: true }).click();
                    await expect(page.locator('#player')).toHaveAttribute('data-state', 'paused');
                    const paused = await snapshot(page);
                    expect(paused.transforms['ball']?.y).toBeLessThan(2.9);
                    expect(paused.transforms['beacon']?.x).toBeGreaterThan(-2);
                    expect(paused.components?.physics?.simulatedSteps).toBeGreaterThan(15);
                    expect(paused.components?.particles[0]?.alive).toBeGreaterThan(8);
                    expect(paused.components?.audio).toMatchObject({
                        contextState: 'running',
                        pausedVoices: 1
                    });
                    const capture = await captureStableFrame(page, backend, { frames: 2 });
                    expect(warmPixels(capture)).toBeGreaterThan(500);
                    await info.attach(
                        `published-${backend}-${route === '/' ? 'root' : 'subpath'}`,
                        { body: capture, contentType: 'image/png' }
                    );
                    await waitForStableAnimationFrames(page);
                    expect((await snapshot(page)).time).toBe(paused.time);
                    await page.evaluate(async () => {
                        await (window as PlayerWindow).__HILO_PLAYER_TEST__?.step();
                    });
                    const stepped = await snapshot(page);
                    expect(stepped.time - paused.time).toBeCloseTo(1 / 60, 8);
                    expect(stepped.components?.physics?.simulatedSteps).toBe(
                        (paused.components?.physics?.simulatedSteps ?? 0) + 1
                    );
                    await page.getByRole('button', { name: 'Resume', exact: true }).click();
                    await page.locator('#viewport').focus();
                    const beforeKey = (await snapshot(page)).transforms['ball']?.x ?? 0;
                    await page.keyboard.down('d');
                    await expect
                        .poll(async () => (await snapshot(page)).transforms['ball']?.x ?? 0)
                        .toBeGreaterThan(beforeKey + 0.15);
                    await page.keyboard.up('d');
                    await page.locator('#scene').selectOption('scene-second');
                    await expect(page.locator('#player')).toHaveAttribute(
                        'data-scene',
                        'scene-second'
                    );
                    await expect(page.locator('#player')).toHaveAttribute('data-state', 'stopped');
                    await page
                        .getByRole('button', { name: 'Start experience', exact: true })
                        .click();
                    await expect(page.locator('#player')).toHaveAttribute('data-state', 'playing');
                    expect((await snapshot(page)).components).toMatchObject({
                        physics: null,
                        particles: [],
                        audio: null
                    });
                    await page.locator('#scene').selectOption('scene-main');
                    await expect(page.locator('#player')).toHaveAttribute(
                        'data-scene',
                        'scene-main'
                    );
                    expect((await snapshot(page)).transforms['ball']?.y).toBe(3);
                    await page
                        .getByRole('button', { name: 'Start experience', exact: true })
                        .click();
                    await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(0.1);
                    await page.getByRole('button', { name: 'Restart', exact: true }).click();
                    await expect(page.locator('#player')).toHaveAttribute('data-state', 'playing');
                    await page.getByRole('button', { name: 'Pause', exact: true }).click();
                    await expect(page.locator('#player')).toHaveAttribute('data-state', 'paused');
                    expect((await snapshot(page)).transforms['ball']?.x).toBeCloseTo(0, 4);
                    await assertStableInstrumentationHealth(backend, 'Published Player', {
                        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                        readRenderHealth: () => readRenderHealth(page)
                    });
                    await page.reload();
                    await expect(page.locator('#player')).toHaveAttribute('data-ready', 'true');
                    expect((await snapshot(page)).state).toBe('stopped');
                    expect((await snapshot(page)).transforms['ball']?.y).toBe(3);
                    await page
                        .getByRole('button', { name: 'Start experience', exact: true })
                        .click();
                    await expect(page.locator('#player')).toHaveAttribute('data-state', 'playing');
                    await page.evaluate(() => {
                        window.dispatchEvent(
                            new PageTransitionEvent('pagehide', { persisted: true })
                        );
                    });
                    await expect(page.locator('#player')).toHaveAttribute('data-state', 'paused');
                    const frozen = await snapshot(page);
                    await waitForStableAnimationFrames(page);
                    expect((await snapshot(page)).time).toBe(frozen.time);
                    await page.evaluate(() => {
                        window.dispatchEvent(
                            new PageTransitionEvent('pageshow', { persisted: true })
                        );
                    });
                    await expect(page.locator('#player')).toHaveAttribute('data-state', 'playing');
                    await page.evaluate(() => {
                        window.dispatchEvent(
                            new PageTransitionEvent('pagehide', { persisted: false })
                        );
                    });
                    await waitForStableAnimationFrames(page);
                    await awaitTrackedGPUQueues(page);
                    const stopped = nativeRenderProgress(await readRenderHealth(page), backend);
                    await waitForStableAnimationFrames(page);
                    expect(nativeRenderProgress(await readRenderHealth(page), backend)).toEqual(
                        stopped
                    );
                    failures.assertEmpty(`Player ${backend} ${route} after teardown`);
                }
                expect(
                    requested.filter(
                        url => /^https?:/u.test(url) && new URL(url).origin !== published?.origin
                    )
                ).toEqual([]);
            } catch (error) {
                await info.attach('player-failure-diagnostics', {
                    body: Buffer.from(
                        JSON.stringify(
                            {
                                failures: failures.snapshot(),
                                state: await snapshot(page).catch(() => null)
                            },
                            null,
                            2
                        )
                    ),
                    contentType: 'application/json'
                });
                throw error;
            } finally {
                await failures.dispose();
                await context.close();
            }
        } finally {
            await editorFailures.dispose();
            await editorContext.close();
            await published?.close();
            await rm(directory, { recursive: true, force: true });
        }
    });
}
