import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    expect,
    test,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
    type TestInfo
} from '@playwright/test';
import { PNG } from 'pngjs';
import { parseProject, type ProjectDocument } from '../../editor/project';
import { parseScene, type SceneDocument } from '../../editor/scene';
import { testServerOrigin } from '../../scripts/playwright-test-server';
import type { ExampleBackend } from './example-paths';
import { installPageFailureMonitor, type PageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';
import { captureStableFrame } from './stable-capture';

function modelBytes(): Buffer {
    const positions = new Float32Array([-0.6, 0, 0, 0.6, 0, 0, 0.6, 1.2, 0, -0.6, 1.2, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const json = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'Imported Quad', mesh: 0 }],
        meshes: [
            { primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }
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
        buffers: [{ byteLength: 108 }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 48 },
            { buffer: 0, byteOffset: 48, byteLength: 48 },
            { buffer: 0, byteOffset: 96, byteLength: 12 }
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
            { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' }
        ]
    };
    const source = Buffer.from(JSON.stringify(json));
    const jsonLength = Math.ceil(source.length / 4) * 4;
    const output = Buffer.alloc(28 + jsonLength + 108);
    output.writeUInt32LE(0x46546c67, 0);
    output.writeUInt32LE(2, 4);
    output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(jsonLength, 12);
    output.writeUInt32LE(0x4e4f534a, 16);
    output.fill(32, 20, 20 + jsonLength);
    source.copy(output, 20);
    output.writeUInt32LE(108, 20 + jsonLength);
    output.writeUInt32LE(0x004e4942, 24 + jsonLength);
    Buffer.from(positions.buffer).copy(output, 28 + jsonLength);
    Buffer.from(normals.buffer).copy(output, 76 + jsonLength);
    Buffer.from(indices.buffer).copy(output, 124 + jsonLength);
    return output;
}

function textureBytes(): Buffer {
    const png = new PNG({ width: 4, height: 4 });
    for (let y = 0; y < 4; y += 1)
        for (let x = 0; x < 4; x += 1) {
            const offset = (y * 4 + x) * 4;
            png.data[offset] = y < 2 ? 245 : 20;
            png.data[offset + 1] = x < 2 ? 40 : 190;
            png.data[offset + 2] = y < 2 ? 15 : 240;
            png.data[offset + 3] = 255;
        }
    return PNG.sync.write(png);
}

async function field(input: Locator, value: string): Promise<void> {
    await input.fill(value);
    await input.press('Tab');
}
async function sceneSource(page: Page): Promise<SceneDocument> {
    await page.getByRole('button', { name: 'Scene JSON', exact: true }).click();
    const scene = parseScene(
        await page.getByRole('textbox', { name: 'Scene JSON', exact: true }).inputValue()
    );
    await page.locator('#source-dialog').getByRole('button', { name: 'Close dialog' }).click();
    return scene;
}
async function projectBrowser(page: Page): Promise<Locator> {
    const dialog = page.getByRole('dialog', { name: 'Project browser', exact: true });
    if (!(await dialog.isVisible()))
        await page.getByRole('button', { name: 'Project browser', exact: true }).click();
    await expect(dialog).toBeVisible();
    return dialog;
}
async function closeProjects(page: Page): Promise<void> {
    await page
        .getByRole('dialog', { name: 'Project browser', exact: true })
        .getByRole('button', { name: 'Done', exact: true })
        .click();
}
async function exportProject(
    page: Page,
    info: TestInfo,
    fileName: string
): Promise<{ project: ProjectDocument; path: string }> {
    const dialog = await projectBrowser(page);
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export project bundle', exact: true }).click();
    const download = await pending;
    const path = info.outputPath(fileName);
    await download.saveAs(path);
    return { project: parseProject(await readFile(path, 'utf8')), path };
}
async function capturePixels(page: Page, backend: ExampleBackend): Promise<Buffer> {
    const bounds = await page.locator('#viewport canvas').boundingBox();
    if (!bounds) throw new Error('Missing editor canvas');
    const image = PNG.sync.read(await captureStableFrame(page, backend, { frames: 2 }));
    const width = Math.floor(bounds.width) - 2;
    const height = Math.floor(bounds.height) - 2;
    const pixels = Buffer.alloc(width * height * 4);
    for (let row = 0; row < height; row += 1) {
        const start = ((Math.ceil(bounds.y) + row) * image.width + Math.ceil(bounds.x)) * 4;
        image.data.copy(pixels, row * width * 4, start, start + width * 4);
    }
    return pixels;
}
function warmPixels(pixels: Buffer): number {
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        if (
            red > 90 &&
            (pixels[index + 1] ?? 0) < red * 0.7 &&
            (pixels[index + 2] ?? 0) < red * 0.6
        )
            count += 1;
    }
    return count;
}
function changedPixels(a: Buffer, b: Buffer): number {
    expect(a.length).toBe(b.length);
    let changes = 0;
    for (let index = 0; index < a.length; index += 4)
        if (
            Math.abs((a[index] ?? 0) - (b[index] ?? 0)) +
                Math.abs((a[index + 1] ?? 0) - (b[index + 1] ?? 0)) +
                Math.abs((a[index + 2] ?? 0) - (b[index + 2] ?? 0)) >
            45
        )
            changes += 1;
    return changes;
}

