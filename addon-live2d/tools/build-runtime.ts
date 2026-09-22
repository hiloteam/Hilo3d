#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin, RollupOutput } from 'rollup';

import type * as TypeScript from 'typescript';

type TypeScriptModule = typeof TypeScript;

/** Explicit user-owned SDK inputs for a self-hosted Live2D runtime deployment. */
export interface BuildLive2DRuntimeOptions {
    /** Original, unmodified Cubism Core browser executable from the user's licensed SDK. */
    readonly coreFile: string;
    /** Official Framework directory, or its src directory. */
    readonly frameworkDirectory: string;
    /** Deployment directory receiving runtime.js, immutable assets, licenses and provenance. */
    readonly outputDirectory: string;
    /** Explicit Core license override when the SDK uses a nonstandard directory layout. */
    readonly coreLicenseFile?: string;
    /** Explicit Framework license override when the SDK uses a nonstandard layout. */
    readonly frameworkLicenseFile?: string;
    /** Additional SDK notices to preserve byte-for-byte. */
    readonly additionalLicenseFiles?: readonly string[];
    /** Stable names for package/bundler assets; standalone deployments default to content hashes. */
    readonly assetNaming?: 'content-hash' | 'stable';
}

/** Paths and audit counts emitted by one completed SDK deployment build. */
export interface BuildLive2DRuntimeResult {
    readonly runtimeFile: string;
    readonly manifestFile: string;
    readonly files: readonly string[];
    readonly frameworkModuleCount: number;
}

interface FileDigest {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
}

interface FrameworkModule {
    readonly name: string;
    readonly path: string;
}

const frameworkModules: readonly FrameworkModule[] = [
    { name: 'CubismFramework', path: 'live2dcubismframework' },
    { name: 'CubismMoc', path: 'model/cubismmoc' },
    { name: 'CubismModelMatrix', path: 'math/cubismmodelmatrix' },
    { name: 'CubismMotionManager', path: 'motion/cubismmotionmanager' },
    { name: 'CubismExpressionMotionManager', path: 'motion/cubismexpressionmotionmanager' },
    { name: 'CubismMotion', path: 'motion/cubismmotion' },
    { name: 'CubismExpressionMotion', path: 'motion/cubismexpressionmotion' },
    { name: 'CubismEyeBlink', path: 'effect/cubismeyeblink' },
    { name: 'CubismPhysics', path: 'physics/cubismphysics' },
    { name: 'CubismPose', path: 'effect/cubismpose' }
];
const cpuEntry = '\0hilo-live2d-cpu-entry';
const providerEntry = '\0hilo-live2d-provider-entry';
interface BuilderFiles {
    readonly packageFile: string;
    readonly packageRoot: string;
    readonly adapterFile: string;
    readonly providerFile: string;
}

async function resolveBuilderFiles(): Promise<BuilderFiles> {
    // Self-resolution survives Vite's bundled config loader and npm bin symlinks. A checkout uses
    // its reviewed TS sources; a published package uses only the shipped dist modules.
    const packageFile = fileURLToPath(import.meta.resolve('@hilo/addon-live2d/package.json'));
    const packageRoot = dirname(packageFile);
    const sourceAdapter = join(packageRoot, 'src/cubism/CubismRuntime.ts');
    const source = await isFile(sourceAdapter);
    const adapterFile = source ? sourceAdapter : join(packageRoot, 'dist/cubism/CubismRuntime.js');
    const providerFile = join(
        packageRoot,
        source ? 'src/runtime/RuntimeProvider.ts' : 'dist/runtime/RuntimeProvider.js'
    );
    if (!(await isFile(adapterFile)) || !(await isFile(providerFile))) {
        throw new Error('The Live2D runtime builder is missing its adapter or provider module.');
    }
    return { packageFile, packageRoot, adapterFile, providerFile };
}

function digest(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

async function isFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch (error) {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
        )
            return false;
        throw error;
    }
}

async function canonicalDestination(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch (error) {
        if (
            typeof error !== 'object' ||
            error === null ||
            !('code' in error) ||
            error.code !== 'ENOENT'
        )
            throw error;
        const parent = dirname(path);
        if (parent === path) throw error;
        return join(await canonicalDestination(parent), basename(path));
    }
}

