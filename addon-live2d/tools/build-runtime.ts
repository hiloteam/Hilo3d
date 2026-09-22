import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup, type Plugin, type RollupOutput } from 'rollup';
import ts from 'typescript';

type TypeScriptModule = typeof ts;

/** Internal package build inputs. The fixed SDK layout is also used by authored test fixtures. */
export interface BuildLive2DRuntimeOptions {
    readonly sdkDirectory: string;
    readonly outputDirectory: string;
}

/** Package assets and audit counts produced by the internal builder. */
export interface BuildLive2DRuntimeResult {
    readonly coreFile: string;
    readonly cpuModuleFile: string;
    readonly manifestFile: string;
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
interface BuilderFiles {
    readonly packageFile: string;
    readonly packageRoot: string;
    readonly adapterFile: string;
}

async function resolveBuilderFiles(): Promise<BuilderFiles> {
    // Self-resolution retains the checkout location when Vite bundles its configuration.
    const packageFile = fileURLToPath(import.meta.resolve('@hilo/addon-live2d/package.json'));
    const packageRoot = dirname(packageFile);
    const adapterFile = join(packageRoot, 'src/cubism/CubismRuntime.ts');
    if (!(await isFile(adapterFile)))
        throw new Error('The internal runtime builder requires addon sources.');
    return { packageFile, packageRoot, adapterFile };
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
    compiler: TypeScriptModule,
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
            const result = compiler.transpileModule(code, {
                fileName: id,
                reportDiagnostics: true,
                compilerOptions: {
                    target: compiler.ScriptTarget.ES2022,
                    module: compiler.ModuleKind.ESNext,
                    moduleResolution: compiler.ModuleResolutionKind.Bundler,
                    isolatedModules: true,
                    useDefineForClassFields: within(framework, id)
                        ? sdkUseDefineForClassFields
                        : true,
                    removeComments: false,
                    sourceMap: false
                }
            });
            const errors =
                result.diagnostics?.filter(
                    item => item.category === compiler.DiagnosticCategory.Error
                ) ?? [];
            if (errors.length > 0) {
                throw new Error(
                    errors
                        .map(item => compiler.flattenDiagnosticMessageText(item.messageText, '\n'))
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

/** Build package-local CPU assets while preserving Core, licenses and source provenance. */
export async function buildLive2DRuntime(
    options: Readonly<BuildLive2DRuntimeOptions>
): Promise<BuildLive2DRuntimeResult> {
    const sdkRoot = await realpath(options.sdkDirectory);
    const core = await realpath(join(sdkRoot, 'Core/live2dcubismcore.min.js'));
    const framework = await realpath(join(sdkRoot, 'Framework/src'));
    const frameworkRoot = dirname(framework);
    const output = await canonicalDestination(resolve(options.outputDirectory));
    if (within(sdkRoot, output) || within(output, sdkRoot)) {
        throw new Error('The output directory must be separate from the SDK inputs.');
    }
    const { packageFile, packageRoot, adapterFile } = await resolveBuilderFiles();
    const packageInfo: unknown = JSON.parse(await readFile(packageFile, 'utf8'));
    if (
        typeof packageInfo !== 'object' ||
        packageInfo === null ||
        !('version' in packageInfo) ||
        typeof packageInfo.version !== 'string'
    ) {
        throw new Error('The addon package version is missing.');
    }
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
                banner: '// Bundled Live2D Cubism Framework CPU modules; see licenses/ and live2d-runtime.manifest.json.'
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
    const coreName = 'live2dcubismcore.min.js';
    const cpuName = 'runtime-core.js';
    await mkdir(output, { recursive: true });
    const coreTarget = join(output, coreName);
    const cpuTarget = join(output, cpuName);
    await copyFile(core, coreTarget);
    await writeFile(cpuTarget, cpuCode);
    const licenses: FileDigest[] = [];
    for (const [source, name] of [
        [join(sdkRoot, 'Core/LICENSE.md'), 'Core.LICENSE.md'],
        [join(frameworkRoot, 'LICENSE.md'), 'Framework.LICENSE.md'],
        [join(packageRoot, 'LICENSE'), 'Addon.MIT.LICENSE'],
        [join(sdkRoot, 'Core/RedistributableFiles.txt'), 'Core.RedistributableFiles.txt'],
        [join(sdkRoot, 'SDK-LICENSE.md'), 'SDK.LICENSE.md']
    ] as const) {
        const target = join(output, 'licenses', name);
        const info = await preserveFile(source, target);
        licenses.push({ ...info, path: `licenses/${info.path}` });
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
                tools: { node: process.version, typescript: ts.version }
            },
            null,
            2
        )}\n`
    );
    return {
        coreFile: coreTarget,
        cpuModuleFile: cpuTarget,
        manifestFile,
        frameworkModuleCount: sdkSources.length
    };
}
