import { readFile, stat } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { parseScene } from '../../editor/scene';
import { installPageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    installRenderHealthProbe,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';
import { captureStableFrame } from './stable-capture';

let server: Server | undefined;
let origin: string;
const site = resolve('site');
const contentTypes: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};
async function serve(requestURL: string, response: ServerResponse): Promise<void> {
    const pathname = decodeURIComponent(new URL(requestURL, 'http://127.0.0.1').pathname);
    const route = pathname.startsWith('/Hilo3d/') ? pathname.slice('/Hilo3d'.length) : pathname;
    let path = resolve(site, `.${route}`);
    if (path !== site && !path.startsWith(`${site}${sep}`)) {
        response.writeHead(404).end();
        return;
    }
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory()) path = resolve(path, 'index.html');
    const body = await readFile(path).catch(() => null);
    if (!body) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, {
        'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream'
    });
    response.end(body);
}
test.beforeAll(async () => {
    await stat(resolve(site, 'editor/index.html'));
    const started = createServer((request, response) => {
        void serve(request.url ?? '/', response).catch(() => {
            response.writeHead(500).end();
        });
    });
    server = started;
    await new Promise<void>(done => {
        started.listen(0, '127.0.0.1', done);
    });
    const address = started.address();
    if (!address || typeof address === 'string')
        throw new Error('Pages test server has no TCP address');
    origin = `http://127.0.0.1:${String(address.port)}`;
});
test.afterAll(async () => {
    const running = server;
    if (running)
        await new Promise<void>((done, reject) => {
            running.close(error => {
                if (error) reject(error);
                else done();
            });
            running.closeAllConnections();
        });
});
for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`built Pages editor supports root and project subpath through ${backend}`, async ({
        browser
    }, info) => {
        for (const prefix of ['', '/Hilo3d']) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
            const page = await context.newPage();
            await installRenderHealthProbe(page);
            const failures = await installPageFailureMonitor(page);
            try {
                await page.goto(`${origin}${prefix}/editor/?backend=${backend}&test=1`);
                await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
                await expect(page.locator('#backend-label')).toHaveText(backend.toUpperCase());
                const bounds = await page.locator('#viewport canvas').boundingBox();
                if (!bounds) throw new Error('Hosted editor canvas is not visible');
                const capture = await captureStableFrame(page, backend, { frames: 2 });
                const image = PNG.sync.read(capture);
                let warmPixels = 0;
                for (let y = Math.ceil(bounds.y); y < Math.floor(bounds.y + bounds.height); y++) {
                    for (
                        let x = Math.ceil(bounds.x);
                        x < Math.floor(bounds.x + bounds.width);
                        x++
                    ) {
                        const offset = (y * image.width + x) * 4;
                        const red = image.data[offset] ?? 0;
                        const green = image.data[offset + 1] ?? 0;
                        const blue = image.data[offset + 2] ?? 0;
                        if (red > 90 && red > green * 1.25 && red > blue * 1.3) warmPixels++;
                    }
                }
                expect(
                    warmPixels,
                    'Hosted app must submit actual sculpture pixels'
                ).toBeGreaterThan(500);
                await info.attach(`pages-${prefix ? 'project-subpath' : 'root'}-${backend}`, {
                    body: capture,
                    contentType: 'image/png'
                });
                await page
                    .getByRole('button', { name: '02 · Porcelain Sphere', exact: true })
                    .click();
                const position = page.getByRole('spinbutton', { name: 'position.x', exact: true });
                await position.fill('1.25');
                await position.press('Tab');
                await expect(page.locator('#save-state')).toHaveText('Saved locally');
                await captureStableFrame(page, backend, { frames: 2 });
                await page.reload();
                await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
                await page.getByRole('button', { name: 'Scene JSON', exact: true }).click();
                const restored = parseScene(
                    await page
                        .getByRole('textbox', { name: 'Scene JSON', exact: true })
                        .inputValue()
                );
                expect(restored.nodes['hero-sphere']?.transform.position.x).toBe(1.25);
                await page
                    .locator('#source-dialog')
                    .getByRole('button', { name: 'Close dialog' })
                    .click();
                await captureStableFrame(page, backend, { frames: 2 });
                await awaitTrackedGPUQueues(page);
                await assertStableInstrumentationHealth(backend, 'Pages editor', {
                    waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                    awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                    readRenderHealth: () => readRenderHealth(page)
                });
                failures.assertEmpty(`Pages ${prefix || '/'} ${backend}`);
                await page.goto('about:blank');
                await waitForStableAnimationFrames(page);
                failures.assertEmpty(`Pages teardown ${prefix || '/'} ${backend}`);
            } catch (error) {
                await info.attach('pages-failure-health', {
                    body: Buffer.from(
                        JSON.stringify(
                            {
                                prefix,
                                backend,
                                errors: failures.snapshot(),
                                render: await readRenderHealth(page),
                                loading: await page.locator('#viewport-loading').textContent()
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
        }
    });
}