async function workflow(
    browser: Browser,
    backend: ExampleBackend,
    run: (page: Page) => Promise<void>
): Promise<void> {
    const context = await browser.newContext({
        viewport: { width: 1600, height: 1100 },
        deviceScaleFactor: 1,
        acceptDownloads: true
    });
    const page = await context.newPage();
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    try {
        await page.goto(`${testServerOrigin}/editor/index.html?backend=${backend}&test=1`);
        await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
        await expect
            .poll(async () => completedRenderCommands(await readRenderHealth(page), backend))
            .toBeGreaterThan(0);
        await run(page);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.locator('#save-state')).toHaveAttribute('data-state', 'saved');
        await assertStableInstrumentationHealth(backend, 'Authoring graphics before teardown', {
            waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
            awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
            readRenderHealth: () => readRenderHealth(page)
        });
        await page.evaluate(() =>
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
        );
        await waitForStableAnimationFrames(page);
        await awaitTrackedGPUQueues(page);
        const stopped = nativeRenderProgress(await readRenderHealth(page), backend);
        await waitForStableAnimationFrames(page);
        expect(nativeRenderProgress(await readRenderHealth(page), backend)).toEqual(stopped);
        await assertStableInstrumentationHealth(backend, 'Authoring graphics after teardown', {
            waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
            awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
            readRenderHealth: () => readRenderHealth(page)
        });
        failures.assertEmpty(`Editor authoring ${backend}`);
    } finally {
        await failures.dispose();
        await context.close();
    }
}

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`editor imports assets and preserves linked prefab authoring on ${backend} @${backend}`, async ({
        browser
    }, info) => {
        test.setTimeout(120_000);
        await workflow(browser, backend, async page => {
            await (
                await projectBrowser(page)
            )
                .getByRole('button', { name: 'New scene', exact: true })
                .click();
            await expect(page.locator('.project-scene-row.active input')).toHaveValue(
                'Untitled Scene'
            );
            await closeProjects(page);
            await page.getByRole('button', { name: 'Assets', exact: true }).click();
            await page.getByLabel('Import asset files', { exact: true }).setInputFiles([
                {
                    name: 'Acceptance Quad.glb',
                    mimeType: 'model/gltf-binary',
                    buffer: modelBytes()
                },
                { name: 'Direction.png', mimeType: 'image/png', buffer: textureBytes() }
            ]);
            await expect(page.locator('.project-asset-card')).toHaveCount(2);
            await page
                .getByRole('button', { name: 'Add model Acceptance Quad.glb', exact: true })
                .click();
            await expect(
                page.getByRole('textbox', { name: 'Object name', exact: true })
            ).toHaveValue('Acceptance Quad');
            await page
                .getByRole('combobox', { name: 'Camera view', exact: true })
                .selectOption('front');
            await expect
                .poll(async () => warmPixels(await capturePixels(page, backend)), {
                    message: 'Imported GLB must produce real colored pixels before picking'
                })
                .toBeGreaterThan(2000);
            await page
                .getByRole('button', { name: 'Frame selection (F)', exact: true })
                .first()
                .click();
            await capturePixels(page, backend);
            await page.getByRole('button', { name: 'Scene settings', exact: true }).click();
            const canvas = page.locator('#viewport canvas');
            const box = await canvas.boundingBox();
            if (!box) throw new Error('Missing viewport bounds');
            await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
            await expect(
                page.getByRole('textbox', { name: 'Object name', exact: true })
            ).toHaveValue('Acceptance Quad');

            await page.getByRole('button', { name: 'Primitives', exact: true }).click();
            await page.getByRole('button', { name: 'Add Cube', exact: true }).click();
            await field(
                page.getByRole('textbox', { name: 'Object name', exact: true }),
                'Texture Cube'
            );
            await field(page.getByRole('spinbutton', { name: 'position.x', exact: true }), '2');
            await page
                .getByRole('button', { name: 'Frame selection (F)', exact: true })
                .first()
                .click();
            const untextured = await capturePixels(page, backend);
            await page.getByRole('button', { name: 'Assets', exact: true }).click();
            await page
                .getByRole('button', { name: 'Apply texture Direction.png', exact: true })
                .click();
            const textured = await capturePixels(page, backend);
            expect(
                changedPixels(untextured, textured),
                'Imported image must affect actual scene pixels'
            ).toBeGreaterThan(500);
            const texturedScene = await sceneSource(page);
            expect(
                Object.values(texturedScene.materials).some(material => material.baseColorTexture)
            ).toBe(true);

            await page.getByRole('button', { name: 'Prefabs', exact: true }).click();
            await page.getByRole('button', { name: 'Create from selection', exact: true }).click();
            await expect(page.locator('[data-prefab-add]')).toHaveCount(1);
            await page.locator('[data-prefab-add]').click();
            await expect(
                page.getByRole('spinbutton', { name: 'position.x', exact: true })
            ).toHaveValue('2.8');
            await field(page.getByRole('spinbutton', { name: 'position.y', exact: true }), '1.5');
            await page.getByRole('button', { name: 'Revert overrides', exact: true }).click();
            await expect(
                page.getByRole('spinbutton', { name: 'position.y', exact: true })
            ).toHaveValue('0.5');
            await page.getByRole('button', { name: 'Undo (⌘ Z)', exact: true }).click();
            await expect(
                page.getByRole('spinbutton', { name: 'position.y', exact: true })
            ).toHaveValue('1.5');
            await page.getByRole('button', { name: 'Redo (⌘ ⇧ Z)', exact: true }).click();
            await field(page.getByRole('spinbutton', { name: 'position.y', exact: true }), '1.3');
            await page.getByRole('button', { name: 'Apply to template', exact: true }).click();
            await page.locator('[data-select="cube-001"]').click();
            await expect(
                page.getByRole('spinbutton', { name: 'position.y', exact: true })
            ).toHaveValue('1.3');
            await page.getByRole('button', { name: 'Undo (⌘ Z)', exact: true }).click();
            await expect(
                page.getByRole('spinbutton', { name: 'position.y', exact: true })
            ).toHaveValue('0.5');
            await page.getByRole('button', { name: 'Redo (⌘ ⇧ Z)', exact: true }).click();
            await expect(
                page.getByRole('spinbutton', { name: 'position.y', exact: true })
            ).toHaveValue('1.3');
            await page.getByRole('button', { name: 'Assets', exact: true }).click();
            await page
                .getByRole('button', { name: 'Remove asset Direction.png', exact: true })
                .click();
            await expect(page.locator('#toast')).toContainText('used by');
            await expect(page.locator('.project-asset-card')).toHaveCount(2);

            const exported = await exportProject(page, info, 'assets-prefabs.hilo-project.json');
            expect(Object.keys(exported.project.assets)).toHaveLength(2);
            expect(Object.keys(exported.project.prefabs)).toHaveLength(1);
            expect(Object.keys(exported.project.instances)).toHaveLength(2);
            expect(Object.keys(exported.project.scenes)).toHaveLength(2);
            await page
                .getByLabel('Import project bundle', { exact: true })
                .setInputFiles(exported.path);
            await expect(
                page.getByRole('dialog', { name: 'Project browser', exact: true })
            ).not.toBeVisible();
            const reimported = await exportProject(
                page,
                info,
                'assets-prefabs-reimported.hilo-project.json'
            );
            expect(reimported.project.id).not.toBe(exported.project.id);
            expect(reimported.project.assets).toEqual(exported.project.assets);
            expect(reimported.project.scenes).toEqual(exported.project.scenes);
            expect(reimported.project.prefabs).toEqual(exported.project.prefabs);
            expect(reimported.project.instances).toEqual(exported.project.instances);
            const zipDownload = page.waitForEvent('download');
            await page
                .getByRole('button', { name: 'Export AI workspace (.zip)', exact: true })
                .click();
            const zip = await zipDownload;
            const zipPath = info.outputPath('assets-prefabs-workspace.zip');
            await zip.saveAs(zipPath);
            expect((await readFile(zipPath)).readUInt32LE(0)).toBe(0x04034b50);
            await closeProjects(page);
            await page.locator('#project-name').click();
            await field(
                page.getByRole('textbox', { name: 'Scene name', exact: true }),
                'Changed after ZIP export'
            );
            await projectBrowser(page);
            await page.getByLabel('Import project bundle', { exact: true }).setInputFiles(zipPath);
            await expect(
                page.getByRole('dialog', { name: 'Project browser', exact: true })
            ).not.toBeVisible();
            const unpacked = await exportProject(
                page,
                info,
                'workspace-reimported.hilo-project.json'
            );
            expect(unpacked.project.id).not.toBe(reimported.project.id);
            expect(unpacked.project.scenes).toEqual(reimported.project.scenes);
            expect(unpacked.project.assets).toEqual(reimported.project.assets);
            expect(unpacked.project.prefabs).toEqual(reimported.project.prefabs);
            expect(unpacked.project.instances).toEqual(reimported.project.instances);
            await page.getByLabel('Import project bundle', { exact: true }).setInputFiles({
                name: 'broken.zip',
                mimeType: 'application/zip',
                buffer: Buffer.from('This is not a ZIP archive')
            });
            await expect(page.locator('.project-browser-dialog')).toHaveAttribute(
                'aria-busy',
                'false'
            );
            await expect(page.locator('.project-browser-error')).toContainText(/ZIP|archive/iu);
            await expect(page.locator('.project-id')).toHaveText(unpacked.project.id);
            await closeProjects(page);
            expect(await sceneSource(page)).toEqual(
                unpacked.project.scenes[unpacked.project.activeSceneId]
            );
            await capturePixels(page, backend);
        });
    });

    test(`editor previews scripts and animation without changing authored poses on ${backend} @${backend}`, async ({
        browser
    }, info) => {
        test.setTimeout(120_000);
        await workflow(browser, backend, async page => {
            await page.locator('[data-select="hero-sphere"]').click();
            await page.getByRole('button', { name: 'Scripts', exact: true }).click();
            await page.getByRole('button', { name: 'New script', exact: true }).click();
            await page
                .getByRole('textbox', { name: 'Script name', exact: true })
                .fill('Move Study');
            await page
                .getByRole('textbox', { name: 'Script source', exact: true })
                .fill(
                    '({ start(ctx) { ctx.setPosition(1.25, 1.86, 0); }, update(ctx, dt) { ctx.translate(dt * 2, 0, 0); } })'
                );
            await page
                .getByRole('button', { name: 'Save & attach to selection', exact: true })
                .click();
            await expect(page.getByRole('dialog', { name: 'Script editor' })).not.toBeVisible();
            const authored = await sceneSource(page);
            expect(authored.nodes['hero-sphere']?.scripts).toHaveLength(1);
            const beforePlay = await capturePixels(page, backend);
            const beforeProgress = nativeRenderProgress(await readRenderHealth(page), backend);
            await page.getByRole('button', { name: 'Play scene', exact: true }).click();
            await expect(page.locator('#app')).toHaveAttribute('data-play-state', 'playing');
            await expect
                .poll(async () =>
                    Number(
                        await page
                            .getByRole('spinbutton', { name: 'position.x', exact: true })
                            .inputValue()
                    )
                )
                .toBeGreaterThan(1.25);
            const editingPosition = page.getByRole('spinbutton', {
                name: 'position.x',
                exact: true
            });
            await editingPosition.focus();
            const heldValue = await editingPosition.inputValue();
            const beforeFocusedUpdate = Number.parseFloat(
                await page.locator('#play-time').innerText()
            );
            await expect
                .poll(async () => Number.parseFloat(await page.locator('#play-time').innerText()))
                .toBeGreaterThan(beforeFocusedUpdate);
            await expect(editingPosition).toBeFocused();
            await expect(
                editingPosition,
                'Live poses must not overwrite a field while the user is editing it'
            ).toHaveValue(heldValue);
            await page.getByRole('button', { name: 'Pause scene', exact: true }).click();
            await expect(page.locator('#app')).toHaveAttribute('data-play-state', 'paused');
            expect(changedPixels(beforePlay, await capturePixels(page, backend))).toBeGreaterThan(
                500
            );
            expect(
                await sceneSource(page),
                'Runtime script poses must not be serialized into scene source'
            ).toEqual(authored);
            const pausedX = Number(
                await page.getByRole('spinbutton', { name: 'position.x', exact: true }).inputValue()
            );
            await page.getByRole('button', { name: 'Step one frame', exact: true }).click();
            await expect
                .poll(async () =>
                    Number(
                        await page
                            .getByRole('spinbutton', { name: 'position.x', exact: true })
                            .inputValue()
                    )
                )
                .toBeGreaterThan(pausedX);
            expect(
                nativeRenderProgressAdvanced(
                    beforeProgress,
                    nativeRenderProgress(await readRenderHealth(page), backend),
                    backend
                )
            ).toBe(true);
            await page.getByRole('button', { name: 'Stop play mode', exact: true }).click();
            await expect(
                page.getByRole('spinbutton', { name: 'position.x', exact: true })
            ).toHaveValue('0');
            expect(changedPixels(beforePlay, await capturePixels(page, backend))).toBe(0);

            // A non-terminating user hook is bounded and leaves the authoring workspace usable.
            await page.locator('#asset-content [data-script-edit]').click();
            await page
                .getByRole('textbox', { name: 'Script source', exact: true })
                .fill('({ start() { while (true) {} } })');
            await page.getByRole('button', { name: 'Save script', exact: true }).click();
            await page.getByRole('button', { name: 'Play scene', exact: true }).click();
            await expect(page.locator('#toast')).toContainText('budget');
            await expect(page.locator('#app')).toHaveAttribute('data-play-state', 'stopped');
            await expect(
                page.getByRole('spinbutton', { name: 'position.x', exact: true })
            ).toHaveValue('0');
            await page.locator('#asset-content [data-script-edit]').click();
            await page
                .getByRole('textbox', { name: 'Script source', exact: true })
                .fill('({ update(ctx, dt) { ctx.translate(dt, 0, 0); } })');
            await page.getByRole('checkbox', { name: 'Script enabled', exact: true }).uncheck();
            await page.getByRole('button', { name: 'Save script', exact: true }).click();

            await page.getByRole('button', { name: 'Timeline', exact: true }).click();
            await page.getByRole('button', { name: 'Create animation clip', exact: true }).click();
            await field(
                page.getByRole('textbox', { name: 'Animation name', exact: true }),
                'Hero Slide'
            );
            await page
                .getByRole('button', {
                    name: 'Set keyframe from authored transform at current time',
                    exact: true
                })
                .click();
            await field(
                page.getByRole('spinbutton', { name: 'Animation time in seconds', exact: true }),
                '1'
            );
            await field(page.getByRole('spinbutton', { name: 'position.x', exact: true }), '2');
            await page
                .getByRole('button', {
                    name: 'Set keyframe from authored transform at current time',
                    exact: true
                })
                .click();
            await expect(page.locator('.timeline-key')).toHaveCount(2);
            await field(
                page.getByRole('spinbutton', { name: 'Animation time in seconds', exact: true }),
                '0.5'
            );
            await expect(
                page.getByRole('spinbutton', { name: 'position.x', exact: true })
            ).toHaveValue('1');
            expect((await sceneSource(page)).nodes['hero-sphere']?.transform.position.x).toBe(2);
            await page.getByRole('button', { name: 'Play animation', exact: true }).click();
            await expect
                .poll(async () =>
                    Number(
                        await page
                            .getByRole('spinbutton', {
                                name: 'Animation time in seconds',
                                exact: true
                            })
                            .inputValue()
                    )
                )
                .toBeGreaterThan(0.5);
            await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
            await page
                .getByRole('button', {
                    name: 'Stop animation and restore authored transforms',
                    exact: true
                })
                .click();
            await expect(
                page.getByRole('spinbutton', { name: 'position.x', exact: true })
            ).toHaveValue('2');
            const exported = await exportProject(page, info, 'scripts-animation.hilo-project.json');
            const clips = Object.values(exported.project.clips);
            expect(clips).toHaveLength(1);
            expect(clips[0]?.tracks[0]?.keys.map(key => [key.time, key.value])).toEqual([
                [0, 0],
                [1, 2]
            ]);
            expect(Object.values(exported.project.scripts)).toHaveLength(1);
            await page
                .getByLabel('Import project bundle', { exact: true })
                .setInputFiles(exported.path);
            await expect(
                page.getByRole('dialog', { name: 'Project browser', exact: true })
            ).not.toBeVisible();
            const roundTrip = await exportProject(
                page,
                info,
                'scripts-animation-reimported.hilo-project.json'
            );
            expect(roundTrip.project.id).not.toBe(exported.project.id);
            expect(roundTrip.project.clips).toEqual(exported.project.clips);
            expect(roundTrip.project.scripts).toEqual(exported.project.scripts);
            await closeProjects(page);

            const splitter = page.getByRole('separator', {
                name: 'Resize left panels',
                exact: true
            });
            const originalWidth = Number(await splitter.getAttribute('aria-valuenow'));
            await splitter.press('Shift+ArrowRight');
            await expect(splitter).toHaveAttribute('aria-valuenow', String(originalWidth + 40));
            await page.getByRole('button', { name: 'Move Inspector panel', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Dock left', exact: true }).click();
            await expect(page.locator('[data-workspace-dock="left"] .inspector')).toBeVisible();
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await expect(page.locator('#save-state')).toHaveAttribute('data-state', 'saved');
            await page.reload();
            await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
            await expect(
                page.getByRole('combobox', { name: 'Workspace preset', exact: true })
            ).toHaveValue('animation');
            await expect(
                page.getByRole('separator', { name: 'Resize left panels', exact: true })
            ).toHaveAttribute('aria-valuenow', String(originalWidth + 40));
            await expect(page.locator('[data-workspace-dock="left"] .inspector')).toBeVisible();
            const durable = await exportProject(page, info, 'durable-authoring.hilo-project.json');
            expect(durable.project.clips).toEqual(exported.project.clips);
            expect(durable.project.scripts).toEqual(exported.project.scripts);
            await closeProjects(page);
        });
    });
}

interface CollaborationCLI {
    url: string;
    adminToken: string;
    close(): Promise<void>;
}

async function collaborationCLI(): Promise<CollaborationCLI> {
    const directory = await mkdtemp(join(tmpdir(), 'hilo-editor-ui-cli-'));
    const adminToken = randomBytes(32).toString('hex');
    const child = spawn(
        process.execPath,
        [resolve('node_modules/jiti/lib/jiti-cli.mjs'), resolve('editor/server/cli.ts')],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                HILO_EDITOR_PORT: '0',
                HILO_EDITOR_HOST: '127.0.0.1',
                HILO_EDITOR_DATA: directory,
                HILO_EDITOR_ADMIN_TOKEN: adminToken,
                HILO_EDITOR_ORIGINS: testServerOrigin
            },
            stdio: ['ignore', 'pipe', 'pipe']
        }
    );
    const exited = new Promise<void>(finish => {
        child.once('exit', () => {
            finish();
        });
        child.once('error', () => {
            finish();
        });
    });
    let diagnostics = '';
    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', (chunk: unknown) => {
        diagnostics = `${diagnostics}${String(chunk)}`.slice(-8192);
    });
    const close = async (): Promise<void> => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        const force = setTimeout(() => {
            child.kill('SIGKILL');
        }, 5000);
        await exited;
        clearTimeout(force);
        await rm(directory, { recursive: true, force: true });
    };
    try {
        const url = await new Promise<string>((accept, reject) => {
            let output = '';
            const timeout = setTimeout(() => {
                reject(new Error(`Collaboration CLI startup timed out: ${diagnostics}`));
            }, 20_000);
            child.once('error', error => {
                clearTimeout(timeout);
                reject(error);
            });
            child.once('exit', code => {
                clearTimeout(timeout);
                reject(new Error(`Collaboration CLI exited ${String(code)}: ${diagnostics}`));
            });
            child.stdout.on('data', (chunk: unknown) => {
                output = `${output}${String(chunk)}`.slice(-8192);
                const address = /Hilo Studio collaboration: (http:\/\/127\.0\.0\.1:\d+)/u.exec(
                    output
                )?.[1];
                if (address) {
                    clearTimeout(timeout);
                    accept(address);
                }
            });
        });
        return { url, adminToken, close };
    } catch (error) {
        await close();
        throw error;
    }
}