function within(directory: string, path: string): boolean {
    const local = relative(directory, path);
    return local === '' || (!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`));
}

async function firstFile(
    candidates: readonly string[],
    description: string,
    remedy = 'supply its explicit license option'
): Promise<string> {
    for (const candidate of candidates) if (await isFile(candidate)) return realpath(candidate);
    throw new Error(`${description} is missing; ${remedy}.`);
}

async function frameworkSource(path: string): Promise<string> {
    const root = await realpath(path);
    if (await isFile(join(root, 'live2dcubismframework.ts'))) return root;
    if (await isFile(join(root, 'src/live2dcubismframework.ts'))) return join(root, 'src');
    throw new Error('--framework-dir must contain official Framework/src TypeScript sources.');
}

function assertCPUModule(path: string): void {
    const normalized = path.replaceAll('\\', '/').toLowerCase();
    if (
        normalized.includes('/rendering/') &&
        !/\/cubism(?:renderer|clippingmanager)\.(?:ts|js)$/.test(normalized)
    ) {
        throw new Error(
            `Only backend-neutral Cubism rendering data types may enter the CPU runtime: ${basename(path)}`
        );
    }
    if (
        /_webgl\d*\.(?:ts|js)$|_webgpu\.(?:ts|js)$/.test(normalized) ||
        normalized.endsWith('/cubismusermodel.ts') ||
        normalized.endsWith('/cubismusermodel.js')
    ) {
        throw new Error(
            `Native Cubism rendering is forbidden in the CPU runtime: ${basename(path)}`
        );
    }
}

function createPlugin(
    ts: TypeScriptModule,
    virtualEntries: ReadonlyMap<string, string>,
    framework: string,
    sdkUseDefineForClassFields: boolean
): Plugin {
    return {
        name: 'hilo-live2d-official-typescript',
        async resolveId(id, importer): Promise<string | null> {
            if (virtualEntries.has(id)) return id;
            if (!isAbsolute(id) && !id.startsWith('.')) {
                throw new Error(
                    `The deployed runtime must be self-contained; unexpected import ${id}.`
                );
            }
            const base = isAbsolute(id) ? id : resolve(dirname(importer ?? ''), id);
            const candidates = [base];
            if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`);
            candidates.push(
                `${base}.ts`,
                `${base}.js`,
                join(base, 'index.ts'),
                join(base, 'index.js')
            );
            for (const candidate of candidates) {
                if (await isFile(candidate)) {
                    const resolved = await realpath(candidate);
                    assertCPUModule(resolved);
                    return resolved;
                }
            }
            throw new Error(`Cannot resolve SDK runtime module ${id}.`);
        },
        load(id): string | null {
            return virtualEntries.get(id) ?? null;
        },
        transform(code, id) {
            if (!id.endsWith('.ts')) return null;
            const result = ts.transpileModule(code, {
                fileName: id,
                reportDiagnostics: true,
                compilerOptions: {
                    target: ts.ScriptTarget.ES2022,
                    module: ts.ModuleKind.ESNext,
                    moduleResolution: ts.ModuleResolutionKind.Bundler,
                    isolatedModules: true,
                    useDefineForClassFields: within(framework, id)
                        ? sdkUseDefineForClassFields
                        : true,
                    removeComments: false,
                    sourceMap: false
                }
            });
            const errors =
                result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ??
                [];
            if (errors.length > 0) {
                throw new Error(
                    errors
                        .map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'))
                        .join('\n')
                );
            }
            return { code: result.outputText, map: null };
        }
    };
}

function singleModule(output: RollupOutput): string {
    const chunk = output.output[0];
    if (output.output.length !== 1 || chunk.imports.length > 0) {
        throw new Error('The SDK build must produce one self-contained ESM module per entry.');
    }
    return chunk.code;
}

function coreFactorySource(framework: string, adapterFile: string): string {
    const imports = frameworkModules.map(
        module =>
            `import { ${module.name} } from ${JSON.stringify(join(framework, `${module.path}.ts`))};`
    );
    return [
        `import { createCubismRuntime } from ${JSON.stringify(adapterFile)};`,
        ...imports,
        'export function createLive2DRuntime() {',
        `  return createCubismRuntime({ Core: globalThis.Live2DCubismCore, ${frameworkModules.map(module => module.name).join(', ')} });`,
        '}'
    ].join('\n');
}

