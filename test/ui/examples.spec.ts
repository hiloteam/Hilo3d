import { expect, test } from '@playwright/test';
import { EXAMPLE_CATALOG } from '../../examples/shared/catalog';

for (const backend of ['webgl2', 'webgpu'] as const) {
    for (const entry of EXAMPLE_CATALOG) {
        test(`${entry.title} renders through ${backend} @${backend}`, async ({ page }) => {
            const failures: string[] = [];
            page.on('pageerror', error => failures.push(error.message));
            page.on('console', message => {
                if (message.type() === 'error') failures.push(message.text());
            });
            await page.goto(`${entry.path}?backend=${backend}`, { waitUntil: 'load' });
            const canvas = page.locator('canvas');
            await expect(canvas).toBeVisible({ timeout: 20_000 });
            await page.waitForFunction(
                expectedBackend => {
                    const status = window.__HILO_ECS_STATUS__;
                    return (
                        status?.backend === expectedBackend &&
                        status.submittedFrameCount >= 2 &&
                        status.cameraCount >= 1 &&
                        status.worldFrame >= 2
                    );
                },
                backend,
                { timeout: 20_000 }
            );
            expect(failures).toEqual([]);
        });
    }
}