async function openCollaboration(page: Page): Promise<void> {
    const panel = page.getByRole('dialog', { name: 'Project collaboration', exact: true });
    if (!(await panel.isVisible()))
        await page.getByRole('button', { name: 'Open collaboration', exact: true }).click();
    await expect(panel).toBeVisible();
}
async function closeCollaboration(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Close collaboration', exact: true }).click();
    await expect(
        page.getByRole('dialog', { name: 'Project collaboration', exact: true })
    ).not.toBeVisible();
}
async function renameScene(page: Page, name: string): Promise<void> {
    await page.locator('#project-name').click();
    await field(page.getByRole('textbox', { name: 'Scene name', exact: true }), name);
}

interface DecodeGate {
    entered: boolean;
    width: number;
    height: number;
    release(): void;
}
type GatedWindow = Window & { __HILO_EDITOR_DECODE_GATE__?: DecodeGate };

async function holdRealBitmapDecoder(page: Page): Promise<void> {
    await page.evaluate(() => {
        const original = window.createImageBitmap.bind(window);
        let unlock: () => void = () => undefined;
        const pending = new Promise<void>(resolveGate => {
            unlock = resolveGate;
        });
        const gate: DecodeGate = {
            entered: false,
            width: 0,
            height: 0,
            release(): void {
                unlock();
                Object.defineProperty(window, 'createImageBitmap', {
                    configurable: true,
                    writable: true,
                    value: original
                });
            }
        };
        (window as GatedWindow).__HILO_EDITOR_DECODE_GATE__ = gate;
        Object.defineProperty(window, 'createImageBitmap', {
            configurable: true,
            writable: true,
            value: async (...parameters: unknown[]): Promise<ImageBitmap> => {
                const bitmap = await (Reflect.apply(
                    original,
                    window,
                    parameters
                ) as Promise<ImageBitmap>);
                gate.width = bitmap.width;
                gate.height = bitmap.height;
                gate.entered = true;
                await pending;
                return bitmap;
            }
        });
    });
}

