import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { installPageFailureMonitor } from './page-failure-monitor';
import type { RenderingProductionAPI } from './fixtures/rendering-production';

type FixtureWindow = Window & { __HILO_RENDERING_PRODUCTION__?: RenderingProductionAPI };

function changedRatio(first: Buffer, second: Buffer): number {
    const a = PNG.sync.read(first),
        b = PNG.sync.read(second);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    let changed = 0;
    for (let offset = 0; offset < a.data.length; offset += 4)
        if (
            Math.max(
                ...[0, 1, 2].map(channel =>
                    Math.abs((a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0))
                )
            ) > 8
        )
            changed++;
    return changed / (a.width * a.height);
}

test.use({ video: 'off' });
for (const [backend, advanced] of [
    ['webgl2', false],
    ['webgpu', true]
] as const) {
    test(`production surface composition presents and remains interactive on ${backend}`, async ({
        page
    }, testInfo) => {
        test.setTimeout(120_000);
        const failures = await installPageFailureMonitor(page);
        if (testInfo.project.name === 'chromium-native-webgpu' && backend === 'webgpu') {
            await page.addInitScript(() => {
                const original = navigator.gpu.requestAdapter.bind(navigator.gpu);
                navigator.gpu.requestAdapter = async options => {
                    const adapter = await original(options);
                    if (adapter?.info.isFallbackAdapter !== false)
                        throw new Error(
                            'Physical rendering acceptance requires a non-fallback adapter'
                        );
                    return adapter;
                };
            });
        }
        try {
            await page.goto(
                `/test/ui/fixtures/rendering-production.html?backend=${backend}&advanced=${advanced ? '1' : '0'}`
            );
            await page.waitForFunction(
                () =>
                    (window as FixtureWindow).__HILO_RENDERING_PRODUCTION__ !== undefined ||
                    document.body.dataset['failure'] !== undefined
            );
            expect(await page.locator('body').getAttribute('data-failure')).toBeNull();
            const canvas = page.locator('canvas');
            if (advanced) {
                const initial = await page.evaluate(
                    async () =>
                        await (window as FixtureWindow).__HILO_RENDERING_PRODUCTION__?.diagnostics()
                );
                expect(initial?.dynamicGlobalIllumination?.exclusions.disabled).toBe(1);
            }
            const before = await canvas.screenshot({
                path: testInfo.outputPath(`${backend}-initial-composition.png`)
            });
            await page.getByRole('button', { name: 'Toggle decal' }).click();
            await page.evaluate(async () => {
                await (window as FixtureWindow).__HILO_RENDERING_PRODUCTION__?.render();
            });
            const withoutDecal = await canvas.screenshot();
            expect(changedRatio(before, withoutDecal)).toBeGreaterThan(0.08);
            await page.getByRole('button', { name: 'Toggle smoke' }).click();
            await page.evaluate(async () => {
                await (window as FixtureWindow).__HILO_RENDERING_PRODUCTION__?.render();
            });
            const withoutSmoke = await canvas.screenshot();
            expect(changedRatio(withoutDecal, withoutSmoke)).toBeGreaterThan(0.02);
            if (advanced) {
                const diagnostics = await page.evaluate(
                    async () =>
                        await (window as FixtureWindow).__HILO_RENDERING_PRODUCTION__?.diagnostics()
                );
                expect(diagnostics?.dynamicGlobalIllumination?.exclusions.disabled).toBe(0);
                expect(diagnostics?.dynamicGlobalIllumination?.exclusions.material).toBe(0);
                expect(diagnostics?.volumetricFroxelCount).toBeGreaterThan(0);
            }
            await page.evaluate(async () => {
                await (window as FixtureWindow).__HILO_RENDERING_PRODUCTION__?.resize(320, 240);
            });
            expect(await canvas.getAttribute('width')).toBe('320');
            await page.getByRole('button', { name: 'Toggle decal' }).click();
            await page.evaluate(async () => {
                await (window as FixtureWindow).__HILO_RENDERING_PRODUCTION__?.render();
            });
            await testInfo.attach(`${backend}-production-composition`, {
                body: await canvas.screenshot({
                    path: testInfo.outputPath(`${backend}-composition.png`)
                }),
                contentType: 'image/png'
            });
            await page.evaluate(async () => {
                await (window as FixtureWindow).__HILO_RENDERING_PRODUCTION__?.dispose();
            });
            await page.waitForTimeout(150);
            failures.assertEmpty('production composition including post-teardown observation');
        } finally {
            await failures.dispose();
        }
    });
}
