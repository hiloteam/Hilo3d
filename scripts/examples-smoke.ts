import { chromium } from 'playwright';
import { createServer } from 'vite';

const examplePaths = [
    'quickStart.html',
    'geometry_box.html',
    'post_process.html',
    'loader/tga/tga_loader.html',
    'glTFViewer/index.html'
] as const;

const server = await createServer({
    configFile: 'vite.examples.config.ts',
    logLevel: 'silent',
    server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false
    }
});

await server.listen();
const baseUrl = server.resolvedUrls?.local[0];
if (!baseUrl) throw new Error('The examples Vite server did not expose a local URL.');

const browser = await chromium.launch({ headless: true });

try {
    for (const path of examplePaths) {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(`console: ${message.text()}`);
        });

        const response = await page.goto(`${baseUrl}examples/${path}`, {
            waitUntil: 'load',
            timeout: 30_000
        });
        await page.waitForTimeout(500);
        const state = await page.evaluate(() => ({
            canvasCount: document.querySelectorAll('canvas').length,
            hasHilo3d: typeof window.Hilo3d === 'object'
        }));
        await page.close();

        if (!response?.ok() || !state.hasHilo3d || state.canvasCount === 0 || errors.length > 0) {
            throw new Error(JSON.stringify({ path, status: response?.status(), ...state, errors }));
        }
        console.log(`✓ examples/${path}`);
    }
} finally {
    await browser.close();
    await server.close();
}
