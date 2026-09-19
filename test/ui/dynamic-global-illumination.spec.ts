import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { ClusteredForwardPlusDiagnostics } from '../../src/render/pipeline/ClusteredForwardPlus';
import { installPageFailureMonitor } from './page-failure-monitor';
import { captureStableFrame } from './stable-capture';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    waitForStableAnimationFrames,
    installRenderHealthProbe,
    readRenderHealth
} from './render-health';

// Software GPU ray tracing competes with video encoding; retain trace and actual pixel captures.
test.use({ video: 'off' });

interface AtelierEvidence {
    readonly giEnabled: boolean;
    readonly timeOfDay: 'night' | 'day';
    readonly doorAngle: number;
    readonly lampPosition: number;
    readonly wallPalette: string;
    readonly diagnostics: Readonly<ClusteredForwardPlusDiagnostics>;
}
interface AtelierAPI {
    settle(frames?: number): Promise<AtelierEvidence>;
    setGI(enabled: boolean): void;
    setDoor(angle: number): void;
    setLamp(value: number): void;
    setWall(palette: 'sage' | 'clay' | 'chalk'): void;
    setTimeOfDay(value: 'night' | 'day'): void;
    dispose(): Promise<void>;
}
type AtelierWindow = Window & { __HILO3D_ATELIER_TEST_API__?: AtelierAPI };

async function settle(page: Page, frames = 14): Promise<AtelierEvidence> {
    return page.evaluate(async count => {
        const api = (window as AtelierWindow).__HILO3D_ATELIER_TEST_API__;
        if (api === undefined) throw new Error('Atelier test controls unavailable');
        return api.settle(count);
    }, frames);
}
function pixelDifference(
    first: Buffer,
    second: Buffer
): Readonly<{ changedRatio: number; meanRGB: number }> {
    const a = PNG.sync.read(first);
    const b = PNG.sync.read(second);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    let changed = 0;
    let sampled = 0;
    let totalDelta = 0;
    // Compare the room itself, excluding changing labels, pressed states, and controls.
    for (let i = 0; i < a.data.length; i += 4) {
        const pixel = i / 4;
        const x = pixel % a.width;
        const y = Math.floor(pixel / a.width);
        if (x < a.width * 0.22 || x > a.width * 0.9 || y < a.height * 0.18 || y > a.height * 0.76)
            continue;
        sampled++;
        totalDelta +=
            Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)) +
            Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)) +
            Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0));
        if (
            Math.max(
                Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)),
                Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)),
                Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0))
            ) > 6
        )
            changed++;
    }
    return { changedRatio: changed / sampled, meanRGB: totalDelta / (sampled * 3) };
}

function difference(first: Buffer, second: Buffer): number {
    return pixelDifference(first, second).changedRatio;
}

function sofaPigmentDifference(first: Buffer, second: Buffer): number {
    const a = PNG.sync.read(first);
    const b = PNG.sync.read(second);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    // The unpainted seat interior; the selected wall and UI are outside this rectangle.
    const left = Math.floor((a.width * 439) / 960);
    const right = Math.floor((a.width * 464) / 960);
    const top = Math.floor((a.height * 256) / 600);
    const bottom = Math.floor((a.height * 265) / 600);
    let absolute = 0;
    for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
            const offset = (y * a.width + x) * 4;
            for (let channel = 0; channel < 3; channel++)
                absolute += Math.abs(
                    (a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0)
                );
        }
    }
    return absolute / ((right - left) * (bottom - top) * 3);
}

