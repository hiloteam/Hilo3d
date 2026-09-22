import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium, type Route } from 'playwright';
import { build, preview } from 'vite';

interface RuntimeFile {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
}

async function serveFile(route: Route, root: string, name: string): Promise<void> {
    const file = resolve(root, name);
    assert.ok(file.startsWith(`${resolve(root)}${sep}`));
    await route.fulfill({
        body: await readFile(file),
        contentType:
            extname(file) === '.js'
                ? 'text/javascript'
                : extname(file) === '.png'
                  ? 'image/png'
                  : 'application/octet-stream',
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
    });
}

/** Exercise installed, built packages in a browser; the fixture imports no repository sources. */
export async function verifyLive2DPackage(consumer: string): Promise<void> {
    const root = resolve(import.meta.dirname, '..');
    const runtime = join(consumer, 'node_modules/@hilo/addon-live2d/dist/runtime/prebuilt');
    const manifest = JSON.parse(
        await readFile(join(runtime, 'live2d-runtime.manifest.json'), 'utf8')
    ) as {
        core: RuntimeFile;
        cpuModule: RuntimeFile;
        provider: RuntimeFile;
        licenses: RuntimeFile[];
    };
    for (const file of [
        manifest.core,
        manifest.cpuModule,
        manifest.provider,
        ...manifest.licenses
    ]) {
        const bytes = await readFile(join(runtime, file.path));
        assert.equal(bytes.byteLength, file.bytes);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
    assert.deepEqual(
        await readFile(join(runtime, manifest.core.path)),
        await readFile(join(root, 'addon-live2d/vendor/cubism-5-r.5/Core/live2dcubismcore.min.js'))
    );
    assert.match(
        await readFile(
            join(consumer, 'node_modules/@hilo/addon-live2d/THIRD-PARTY-NOTICES.md'),
            'utf8'
        ),
        /Proprietary Software License/
    );
    const fixtureDirectory = join(consumer, 'live2d-browser');
    await mkdir(fixtureDirectory);
    const fixture = await realpath(fixtureDirectory);
    await copyFile(join(root, 'test/fixtures/live2d-package.ts'), join(fixture, 'main.ts'));
    await writeFile(
        join(fixture, 'index.html'),
        '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="./main.ts"></script></body></html>'
    );
    await build({ configFile: false, root: fixture, logLevel: 'warn', build: { minify: false } });
    const emittedAssets = join(fixture, 'dist/assets');
    const coreAsset = (await readdir(emittedAssets)).find(name =>
        name.startsWith('live2dcubismcore.min-')
    );
    assert.ok(coreAsset, 'The application build must emit the package-local Core executable.');
    assert.deepEqual(
        await readFile(join(emittedAssets, coreAsset)),
        await readFile(join(runtime, manifest.core.path))
    );
    const server = await preview({
        configFile: false,
        root: fixture,
        logLevel: 'warn',
        preview: { host: '127.0.0.1', port: 0, open: false }
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
        const address = server.httpServer.address();
        assert.ok(address && typeof address !== 'string');
        const origin = `http://127.0.0.1:${String(address.port)}`;
        browser = await chromium.launch({
            args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
        });
        for (const mode of ['default', 'nonce', 'retry']) {
            const page = await browser.newPage();
            const errors: string[] = [];
            const requests: string[] = [];
            let cpuRequests = 0;
            page.on('pageerror', error => errors.push(error.message));
            // The installed addon must emit its own assets. Block all external network access.
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                requests.push(url.href);
                if (url.origin !== origin) {
                    errors.push(`Unexpected external request: ${url.href}`);
                    await route.abort('blockedbyclient');
                } else if (url.pathname.startsWith('/models/')) {
                    await serveFile(
                        route,
                        join(root, 'examples/models/live2d/Miku'),
                        url.pathname.slice('/models/'.length)
                    );
                } else {
                    if (url.pathname.includes('/runtime-core-')) {
                        cpuRequests++;
                        if (mode === 'retry' && cpuRequests === 1) {
                            await route.fulfill({ status: 503, body: '' });
                            return;
                        }
                    }
                    await route.continue();
                }
            });
            await page.goto(`${origin}/?mode=${mode}`);
            await page.waitForFunction(
                () => document.body.dataset['result'] !== undefined,
                undefined,
                {
                    timeout: 30_000
                }
            );
            const report = await page.evaluate(() =>
                Object.fromEntries(Object.entries(document.body.dataset))
            );
            assert.equal(report['result'], 'passed', report['error']);
            assert.equal(report['lazy'], 'true');
            assert.equal(report['nonce'], mode === 'nonce' ? 'package-test-nonce' : '');
            assert.deepEqual(errors, []);
            assert.equal(cpuRequests, mode === 'retry' ? 2 : 1);
            assert.equal(requests.filter(url => url.includes('/live2dcubismcore.min-')).length, 1);
            if (mode === 'retry') {
                assert.equal(report['retried'], 'true');
                assert.ok(
                    requests.some(url => new URL(url).searchParams.get('__hilo_retry') === '1')
                );
            }
            await page.close();
        }
        console.log(
            'Verified packed Live2D default runtime, concurrent models, pixels, local assets, nonce and import retry.'
        );
    } finally {
        await browser?.close();
        await new Promise<void>((resolveClose, reject) => {
            server.httpServer.close(error => {
                if (error) reject(error);
                else resolveClose();
            });
        });
    }
}
