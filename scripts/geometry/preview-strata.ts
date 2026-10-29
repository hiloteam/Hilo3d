import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installRenderHealthProbe } from '../../test/ui/render-health';
import { captureStableFrame } from '../../test/ui/stable-capture';

const withoutShadows = process.argv.includes('--without-shadows');
const destination = resolve(
    withoutShadows ? 'reports/strata-preview-no-shadows' : 'reports/strata-preview'
);
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    args: [
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
        '--disable-software-rasterizer',
        process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=default'
    ]
});
const page = await browser.newPage({
    viewport: { width: 1672, height: 941 },
    deviceScaleFactor: 1
});
const errors: string[] = [];
page.on('pageerror', error => {
    errors.push(error.message);
});
page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
});
try {
    await installRenderHealthProbe(page);
    await page.goto(
        `http://127.0.0.1:4173/examples/meshlet_strata.html?backend=webgpu&test=1&quality=production${withoutShadows ? '&shadows=0' : ''}`
    );
    await page.waitForFunction(
        () =>
            document.body.dataset['ready'] === 'true' ||
            document.body.dataset['failure'] === 'true',
        undefined,
        { timeout: 120_000 }
    );
    if ((await page.locator('body').getAttribute('data-failure')) === 'true')
        throw new Error(await page.locator('#failure').innerText());
    for (const view of ['overview', 'passage', 'surface'] as const) {
        await page.locator(`#view-${view}`).click();
        const pixels = await captureStableFrame(page, 'webgpu', { frames: 12 });
        await writeFile(resolve(destination, `${view}.png`), pixels);
    }
    await page.setViewportSize({ width: 430, height: 860 });
    await page.locator('#view-overview').click();
    await writeFile(
        resolve(destination, 'portrait.png'),
        await captureStableFrame(page, 'webgpu', { frames: 12 })
    );
    await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    });
    await page.waitForTimeout(150);
    if (errors.length) throw new AggregateError(errors, 'STRATA preview browser failures');
    console.log(`Saved four real GPU STRATA captures to ${destination}`);
} finally {
    if (errors.length) console.error(errors.join('\n'));
    await browser.close();
}