test('Atelier presents dynamic GI, responds after captures and tears down cleanly @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(240_000);
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    try {
        await page.setViewportSize({ width: 960, height: 600 });
        await page.goto(
            '/examples/dynamic_global_illumination_atelier.html?backend=webgpu&test=1',
            { waitUntil: 'load' }
        );
        await expect(page.locator('body')).toHaveAttribute('data-atelier-ready', 'true', {
            timeout: 120_000
        });
        const initial = await settle(page, 7);
        expect(initial.timeOfDay).toBe('night');
        expect(initial.diagnostics.dynamicGlobalIllumination).toMatchObject({
            probeCount: 315,
            updatedProbeCount: 48,
            tracedRayCount: 6144
        });
        expect(initial.diagnostics.dynamicGlobalIllumination?.sceneTriangleCount).toBeGreaterThan(
            20_000
        );
        expect(initial.diagnostics.visibleObjectCount).toBeGreaterThan(0);
        await settle(page, 64);
        const lit = await captureStableFrame(page, 'webgpu');
        let previousStatic = lit;
        for (let frame = 0; frame < 16; frame++) {
            const nextStatic = await captureStableFrame(page, 'webgpu', { frames: 1 });
            const delta = pixelDifference(previousStatic, nextStatic);
            expect(delta.meanRGB, `static night frame ${String(frame)}`).toBeLessThan(0.65);
            expect(delta.changedRatio, `static night frame ${String(frame)}`).toBeLessThan(0.03);
            previousStatic = nextStatic;
        }
        await testInfo.attach('atelier-gi-on', { body: lit, contentType: 'image/png' });
        await page.locator('#giToggle').click();
        // Compare settled lighting states after the existing temporal color history has converged.
        expect((await settle(page, 32)).giEnabled).toBe(false);
        const unlit = await captureStableFrame(page, 'webgpu');
        await testInfo.attach('atelier-gi-off', { body: unlit, contentType: 'image/png' });
        expect(difference(lit, unlit)).toBeGreaterThan(0.005);
        await page.locator('button[data-wall="sage"]').click();
        await settle(page, 32);
        const sageWithoutGI = await captureStableFrame(page, 'webgpu');
        const directPigmentDelta = sofaPigmentDifference(unlit, sageWithoutGI);
        await page.locator('#giToggle').click();
        await settle(page, 64);
        const sageWithGI = await captureStableFrame(page, 'webgpu');
        const bouncedPigmentDelta = sofaPigmentDifference(lit, sageWithGI);
        expect(
            bouncedPigmentDelta,
            'wall pigment must reach the unpainted seat through GI'
        ).toBeGreaterThan(3);
        expect(bouncedPigmentDelta).toBeGreaterThan(directPigmentDelta * 4);
        expect(
            directPigmentDelta,
            'wall repaint must not secretly recolor the seat or add a tinted fill light'
        ).toBeLessThan(1.5);
        await page.locator('button[data-wall="chalk"]').click();
        await settle(page, 14);
        await page.locator('button[data-lamp="100"]').click();
        expect((await settle(page, 14)).lampPosition).toBe(100);
        const lampMoved = await captureStableFrame(page, 'webgpu');
        expect(difference(lit, lampMoved)).toBeGreaterThan(0.01);
        await page.locator('button[data-wall="clay"]').click();
        expect((await settle(page, 14)).wallPalette).toBe('clay');
        const wallChanged = await captureStableFrame(page, 'webgpu');
        expect(difference(lampMoved, wallChanged)).toBeGreaterThan(0.01);
        await page.locator('#doorButton').click();
        const changed = await settle(page, 14);
        expect(changed.doorAngle).toBe(90);
        const doorOpened = await captureStableFrame(page, 'webgpu');
        expect(difference(wallChanged, doorOpened)).toBeGreaterThan(0.005);
        await testInfo.attach('atelier-night-open-door', {
            body: doorOpened,
            contentType: 'image/png'
        });
        await page.locator('button[data-time="day"]').click();
        expect((await settle(page, 21)).timeOfDay).toBe('day');
        const daylight = await captureStableFrame(page, 'webgpu');
        expect(difference(doorOpened, daylight)).toBeGreaterThan(0.2);
        await testInfo.attach('atelier-day', { body: daylight, contentType: 'image/png' });
        // Interaction after stable capture must continue to submit actual rendering work.
        const before = changed.diagnostics.dynamicGlobalIllumination?.submittedFrameCount ?? 0;
        await page.locator('#giToggle').click();
        const after = await settle(page, 2);
        expect(after.diagnostics.dynamicGlobalIllumination?.submittedFrameCount).toBeGreaterThan(
            before
        );
        await assertStableInstrumentationHealth('webgpu', 'Atelier', {
            readRenderHealth: () => readRenderHealth(page),
            awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
            waitForStableAnimationFrames: () => waitForStableAnimationFrames(page)
        });
        await page.evaluate(async () => {
            await (window as AtelierWindow).__HILO3D_ATELIER_TEST_API__?.dispose();
            await new Promise<void>(resolve =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                        resolve();
                    })
                )
            );
        });
        failures.assertEmpty('Atelier including after resource teardown');
    } finally {
        await failures.dispose();
    }
});
