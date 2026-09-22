import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

/** Validate installed tarballs, including emitted worker/WASM assets, without source aliases or CDN. */
export async function verifyAssetPackage(consumer: string): Promise<void> {
    const directory = join(consumer, 'asset-browser');
    await mkdir(directory);
    const fixture = await realpath(directory);
    await copyFile(
        join(import.meta.dirname, 'fixtures/render-assets.ts'),
        join(fixture, 'render-assets.ts')
    );
    await copyFile(
        resolve(import.meta.dirname, '../../test/asset/ktx2/etc1s.ktx2'),
        join(fixture, 'etc1s.ktx2')
    );
    await writeFile(
        join(fixture, 'main.ts'),
        "import { renderAssets } from './render-assets';\nconst backend = new URL(location.href).searchParams.get('backend') === 'webgpu' ? 'webgpu' : 'webgl2';\nrenderAssets(backend, new URL('./etc1s.ktx2', import.meta.url).href).then(result => { document.body.dataset.result = JSON.stringify(result); }, error => { document.body.dataset.error = String(error); });\n"
    );
    await writeFile(
        join(fixture, 'index.html'),
        '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="./main.ts"></script></body></html>'
    );
    await build({
        configFile: false,
        root: fixture,
        logLevel: 'warn',
        base: './',
        worker: { format: 'es' },
        build: { assetsInlineLimit: 0 }
    });
    const server = await preview({
        configFile: false,
        root: fixture,
        logLevel: 'warn',
        preview: { host: '127.0.0.1', port: 0 }
    });
    const address = server.httpServer.address();
    if (address === null || typeof address === 'string')
        throw new Error('Asset package preview did not listen.');
    const browser = await chromium.launch({
        args: [
            '--enable-unsafe-swiftshader',
            '--enable-unsafe-webgpu',
            '--use-angle=swiftshader',
            '--use-webgpu-adapter=swiftshader'
        ]
    });
    try {
        for (const backend of ['webgl2', 'webgpu']) {
            const page = await browser.newPage();
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`http://127.0.0.1:${String(address.port)}/?backend=${backend}`);
            await page.waitForFunction(
                () =>
                    document.body.dataset['result'] !== undefined ||
                    document.body.dataset['error'] !== undefined,
                undefined,
                { timeout: 30000 }
            );
            const failure = await page.locator('body').getAttribute('data-error');
            assert.equal(failure, null);
            const result = JSON.parse(
                (await page.locator('body').getAttribute('data-result')) ?? '{}'
            ) as { before: number[]; after: number[]; stableIdentity: boolean };
            assert.equal(result.stableIdentity, true);
            assert.deepEqual(result.after, result.before);
            assert.ok(new Set(result.before).size > 16);
            assert.deepEqual(errors, []);
            await page.close();
        }
        const addonManifest = JSON.parse(
            await readFile(join(consumer, 'node_modules/@hilo/addon-assets/package.json'), 'utf8')
        ) as { dependencies?: unknown };
        assert.equal(
            addonManifest.dependencies,
            undefined,
            'The WASM build input must not become a consumer JavaScript dependency.'
        );
        console.log(
            'Verified packed asset worker/WASM, real pixels and recovery on WebGL2/WebGPU.'
        );
    } finally {
        await browser.close();
        await new Promise<void>((accept, reject) =>
            server.httpServer.close(error => {
                if (error) reject(error);
                else accept();
            })
        );
    }
}
