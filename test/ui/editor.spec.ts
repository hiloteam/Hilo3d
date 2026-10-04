import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { parseScene, serializeScene, type SceneDocument } from '../../editor/scene';
import { testServerOrigin } from '../../scripts/playwright-test-server';
import type { ExampleBackend } from './example-paths';
import { installPageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    readRenderHealth,
    waitForStableAnimationFrames,
    type NativeRenderProgress
} from './render-health';
import { captureStableFrame } from './stable-capture';

async function progress(page: Page, backend: ExampleBackend): Promise<NativeRenderProgress> {
    return nativeRenderProgress(await readRenderHealth(page), backend);
}

async function expectProgress(
    page: Page,
    backend: ExampleBackend,
    before: NativeRenderProgress
): Promise<void> {
    await expect
        .poll(async () =>
            nativeRenderProgressAdvanced(before, await progress(page, backend), backend)
        )
        .toBe(true);
}

async function changeInput(input: Locator, value: string): Promise<void> {
    await input.fill(value);
    await input.press('Tab');
}

async function openSource(page: Page): Promise<SceneDocument> {
    await page.getByRole('button', { name: 'Scene JSON', exact: true }).click();
    await expect(page.locator('#source-dialog')).toBeVisible();
    return parseScene(
        await page.getByRole('textbox', { name: 'Scene JSON', exact: true }).inputValue()
    );
}

async function closeSource(page: Page): Promise<void> {
    await page.locator('#source-dialog').getByRole('button', { name: 'Close dialog' }).click();
}

async function applySource(page: Page, document: SceneDocument): Promise<void> {
    await page
        .getByRole('textbox', { name: 'Scene JSON', exact: true })
        .fill(serializeScene(document));
    await page.getByRole('button', { name: 'Apply scene', exact: true }).click();
    await expect(page.locator('#source-dialog')).not.toBeVisible();
}

function viewportPixels(
    screenshot: Buffer,
    bounds: { x: number; y: number; width: number; height: number }
): Buffer {
    const image = PNG.sync.read(screenshot);
    const x = Math.ceil(bounds.x);
    const y = Math.ceil(bounds.y);
    const width = Math.floor(bounds.width) - 1;
    const height = Math.floor(bounds.height) - 1;
    const pixels = Buffer.alloc(width * height * 3);
    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
            const source = ((row + y) * image.width + column + x) * 4;
            const destination = (row * width + column) * 3;
            image.data.copy(pixels, destination, source, source + 3);
        }
    }
    return pixels;
}

function warmPixelCount(pixels: Buffer): number {
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 3) {
        const red = pixels[offset] ?? 0;
        const green = pixels[offset + 1] ?? 0;
        const blue = pixels[offset + 2] ?? 0;
        if (red > 70 && red > green * 1.15 && green > blue * 1.1) count += 1;
    }
    return count;
}

