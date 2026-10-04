import assert from 'node:assert/strict';
import { copyFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

/** Real decoding, user-gesture unlock, streaming and offline PCM from an installed audio tarball. */
export async function verifyAudioPackage(consumer: string): Promise<void> {
    const requestedDirectory = join(consumer, 'audio-browser');
    await mkdir(requestedDirectory);
    const directory = await realpath(requestedDirectory);
    for (const name of ['helpers.ts', 'package-fixture.ts']) {
        await copyFile(
            resolve(import.meta.dirname, '../test/spec/audio', name),
            join(directory, name)
        );
    }
    await writeFile(
        join(directory, 'main.ts'),
        `import { verifyPackedAudio } from './package-fixture';
document.querySelector('button')!.onclick = () => {
    verifyPackedAudio().then(() => { document.body.dataset.result = 'passed'; }, error => { document.body.dataset.error = String(error); });
};
`
    );
    await writeFile(
        join(directory, 'index.html'),
        '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><button>Enable audio</button><script type="module" src="./main.ts"></script></body></html>'
    );
    await build({ configFile: false, root: directory, logLevel: 'warn', base: './' });
    const server = await preview({
        configFile: false,
        root: directory,
        logLevel: 'warn',
        preview: { host: '127.0.0.1', port: 0 }
    });
    try {
        const address = server.httpServer.address();
        if (!address || typeof address === 'string')
            throw new Error('Audio package preview did not listen.');
        const browser = await chromium.launch();
        try {
            const page = await browser.newPage();
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`http://127.0.0.1:${String(address.port)}/`);
            await page.getByRole('button', { name: 'Enable audio' }).click();
            await page.waitForFunction(
                () => document.body.dataset['result'] ?? document.body.dataset['error'],
                undefined,
                { timeout: 15000 }
            );
            assert.equal(await page.locator('body').getAttribute('data-error'), null);
            assert.equal(await page.locator('body').getAttribute('data-result'), 'passed');
            // Observe the task after teardown as well as during playback.
            await page.waitForTimeout(100);
            assert.deepEqual(errors, []);
            console.log(
                'Verified packed audio decode, real user-gesture streaming, PCM output and teardown.'
            );
        } finally {
            await browser.close();
        }
    } finally {
        await new Promise<void>((accept, reject) =>
            server.httpServer.close(error => {
                if (error) reject(error);
                else accept();
            })
        );
    }
}
