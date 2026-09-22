import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { buildLive2DRuntime } from '../tools/build-runtime.js';
import ts from 'typescript';

const modules: Readonly<Record<string, string>> = {
    live2dcubismframework: 'CubismFramework',
    'model/cubismmoc': 'CubismMoc',
    'math/cubismmodelmatrix': 'CubismModelMatrix',
    'motion/cubismmotionmanager': 'CubismMotionManager',
    'motion/cubismexpressionmotionmanager': 'CubismExpressionMotionManager',
    'motion/cubismmotion': 'CubismMotion',
    'motion/cubismexpressionmotion': 'CubismExpressionMotion',
    'effect/cubismeyeblink': 'CubismEyeBlink',
    'physics/cubismphysics': 'CubismPhysics',
    'effect/cubismpose': 'CubismPose'
};

async function fixture(directory: string): Promise<{ core: string; framework: string }> {
    const core = join(directory, 'Core/live2dcubismcore.min.js');
    const framework = join(directory, 'Framework/src');
    await mkdir(dirname(core), { recursive: true });
    await mkdir(framework, { recursive: true });
    await writeFile(
        core,
        `/* Authored test fixture, not a Cubism SDK binary. */
globalThis.Live2DCubismCore = { Utils: {
  hasBlendAdditiveBit: () => false, hasBlendMultiplicativeBit: () => false,
  hasIsDoubleSidedBit: () => true, hasIsInvertedMaskBit: () => false, hasIsVisibleBit: () => true
} };
`
    );
    await writeFile(join(directory, 'SDK-LICENSE.md'), 'SDK fixture notice.\n');
    await writeFile(
        join(dirname(core), 'RedistributableFiles.txt'),
        'Core fixture redistributable.\n'
    );
    await writeFile(join(dirname(core), 'LICENSE.md'), 'Core fixture notice — preserve bytes.\n');
    await writeFile(join(framework, '../LICENSE.md'), 'Framework fixture notice.\n');
    await writeFile(
        join(framework, '../tsconfig.json'),
        JSON.stringify({ compilerOptions: { target: 'es6' }, include: ['src/**/*.ts'] })
    );
    for (const [path, name] of Object.entries(modules)) {
        const file = join(framework, `${path}.ts`);
        await mkdir(dirname(file), { recursive: true });
        const inheritance = name === 'CubismMotionManager';
        await writeFile(
            file,
            `
if (!Reflect.get(globalThis, 'Live2DCubismCore')) throw new Error('Framework evaluated before Core.');
${inheritance ? 'class SDKBase { inheritedValue = 17; }' : ''}
export class ${name} ${inheritance ? 'extends SDKBase' : ''} {
  ${inheritance ? 'inheritedValue!: number; constructor() { super(); if (this.inheritedValue !== 17) throw new Error("SDK class-field emit changed inherited initialization."); }' : ''}
  static create(): null { return null; }
  static delete(): void {}
  static isStarted(): boolean { return false; }
  static startUp(): boolean { return true; }
  static isInitialized(): boolean { return true; }
  static initialize(): void {}
  static getIdManager(): object { return {}; }
}
${inheritance ? 'new CubismMotionManager();' : ''}
`
        );
    }
    return { core, framework };
}