async function preserveFile(source: string, target: string): Promise<FileDigest> {
    const bytes = await readFile(source);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    return { path: basename(target), bytes: bytes.byteLength, sha256: digest(bytes) };
}

/**
 * Build a deployable ESM runtime from an explicitly supplied, licensed Cubism SDK.
 *
 * This normally transpiles and bundles official CPU TypeScript. It never rewrites Core, imports
 * a native Cubism renderer, or copies model artwork into the addon. Output licenses are preserved
 * unchanged; the manifest records exactly which Framework sources entered the deployment.
 */
export async function buildLive2DRuntime(
    options: Readonly<BuildLive2DRuntimeOptions>
): Promise<BuildLive2DRuntimeResult> {
    const assetNaming: unknown = options.assetNaming;
    if (assetNaming !== undefined && assetNaming !== 'content-hash' && assetNaming !== 'stable') {
        throw new TypeError('Live2D assetNaming must be content-hash or stable.');
    }
    const core = await realpath(options.coreFile);
    const framework = await frameworkSource(options.frameworkDirectory);
    const frameworkRoot = dirname(framework);
    const output = await canonicalDestination(resolve(options.outputDirectory));
    if (within(frameworkRoot, output) || within(output, core) || output === dirname(core)) {
        throw new Error('The output directory must be separate from the supplied SDK inputs.');
    }
    if (!(await isFile(core))) throw new Error('--core-file must be the original Core executable.');
    const coreLicense = options.coreLicenseFile
        ? await realpath(options.coreLicenseFile)
        : await firstFile(
              [
                  join(dirname(core), 'CORE-LICENSE.md'),
                  join(dirname(core), 'LICENSE.md'),
                  join(dirname(core), 'LICENSE.txt'),
                  join(dirname(core), '..', 'LICENSE.md')
              ],
              'Cubism Core license'
          );
    const frameworkLicense = options.frameworkLicenseFile
        ? await realpath(options.frameworkLicenseFile)
        : await firstFile(
              [
                  join(frameworkRoot, 'LICENSE.md'),
                  join(frameworkRoot, 'LICENSE.txt'),
                  join(frameworkRoot, 'LICENSE')
              ],
              'Cubism Framework license'
          );
    const additional = [...(options.additionalLicenseFiles ?? [])];
    for (const name of ['SDK-LICENSE.md', 'LICENSE.md', 'LICENSE.txt']) {
        const candidate = join(frameworkRoot, '..', name);
        if (await isFile(candidate)) additional.push(candidate);
    }
    for (const directory of [dirname(core), frameworkRoot, dirname(frameworkRoot)]) {
        for (const name of ['NOTICE', 'NOTICE.md', 'NOTICE.txt', 'THIRD-PARTY-NOTICES.md']) {
            const candidate = join(directory, name);
            if (await isFile(candidate)) additional.push(candidate);
        }
    }
    const { packageFile, packageRoot, adapterFile, providerFile } = await resolveBuilderFiles();
    const packageInfo: unknown = JSON.parse(await readFile(packageFile, 'utf8'));
    if (
        typeof packageInfo !== 'object' ||
        packageInfo === null ||
        !('version' in packageInfo) ||
        typeof packageInfo.version !== 'string'
    ) {
        throw new Error('The addon package version is missing.');
    }
    const [{ rollup }, { default: ts }] = await Promise.all([
        import('rollup'),
        import('typescript')
    ]).catch((cause: unknown): never => {
        throw new Error(
            'SDK runtime building needs optional development tools. Install them with: npm install --save-dev rollup typescript',
            { cause }
        );
    });
    const sdkConfigFile = join(frameworkRoot, 'tsconfig.json');
    let sdkUseDefineForClassFields = false;
    if (await isFile(sdkConfigFile)) {
        const sdkConfig = ts.getParsedCommandLineOfConfigFile(
            sdkConfigFile,
            {},
            {
                ...ts.sys,
                onUnRecoverableConfigFileDiagnostic(diagnostic): void {
                    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
                }
            }
        );
        if (!sdkConfig)
            throw new Error('Unable to read the official Framework compiler configuration.');
        sdkUseDefineForClassFields =
            sdkConfig.options.useDefineForClassFields ??
            (sdkConfig.options.target !== undefined &&
                sdkConfig.options.target >= ts.ScriptTarget.ES2022);
    }
    const entries = new Map<string, string>([
        [cpuEntry, coreFactorySource(framework, adapterFile)]
    ]);
    const plugin = createPlugin(ts, entries, framework, sdkUseDefineForClassFields);
    let circularDependencies = 0;
    const cpuBundle = await rollup({
        input: cpuEntry,
        plugins: [plugin],
        onwarn(warning): void {
            // Official Framework compatibility namespaces contain self-imports and CPU cycles.
            if (warning.code === 'CIRCULAR_DEPENDENCY') {
                circularDependencies++;
                return;
            }
            throw new Error(warning.message);
        }
    });
    let cpuCode: string;
    let sdkSources: FileDigest[];
    let adapterSources: FileDigest[];
    try {
        cpuCode = singleModule(
            await cpuBundle.generate({
                format: 'es',
                banner: '// User-provided Live2D Cubism Framework CPU modules; see licenses/ and live2d-runtime.manifest.json.'
            })
        );
        sdkSources = await Promise.all(
            cpuBundle.watchFiles
                .filter(path => within(framework, path))
                .sort()
                .map(async path => {
                    const bytes = await readFile(path);
                    return {
                        path: relative(framework, path).split(sep).join('/'),
                        bytes: bytes.byteLength,
                        sha256: digest(bytes)
                    };
                })
        );
        adapterSources = await Promise.all(
            cpuBundle.watchFiles
                .filter(path => within(packageRoot, path) && !within(framework, path))
                .sort()
                .map(async path => {
                    const bytes = await readFile(path);
                    return {
                        path: relative(packageRoot, path).split(sep).join('/'),
                        bytes: bytes.byteLength,
                        sha256: digest(bytes)
                    };
                })
        );
    } finally {
        await cpuBundle.close();
    }
    const coreBytes = await readFile(core);
    const coreName =
        options.assetNaming === 'stable'
            ? 'live2dcubismcore.min.js'
            : `live2dcubismcore.${digest(coreBytes).slice(0, 16)}.min.js`;
    const cpuName =
        options.assetNaming === 'stable'
            ? 'runtime-core.js'
            : `runtime-core.${digest(Buffer.from(cpuCode)).slice(0, 16)}.js`;
    entries.set(
        providerEntry,
        [
            `import { createRuntimeProvider } from ${JSON.stringify(providerFile)};`,
            'export const apiVersion = 1;',
            `export const createLive2DRuntime = createRuntimeProvider({ coreUrl: new URL(${JSON.stringify(coreName)}, import.meta.url), moduleUrl: new URL(${JSON.stringify(cpuName)}, import.meta.url) });`
        ].join('\n')
    );
    const providerBundle = await rollup({ input: providerEntry, plugins: [plugin] });
    let providerCode: string;
    try {
        providerCode = singleModule(await providerBundle.generate({ format: 'es' }));
    } finally {
        await providerBundle.close();
    }
    await mkdir(output, { recursive: true });
    const files: string[] = [];
    const coreTarget = join(output, coreName);
    const cpuTarget = join(output, cpuName);
    files.push(coreTarget, cpuTarget);
    await copyFile(core, coreTarget);
    await writeFile(cpuTarget, cpuCode);
    const licenses: FileDigest[] = [];
    for (const [source, name] of [
        [coreLicense, 'Core.LICENSE.md'],
        [frameworkLicense, 'Framework.LICENSE.md'],
        [join(packageRoot, 'LICENSE'), 'Addon.MIT.LICENSE']
    ] as const) {
        const target = join(output, 'licenses', name);
        const info = await preserveFile(source, target);
        licenses.push({ ...info, path: `licenses/${info.path}` });
        files.push(target);
    }
    for (const [index, source] of [...new Set(additional)].entries()) {
        const target = join(output, 'licenses', `SDK-${String(index + 1)}-${basename(source)}`);
        const info = await preserveFile(source, target);
        licenses.push({ ...info, path: `licenses/${info.path}` });
        files.push(target);
    }
    const manifestFile = join(output, 'live2d-runtime.manifest.json');
    await writeFile(
        manifestFile,
        `${JSON.stringify(
            {
                schemaVersion: 1,
                runtimeApiVersion: 1,
                core: {
                    path: coreName,
                    sourceFileName: basename(core),
                    bytes: coreBytes.byteLength,
                    sha256: digest(coreBytes)
                },
                cpuModule: {
                    path: cpuName,
                    bytes: Buffer.byteLength(cpuCode),
                    sha256: digest(Buffer.from(cpuCode))
                },
                framework: {
                    sources: sdkSources,
                    nativeRendererIncluded: false,
                    circularDependencies,
                    compilerOptions: {
                        target: 'ES2022',
                        useDefineForClassFields: sdkUseDefineForClassFields
                    }
                },
                licenses,
                generator: {
                    name: '@hilo/addon-live2d',
                    version: packageInfo.version,
                    adapterSources
                },
                provider: {
                    path: 'runtime.js',
                    bytes: Buffer.byteLength(providerCode),
                    sha256: digest(Buffer.from(providerCode))
                },
                tools: { node: process.version, typescript: ts.version }
            },
            null,
            2
        )}\n`
    );
    files.push(manifestFile);
    const runtimeFile = join(output, 'runtime.js');
    const temporary = join(output, `.runtime-${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, providerCode);
        await rename(temporary, runtimeFile);
    } finally {
        await rm(temporary, { force: true });
    }
    files.push(runtimeFile);
    return { runtimeFile, manifestFile, files, frameworkModuleCount: sdkSources.length };
}

const usage = `Usage: hilo-live2d-runtime --sdk <official SDK directory> --output <public/live2d>
   or: hilo-live2d-runtime --core-file <Core executable> --framework-dir <Framework/src> --output <public/live2d>

Optional: --core-license <file> --framework-license <file> --license <additional notice> (repeatable)

Consumes a user-provided SDK. Core and licenses are copied unchanged; no SDK or model files are supplied by the addon.
`;

/** Parse the deployment CLI without loading optional build dependencies for --help. */
export async function runLive2DRuntimeCLI(args: readonly string[]): Promise<void> {
    if (args.length === 0 || args.includes('--help')) {
        process.stdout.write(usage);
        return;
    }
    const values = new Map<string, string>();
    const licenses: string[] = [];
    const supported = new Set([
        '--sdk',
        '--core-file',
        '--framework-dir',
        '--output',
        '--core-license',
        '--framework-license',
        '--license'
    ]);
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        const value = args[index + 1];
        if (!flag || !supported.has(flag) || !value || value.startsWith('--'))
            throw new Error(`Invalid runtime build argument ${flag ?? ''}.\n${usage}`);
        if (flag === '--license') licenses.push(value);
        else if (values.has(flag)) throw new Error(`Duplicate runtime build option ${flag}.`);
        else values.set(flag, value);
    }
    const sdkDirectory = values.get('--sdk');
    if (sdkDirectory && (values.has('--core-file') || values.has('--framework-dir'))) {
        throw new Error('Use --sdk or explicit --core-file/--framework-dir paths, not both.');
    }
    const coreFile = sdkDirectory
        ? await firstFile(
              [
                  join(sdkDirectory, 'Core/live2dcubismcore.min.js'),
                  join(sdkDirectory, 'Core/live2dcubismcore.js')
              ],
              'SDK Core executable',
              'provide the complete SDK or use explicit input paths'
          )
        : values.get('--core-file');
    const frameworkDirectory = sdkDirectory
        ? join(sdkDirectory, 'Framework')
        : values.get('--framework-dir');
    const outputDirectory = values.get('--output');
    if (!coreFile || !frameworkDirectory || !outputDirectory) throw new Error(usage);
    const coreLicenseFile = values.get('--core-license');
    const frameworkLicenseFile = values.get('--framework-license');
    const result = await buildLive2DRuntime({
        coreFile,
        frameworkDirectory,
        outputDirectory,
        ...(coreLicenseFile === undefined ? {} : { coreLicenseFile }),
        ...(frameworkLicenseFile === undefined ? {} : { frameworkLicenseFile }),
        additionalLicenseFiles: licenses
    });
    process.stdout.write(
        `Built ${result.runtimeFile} from ${String(result.frameworkModuleCount)} official Framework CPU modules.\n`
    );
}

const invokedFile = process.argv[1];
if (
    invokedFile &&
    (await isFile(resolve(invokedFile))) &&
    pathToFileURL(await realpath(invokedFile)).href === import.meta.url
) {
    try {
        await runLive2DRuntimeCLI(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