test('editor collaboration uses CLI capabilities and retains edits made during incoming asset decoding @webgl2', async ({
    browser
}, info) => {
    test.setTimeout(120_000);
    const service = await collaborationCLI();
    const contexts: BrowserContext[] = [];
    const monitors: PageFailureMonitor[] = [];
    let gatePage: Page | undefined;
    let roomId = '';
    try {
        const firstContext = await browser.newContext({
            viewport: { width: 1600, height: 1100 },
            deviceScaleFactor: 1
        });
        contexts.push(firstContext);
        const secondContext = await browser.newContext({
            viewport: { width: 1600, height: 1100 },
            deviceScaleFactor: 1
        });
        contexts.push(secondContext);
        const first = await firstContext.newPage();
        const second = await secondContext.newPage();
        gatePage = second;
        const pages = [first, second];
        for (const page of pages) {
            await installRenderHealthProbe(page);
            monitors.push(await installPageFailureMonitor(page));
        }
        for (const page of pages) {
            await page.goto(`${testServerOrigin}/editor/index.html?backend=webgl2&test=1`);
            await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
            await expect
                .poll(async () => completedRenderCommands(await readRenderHealth(page), 'webgl2'))
                .toBeGreaterThan(0);
        }
        await openCollaboration(first);
        await first.getByLabel('Collaboration server URL', { exact: true }).fill(service.url);
        await first.getByText('Create a room from this local project', { exact: true }).click();
        await first.getByLabel('Server admin capability', { exact: true }).fill(service.adminToken);
        await first.getByRole('button', { name: 'Create shared room', exact: true }).click();
        await expect(first.locator('.collaboration-role')).toContainText('Editor');
        roomId = await first.getByLabel('Collaboration room ID', { exact: true }).inputValue();
        const editorToken = await first
            .getByLabel('Created editor token', { exact: true })
            .inputValue();
        const viewerToken = await first
            .getByLabel('Created viewer token', { exact: true })
            .inputValue();
        expect(editorToken.length).toBeGreaterThanOrEqual(32);
        expect(viewerToken).not.toBe(editorToken);
        await closeCollaboration(first);

        await openCollaboration(second);
        await second.getByLabel('Collaboration server URL', { exact: true }).fill(service.url);
        await second.getByLabel('Collaboration room ID', { exact: true }).fill(roomId);
        await second.getByLabel('Collaboration display name', { exact: true }).fill('Reviewer');
        await second.getByLabel('Room capability token', { exact: true }).fill(viewerToken);
        await second
            .getByRole('button', { name: 'Join & load shared project', exact: true })
            .click();
        await expect(second.locator('#app')).toHaveAttribute('data-collaboration-role', 'viewer');
        await expect(
            second.getByRole('button', { name: 'Publish local changes', exact: true })
        ).toBeDisabled();
        await expect(second.locator('.collaboration-presence')).toContainText('Reviewer');
        await closeCollaboration(second);
        await second.locator('[data-select="hero-sphere"]').click();
        await expect(
            second.getByRole('spinbutton', { name: 'position.x', exact: true })
        ).toBeDisabled();
        await expect(second.getByTestId('transform-gizmo')).not.toBeVisible();

        await renameScene(first, 'Shared scene version two');
        await openCollaboration(first);
        await first.getByRole('button', { name: 'Publish local changes', exact: true }).click();
        await expect(first.locator('.collaboration-status')).toContainText('revision 2');
        await expect(second.locator('#project-name')).toHaveText('Shared scene version two');
        await closeCollaboration(first);
        await openCollaboration(second);
        await second.getByRole('button', { name: 'Disconnect', exact: true }).click();
        await second.getByLabel('Room capability token', { exact: true }).fill(editorToken);
        await second
            .getByRole('button', { name: 'Join & load shared project', exact: true })
            .click();
        await expect(second.locator('#app')).toHaveAttribute('data-collaboration-role', 'editor');
        await closeCollaboration(second);

        // Hold only the real decoder's completion. The remote snapshot remains pending while the
        // second editor makes a genuine local edit, then the original codec produces real pixels.
        await holdRealBitmapDecoder(second);
        await first.getByRole('button', { name: 'Assets', exact: true }).click();
        await first.getByLabel('Import asset files', { exact: true }).setInputFiles({
            name: 'Remote Direction.png',
            mimeType: 'image/png',
            buffer: textureBytes()
        });
        await expect(first.locator('.project-asset-card')).toHaveCount(1);
        await renameScene(first, 'Remote asset snapshot');
        await openCollaboration(first);
        const incomingSnapshot = second.waitForResponse(
            response =>
                response.url() === `${service.url}/rooms/${roomId}` &&
                response.request().method() === 'GET'
        );
        await first.getByRole('button', { name: 'Publish local changes', exact: true }).click();
        await expect(first.locator('.collaboration-status')).toContainText('revision 3');
        await second.waitForFunction(
            () => (window as GatedWindow).__HILO_EDITOR_DECODE_GATE__?.entered === true
        );
        // A real decoded bitmap proves the complete embedded asset reached this browser. The
        // snapshot reader has already consumed its JSON before entering asset validation; CDP's
        // request-finished notification can lag behind the gated application promise on CI.
        const incomingResponse = await incomingSnapshot;
        expect(incomingResponse.status()).toBe(200);
        expect(
            await second.evaluate(() => {
                const gate = (window as GatedWindow).__HILO_EDITOR_DECODE_GATE__;
                return { width: gate?.width, height: gate?.height };
            })
        ).toEqual({ width: 4, height: 4 });
        await renameScene(second, 'Late local draft during decode');
        await second.evaluate(() => {
            (window as GatedWindow).__HILO_EDITOR_DECODE_GATE__?.release();
        });
        await expect(second.locator('#project-name')).toHaveText('Late local draft during decode');
        await expect(second.locator('.collaboration-open')).toHaveAttribute(
            'data-state',
            'conflict'
        );
        await openCollaboration(second);
        await expect(second.locator('.collaboration-conflict')).toBeVisible();
        await second
            .getByRole('button', { name: 'Keep local copy & disconnect', exact: true })
            .click();
        await expect(second.locator('#app')).toHaveAttribute('data-collaboration-role', 'local');
        await expect(second.locator('#project-name')).toHaveText('Late local draft during decode');
        // Saving the separate project closes dialogs when asynchronous storage completes.
        // Wait for that activation instead of racing its closure with another close click.
        await expect(
            second.getByRole('dialog', { name: 'Project collaboration', exact: true })
        ).not.toBeVisible();
        const localCopy = await exportProject(
            second,
            info,
            'collaboration-retained-local.hilo-project.json'
        );
        expect(localCopy.project.scenes[localCopy.project.activeSceneId]?.name).toBe(
            'Late local draft during decode'
        );
        expect(Object.keys(localCopy.project.assets)).toHaveLength(0);
        await closeProjects(second);
        const response = await fetch(`${service.url}/rooms/${roomId}`, {
            headers: { Authorization: `Bearer ${viewerToken}` }
        });
        expect(response.ok).toBe(true);
        const remote: unknown = await response.json();
        if (!remote || typeof remote !== 'object')
            throw new Error('Missing shared project response');
        expect(Reflect.get(remote, 'revision')).toBe(3);
        const shared = parseProject(JSON.stringify(Reflect.get(remote, 'project')));
        expect(shared.scenes[shared.activeSceneId]?.name).toBe('Remote asset snapshot');
        expect(Object.keys(shared.assets)).toHaveLength(1);
        for (const page of pages) {
            const saved = await page.evaluate(() => JSON.stringify(localStorage));
            expect(saved).not.toContain(editorToken);
            expect(saved).not.toContain(viewerToken);
            expect(saved).not.toContain(service.adminToken);
        }
        await first.getByRole('button', { name: 'Disconnect', exact: true }).click();
        await closeCollaboration(first);
        for (const page of pages) {
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await expect(page.locator('#save-state')).toHaveAttribute('data-state', 'saved');
            await assertStableInstrumentationHealth('webgl2', 'Collaboration rendering', {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            });
            await page.evaluate(() =>
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
            );
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            await assertStableInstrumentationHealth('webgl2', 'Collaboration teardown', {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            });
        }
        for (const monitor of monitors) {
            const failures = monitor.snapshot();
            expect(failures.pageErrors).toEqual([]);
            expect(failures.consoleErrors).toEqual([]);
            expect(failures.graphicsErrors).toEqual([]);
            expect(failures.failedResponses).toEqual([]);
            // Deliberate SSE disconnect/reconnect aborts are part of this workflow; no other
            // failed network request is tolerated, including asset, source or server errors.
            expect(
                failures.failedRequests.filter(
                    message =>
                        message !== `GET ${service.url}/rooms/${roomId}/events: net::ERR_ABORTED`
                )
            ).toEqual([]);
        }
    } finally {
        await gatePage
            ?.evaluate(() => {
                (window as GatedWindow).__HILO_EDITOR_DECODE_GATE__?.release();
            })
            .catch(() => undefined);
        await Promise.allSettled(monitors.map(monitor => monitor.dispose()));
        await Promise.allSettled(contexts.map(context => context.close()));
        await service.close();
    }
});