function hash(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

void test('SDK builder preserves Core/licenses, audits modules and rejects native rendering', async (): Promise<void> => {
    const temporary = await mkdtemp(join(tmpdir(), 'hilo-live2d-build-test-'));
    try {
        const sdk = await fixture(join(temporary, 'sdk'));
        const output = join(temporary, 'public/live2d');
        await mkdir(output, { recursive: true });
        await writeFile(join(output, 'application-owned.txt'), 'keep');
        const result = await buildLive2DRuntime({
            sdkDirectory: dirname(dirname(sdk.core)),
            outputDirectory: output
        });
        const copiedCore = result.coreFile;
        assert.ok(copiedCore);
        assert.equal(hash(await readFile(copiedCore)), hash(await readFile(sdk.core)));
        assert.deepEqual(
            await readFile(join(output, 'licenses/Core.LICENSE.md')),
            await readFile(join(sdk.core, '../LICENSE.md'))
        );
        assert.equal(await readFile(join(output, 'application-owned.txt'), 'utf8'), 'keep');
        assert.deepEqual(
            await readFile(join(output, 'licenses/Addon.MIT.LICENSE')),
            await readFile(new URL('../LICENSE', import.meta.url))
        );
        assert.equal(result.frameworkModuleCount, Object.keys(modules).length);
        const manifest = await readFile(result.manifestFile, 'utf8');
        assert.ok(
            !manifest.includes(temporary),
            'Deployment provenance must not leak build-machine absolute paths.'
        );
        assert.ok(manifest.includes('"nativeRendererIncluded": false'));
        const firstCPU = await readFile(result.cpuModuleFile, 'utf8');
        const repeated = await buildLive2DRuntime({
            sdkDirectory: dirname(dirname(sdk.core)),
            outputDirectory: output
        });
        assert.equal(await readFile(repeated.cpuModuleFile, 'utf8'), firstCPU);
        await assert.rejects(
            buildLive2DRuntime({
                sdkDirectory: dirname(dirname(sdk.core)),
                outputDirectory: dirname(sdk.core)
            }),
            /separate/
        );
        const native = join(sdk.framework, 'rendering/cubismrenderer_webgl.ts');
        await mkdir(dirname(native), { recursive: true });
        await writeFile(native, 'export const nativeRenderer = true;\n');
        const frameworkEntry = join(sdk.framework, 'live2dcubismframework.ts');
        await writeFile(
            frameworkEntry,
            `import './rendering/cubismrenderer_webgl';\n${await readFile(frameworkEntry, 'utf8')}`
        );
        await assert.rejects(
            buildLive2DRuntime({
                sdkDirectory: dirname(dirname(sdk.core)),
                outputDirectory: output
            }),
            /backend-neutral|Native Cubism/
        );
        assert.equal(
            await readFile(result.cpuModuleFile, 'utf8'),
            firstCPU,
            'A failed rebuild must not replace the built CPU module.'
        );
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
});

void test('default package loader orders Core before Framework, forwards nonce, deduplicates and retries failed assets', async (): Promise<void> => {
    const temporary = await mkdtemp(join(tmpdir(), 'hilo-live2d-provider-test-'));
    const sdk = await fixture(join(temporary, 'sdk'));
    const output = join(temporary, 'runtime');
    await buildLive2DRuntime({
        sdkDirectory: dirname(dirname(sdk.core)),
        outputDirectory: output
    });
    const loaders = new Map<string, string>();
    for (const name of ['DefaultRuntime', 'RuntimeProvider']) {
        const source = await readFile(
            new URL(`../src/runtime/${name}.ts`, import.meta.url),
            'utf8'
        );
        loaders.set(
            `${name}.js`,
            ts.transpileModule(source, {
                compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
            }).outputText
        );
    }
    let failCore = false;
    let failModule = false;
    let coreRequests = 0;
    let moduleRequests = 0;
    const requestedModules: string[] = [];
    const server = createServer((request, response): void => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/') {
            response.end(`<html><title>Runtime provider test</title><script type="module">
import * as provider from '/DefaultRuntime.js';
import * as otherProvider from '/other/DefaultRuntime.js';
globalThis.__live2dProvider = provider;
globalThis.__otherLive2dProvider = otherProvider;
</script></html>`);
            return;
        }
        const name = url.pathname.split('/').at(-1) ?? '';
        const loader = loaders.get(name);
        if (loader !== undefined) {
            response.writeHead(200, {
                'Content-Type': 'text/javascript',
                'Cache-Control': 'no-store'
            });
            response.end(loader);
            return;
        }
        if (name.startsWith('live2dcubismcore.')) {
            coreRequests++;
            if (failCore) {
                failCore = false;
                response.writeHead(503, { 'Cache-Control': 'no-store' });
                response.end();
                return;
            }
        }
        if (name === 'runtime-core.js') {
            moduleRequests++;
            requestedModules.push(url.search);
            if (failModule) {
                failModule = false;
                response.writeHead(503, { 'Cache-Control': 'no-store' });
                response.end();
                return;
            }
        }
        void readFile(join(output, name)).then(
            bytes => {
                response.writeHead(200, {
                    'Content-Type': 'text/javascript',
                    'Cache-Control': 'no-store'
                });
                response.end(bytes);
            },
            () => {
                response.writeHead(404);
                response.end();
            }
        );
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    const browser = await chromium.launch({ channel: 'chromium' });
    try {
        const page = await browser.newPage();
        await page.goto(origin);
        const report = await page.evaluate(
            async (): Promise<{
                apiVersion: number;
                samePromise: boolean;
                nonce: string | undefined;
            }> => {
                const provider = Reflect.get(globalThis, '__live2dProvider') as {
                    createDefaultLive2DRuntime(options?: {
                        nonce?: string;
                    }): Promise<{ apiVersion: number }>;
                };
                const first = provider.createDefaultLive2DRuntime({ nonce: 'sdk-test-nonce' });
                const second = provider.createDefaultLive2DRuntime();
                return {
                    apiVersion: (await first).apiVersion,
                    samePromise: first === second,
                    nonce: document.querySelector<HTMLScriptElement>('script[src]')?.nonce
                };
            }
        );
        assert.deepEqual(report, { apiVersion: 1, samePromise: true, nonce: 'sdk-test-nonce' });
        assert.equal(coreRequests, 1);
        assert.equal(moduleRequests, 1);
        failCore = true;
        await page.goto(origin);
        const coreRetry = await page.evaluate(
            async (): Promise<{ rejected: boolean; apiVersion: number }> => {
                const provider = Reflect.get(globalThis, '__live2dProvider') as {
                    createDefaultLive2DRuntime(): Promise<{ apiVersion: number }>;
                };
                let rejected = false;
                try {
                    await provider.createDefaultLive2DRuntime();
                } catch {
                    rejected = true;
                }
                return {
                    rejected,
                    apiVersion: (await provider.createDefaultLive2DRuntime()).apiVersion
                };
            }
        );
        assert.deepEqual(coreRetry, { rejected: true, apiVersion: 1 });
        assert.equal(coreRequests, 3);
        failModule = true;
        await page.goto(origin);
        const moduleRetry = await page.evaluate(
            async (): Promise<{ rejected: boolean; apiVersion: number }> => {
                const provider = Reflect.get(globalThis, '__live2dProvider') as {
                    createDefaultLive2DRuntime(): Promise<{ apiVersion: number }>;
                };
                let rejected = false;
                try {
                    await provider.createDefaultLive2DRuntime();
                } catch {
                    rejected = true;
                }
                return {
                    rejected,
                    apiVersion: (await provider.createDefaultLive2DRuntime()).apiVersion
                };
            }
        );
        assert.deepEqual(moduleRetry, { rejected: true, apiVersion: 1 });
        assert.ok(requestedModules.includes('?__hilo_retry=1'));
        const conflict = await page.evaluate(async (): Promise<string> => {
            const provider = Reflect.get(globalThis, '__otherLive2dProvider') as {
                createDefaultLive2DRuntime(): Promise<unknown>;
            };
            try {
                await provider.createDefaultLive2DRuntime();
                return '';
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        });
        assert.match(conflict, /different Cubism Core deployment/);
    } finally {
        await browser.close();
        await new Promise<void>((resolve, reject) =>
            server.close(error => {
                if (error) reject(error);
                else resolve();
            })
        );
        await rm(temporary, { recursive: true, force: true });
    }
});