function changedPixelCount(first: Buffer, second: Buffer): number {
    expect(first.length).toBe(second.length);
    let count = 0;
    for (let offset = 0; offset < first.length; offset += 3) {
        const difference =
            Math.abs((first[offset] ?? 0) - (second[offset] ?? 0)) +
            Math.abs((first[offset + 1] ?? 0) - (second[offset + 1] ?? 0)) +
            Math.abs((first[offset + 2] ?? 0) - (second[offset + 2] ?? 0));
        if (difference > 45) count += 1;
    }
    return count;
}

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`editor authors and round trips a rendered scene on ${backend} @${backend}`, async ({
        browser
    }, testInfo) => {
        test.setTimeout(90_000);
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            deviceScaleFactor: 1,
            acceptDownloads: true
        });
        const page = await context.newPage();
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`${testServerOrigin}/editor/index.html?backend=${backend}&test=1`);
            await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
            await expect(page.locator('#backend-label')).toHaveText(backend.toUpperCase());
            const canvas = page.locator('#viewport canvas');
            await expect(canvas).toBeVisible();
            await expect
                .poll(async () => completedRenderCommands(await readRenderHealth(page), backend))
                .toBeGreaterThan(0);
            const bounds = await canvas.boundingBox();
            if (!bounds) throw new Error('Editor canvas has no visible bounds');
            const initialScreenshot = await captureStableFrame(page, backend, { frames: 2 });
            const initialPixels = viewportPixels(initialScreenshot, bounds);
            expect(
                warmPixelCount(initialPixels),
                'The submitted viewport must contain the terracotta sculpture'
            ).toBeGreaterThan(500);
            await mkdir(resolve('reports'), { recursive: true });
            await writeFile(resolve(`reports/editor-${backend}.png`), initialScreenshot);
            await testInfo.attach(`editor-${backend}`, {
                body: initialScreenshot,
                contentType: 'image/png'
            });

            // Select through the actual GPU picking pass, independently of hierarchy navigation.
            await page.getByRole('button', { name: 'Scene settings', exact: true }).click();
            await expect(
                page.getByRole('textbox', { name: 'Scene name', exact: true })
            ).toBeVisible();
            const beforePick = await progress(page, backend);
            await canvas.click({ position: { x: bounds.width * 0.5, y: bounds.height * 0.35 } });
            await expect(
                page.getByRole('textbox', { name: 'Object name', exact: true })
            ).toHaveValue('02 · Porcelain Sphere');
            await expectProgress(page, backend, beforePick);

            const preview = page.getByRole('button', { name: 'Orbit preview', exact: true });
            await preview.click();
            await expect(preview).toHaveAttribute('aria-pressed', 'true');
            const beforeViewChange = await progress(page, backend);
            await page
                .getByRole('combobox', { name: 'Camera view', exact: true })
                .selectOption('front');
            await expect(preview).toHaveAttribute('aria-pressed', 'false');
            await expect(
                page.getByRole('combobox', { name: 'Camera view', exact: true })
            ).toHaveValue('front');
            await expectProgress(page, backend, beforeViewChange);
            await page
                .getByRole('combobox', { name: 'Camera view', exact: true })
                .selectOption('perspective');
            const grid = page.getByRole('button', { name: 'Toggle grid', exact: true });
            await grid.click();
            await expect(grid).toHaveAttribute('aria-pressed', 'false');
            await grid.click();
            await expect(grid).toHaveAttribute('aria-pressed', 'true');
            const transformBaseline = viewportPixels(
                await captureStableFrame(page, backend, { frames: 2 }),
                bounds
            );

            // Real property editing after capture must change the native rendered scene.
            const initialProgress = await progress(page, backend);
            await page.getByRole('button', { name: '02 · Porcelain Sphere', exact: true }).click();
            await expect(
                page.getByRole('textbox', { name: 'Object name', exact: true })
            ).toHaveValue('02 · Porcelain Sphere');
            await changeInput(
                page.getByRole('textbox', { name: 'Object name', exact: true }),
                'Porcelain Hero'
            );
            await changeInput(
                page.getByRole('spinbutton', { name: 'position.x', exact: true }),
                '1.25'
            );
            await expect(
                page.getByRole('spinbutton', { name: 'position.y', exact: true })
            ).toBeFocused();
            await expect(
                page.getByRole('button', { name: 'Porcelain Hero', exact: true })
            ).toBeVisible();
            await expectProgress(page, backend, initialProgress);
            const editedPixels = viewportPixels(
                await captureStableFrame(page, backend, { frames: 2 }),
                bounds
            );
            expect(
                changedPixelCount(transformBaseline, editedPixels),
                'Transform changes must affect compositor pixels'
            ).toBeGreaterThan(500);

            await page.getByRole('button', { name: 'Add Cube', exact: true }).click();
            await expect(page.getByRole('treeitem')).toHaveCount(10);
            await expect(
                page.getByRole('textbox', { name: 'Object name', exact: true })
            ).toHaveValue('Cube');
            await page.getByRole('button', { name: 'Undo (⌘ Z)', exact: true }).click();
            await expect(page.getByRole('treeitem')).toHaveCount(9);
            await page.getByRole('button', { name: 'Redo (⌘ ⇧ Z)', exact: true }).click();
            await expect(page.getByRole('treeitem')).toHaveCount(10);

            const source = await openSource(page);
            const cube = source.nodes['cube-001'];
            if (!cube) throw new Error('Added cube was not serialized');
            source.name = 'AI Authored Study';
            cube.transform.position.x = 2.25;
            await applySource(page, source);
            await expect(page.locator('#project-name')).toHaveText('AI Authored Study');
            await page.getByRole('button', { name: 'Cube', exact: true }).click();
            await expect(
                page.getByRole('spinbutton', { name: 'position.x', exact: true })
            ).toHaveValue('2.25');

            const applied = await openSource(page);
            const invalid = structuredClone(applied);
            const invalidCube = invalid.nodes['cube-001'];
            if (!invalidCube) throw new Error('Missing cube in source transaction');
            invalidCube.parent = 'missing-parent';
            invalid.name = 'Must Not Apply';
            await page
                .getByRole('textbox', { name: 'Scene JSON', exact: true })
                .fill(JSON.stringify(invalid));
            await page.getByRole('button', { name: 'Apply scene', exact: true }).click();
            await expect(page.locator('#source-dialog')).toBeVisible();
            await expect(page.locator('#source-error')).toContainText('missing node');
            await page
                .getByRole('textbox', { name: 'Scene JSON', exact: true })
                .press('ControlOrMeta+s');
            await expect(page.locator('#source-dialog')).toBeVisible();
            await expect(page.locator('#source-error')).toContainText('missing node');
            const tooManyLights = structuredClone(applied);
            const keyLight = tooManyLights.nodes['key-light'];
            if (!keyLight) throw new Error('Default scene is missing its light');
            for (let index = 1; index <= 8; index += 1) {
                tooManyLights.nodes[`extra-light-${String(index)}`] = structuredClone(keyLight);
            }
            await page
                .getByRole('textbox', { name: 'Scene JSON', exact: true })
                .fill(JSON.stringify(tooManyLights));
            await page
                .getByRole('textbox', { name: 'Scene JSON', exact: true })
                .press('ControlOrMeta+s');
            await expect(page.locator('#source-dialog')).toBeVisible();
            await expect(page.locator('#source-error')).toContainText(
                'directional light limit is 8'
            );
            await closeSource(page);
            expect(
                await openSource(page),
                'Rejected source must not partially replace the scene'
            ).toEqual(applied);
            await closeSource(page);
            await page.getByRole('button', { name: 'Undo (⌘ Z)', exact: true }).click();
            await expect(page.locator('#project-name')).toHaveText('Terracotta Study');
            await page.getByRole('button', { name: 'Redo (⌘ ⇧ Z)', exact: true }).click();
            await expect(page.locator('#project-name')).toHaveText('AI Authored Study');

            // Source keyboard saving follows the same validated transaction as Apply.
            const keyboardSource = await openSource(page);
            keyboardSource.environment.background = '#383a3d';
            await page
                .getByRole('textbox', { name: 'Scene JSON', exact: true })
                .fill(serializeScene(keyboardSource));
            await page
                .getByRole('textbox', { name: 'Scene JSON', exact: true })
                .press('ControlOrMeta+s');
            await expect(page.locator('#source-dialog')).not.toBeVisible();
            applied.environment.background = '#383a3d';

            // Ctrl/Cmd S must commit the active inspector field without requiring blur first.
            await page.getByRole('button', { name: 'Cube', exact: true }).click();
            const focusedPosition = page.getByRole('spinbutton', {
                name: 'position.y',
                exact: true
            });
            await focusedPosition.fill('1.75');
            await expect(focusedPosition).toBeFocused();
            await focusedPosition.press('ControlOrMeta+s');
            const appliedCube = applied.nodes['cube-001'];
            if (!appliedCube) throw new Error('Missing cube for focused save');
            appliedCube.transform.position.y = 1.75;
            const keyboardSaved = await page.evaluate(() =>
                localStorage.getItem('hilo-studio.scene.v1')
            );
            if (!keyboardSaved) throw new Error('Keyboard save produced no persisted scene');
            expect(parseScene(keyboardSaved)).toEqual(applied);
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await expect(page.locator('#save-state')).toHaveText('Saved locally');
            await page.reload();
            await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
            expect(
                await openSource(page),
                'Reload must restore the saved authoring document'
            ).toEqual(applied);
            await closeSource(page);

            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: 'Export scene', exact: true }).click();
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toBe('ai-authored-study.hilo.json');
            const downloadedPath = testInfo.outputPath('exported-scene.hilo.json');
            await download.saveAs(downloadedPath);
            const exported = await readFile(downloadedPath, 'utf8');
            expect(parseScene(exported)).toEqual(applied);
            expect(exported).toBe(serializeScene(applied));
            await page.getByRole('button', { name: 'Scene settings', exact: true }).click();
            await changeInput(
                page.getByRole('textbox', { name: 'Scene name', exact: true }),
                'Before Import'
            );
            await expect(page.locator('#project-name')).toHaveText('Before Import');
            await page.locator('#file-input').setInputFiles(downloadedPath);
            await expect(page.locator('#project-name')).toHaveText('AI Authored Study');
            expect(
                await openSource(page),
                'File import must restore the complete exported document'
            ).toEqual(applied);
            await closeSource(page);

            // BFCache suspension retains resources and resumes actual rendering.
            await page.evaluate(() =>
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
            );
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            const suspendedProgress = await progress(page, backend);
            await waitForStableAnimationFrames(page);
            expect(await progress(page, backend)).toEqual(suspendedProgress);
            await page.evaluate(() =>
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
            );
            await expectProgress(page, backend, suspendedProgress);
            await assertStableInstrumentationHealth(backend, `Editor ${backend} before teardown`, {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            });

            // Observe asynchronous errors after destruction, while the document is still alive.
            await page.evaluate(() =>
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
            );
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            const destroyedProgress = await progress(page, backend);
            await waitForStableAnimationFrames(page);
            expect(await progress(page, backend)).toEqual(destroyedProgress);
            await assertStableInstrumentationHealth(backend, `Editor ${backend} after teardown`, {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            });
            failures.assertEmpty(`Editor ${backend} authoring and lifecycle`);
            await page.goto('about:blank');
            failures.assertEmpty(`Editor ${backend} navigation teardown`);
        } finally {
            await failures.dispose();
            await context.close();
        }
    });
}
