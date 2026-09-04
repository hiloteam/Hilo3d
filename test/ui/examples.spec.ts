import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createExampleCatalog } from '../../examples/shared/catalog';

const EXAMPLE_READY_TIMEOUT = 45_000;
test.setTimeout(60_000);

function collectExamplePages(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) return collectExamplePages(absolutePath);
        if (!entry.name.endsWith('.html')) return [];
        return [relative('examples', absolutePath).split(sep).join('/')];
    });
}

const catalog = createExampleCatalog(
    collectExamplePages('examples').filter(path => path !== 'index.html' && path !== 'list.html')
);

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`gallery restores the searchable split-view shell through ${backend} @${backend}`, async ({
        page
    }) => {
        await page.goto(`index.html?backend=${backend}`, { waitUntil: 'load' });
        await expect(page).toHaveURL(new RegExp(`/examples/list\\.html\\?backend=${backend}`));
        await expect(page.getByRole('heading', { name: 'Hilo3D Examples' })).toBeVisible();
        await expect(page.locator('#exampleCount')).toContainText(`of ${String(catalog.length)}`);
        await expect(page.locator('#currentTitle')).toHaveText('Quick Start');
        await expect(page.frameLocator('#exampleFrame').locator('canvas')).toBeVisible({
            timeout: EXAMPLE_READY_TIMEOUT
        });

        await page.locator('#exampleSearch').fill('geometry custom');
        await page.getByRole('button', { name: /Geometry Custom/u }).click();
        await expect(page.locator('#currentTitle')).toHaveText('Geometry Custom');
        await expect(page).toHaveURL(/#geometry_custom$/u);
    });

    for (const entry of catalog) {
        test(`${entry.title} renders through ${backend} @${backend}`, async ({ page }) => {
            const failures: string[] = [];
            page.on('pageerror', error => failures.push(error.message));
            page.on('console', message => {
                if (message.type() === 'error') failures.push(message.text());
            });
            await page.goto(`${entry.path}?backend=${backend}`, { waitUntil: 'load' });
            const canvas = page
                .locator('#app > canvas, #container > canvas, #stageContainer > canvas')
                .first();
            await expect(canvas).toBeVisible({ timeout: EXAMPLE_READY_TIMEOUT });
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
                { timeout: EXAMPLE_READY_TIMEOUT }
            );
            expect(failures).toEqual([]);
        });
    }
}
