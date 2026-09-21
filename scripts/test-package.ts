import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build as buildVite } from 'vite';
import { parseNpmPackResult } from './npm-pack-result';

const projectRoot = resolve(import.meta.dirname, '..');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'hilo3d-package-'));
const archiveDirectory = join(temporaryRoot, 'archive');
const consumerDirectory = join(temporaryRoot, 'consumer');

function pack(packageDirectory: string): string {
    const packOutput = execFileSync(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', archiveDirectory],
        { cwd: packageDirectory, encoding: 'utf8' }
    );
    return join(archiveDirectory, parseNpmPackResult(packOutput).filename);
}

try {
    await mkdir(archiveDirectory);
    await mkdir(consumerDirectory);

    const archivePath = pack(projectRoot);
    const particleArchivePath = pack(resolve(projectRoot, 'addon-particle'));
    const physicsArchivePath = pack(resolve(projectRoot, 'addon-physics'));
    const live2DArchivePath = pack(resolve(projectRoot, 'addon-live2d'));

    await writeFile(
        join(consumerDirectory, 'package.json'),
        JSON.stringify({ name: 'hilo3d-package-consumer', private: true, type: 'module' }, null, 2),
        'utf8'
    );
    execFileSync(
        'npm',
        [
            'install',
            '--ignore-scripts',
            '--offline',
            '--no-audit',
            '--no-fund',
            '--no-package-lock',
            archivePath,
            particleArchivePath,
            physicsArchivePath,
            live2DArchivePath,
            resolve(projectRoot, 'node_modules/gl-matrix'),
            resolve(projectRoot, 'node_modules/web-naga'),
            resolve(projectRoot, 'node_modules/@dimforge/rapier2d-compat'),
            resolve(projectRoot, 'node_modules/@dimforge/rapier3d-compat')
        ],
        { cwd: consumerDirectory, stdio: 'inherit' }
    );

    // Compile and bundle the documented modules against installed tarballs, without source aliases.
    const recipeDirectory = join(consumerDirectory, 'recipes');
    await cp(resolve(projectRoot, 'test/types/recipes'), recipeDirectory, { recursive: true });
    const recipeFiles = (await readdir(recipeDirectory)).filter(name => name.endsWith('.ts'));
    const live2DExportTypes = join(consumerDirectory, 'live2d-exports.test.ts');
    await writeFile(
        live2DExportTypes,
        [
            "import { Live2DModel, configureLive2D, type Live2DConfiguration, type Live2DModelLoadOptions, type Live2DRuntime } from '@hilo/addon-live2d';",
            "import { createCubismRuntime } from '@hilo/addon-live2d/cubism';",
            "import { buildLive2DRuntime, runLive2DRuntimeCLI, type BuildLive2DRuntimeOptions, type BuildLive2DRuntimeResult } from '@hilo/addon-live2d/tools';",
            'const load: (url: string | URL, options?: Readonly<Live2DModelLoadOptions>) => Promise<Live2DModel> = Live2DModel.load;',
            'const configure: (options: Readonly<Live2DConfiguration>) => void = configureLive2D;',
            'const runtime: (namespace: unknown) => Live2DRuntime = createCubismRuntime;',
            'const build: (options: Readonly<BuildLive2DRuntimeOptions>) => Promise<BuildLive2DRuntimeResult> = buildLive2DRuntime;',
            'const cli: (args: readonly string[]) => Promise<void> = runLive2DRuntimeCLI;',
            'void [load, configure, runtime, build, cli];',
            ''
        ].join('\n'),
        'utf8'
    );
    execFileSync(
        process.execPath,
        [
            resolve(projectRoot, 'node_modules/typescript/bin/tsc'),
            '--strict',
            '--noEmit',
            '--target',
            'ES2022',
            '--module',
            'NodeNext',
            '--moduleResolution',
            'NodeNext',
            '--lib',
            'ES2022,ESNext.Disposable,DOM,DOM.Iterable',
            ...recipeFiles.map(name => join(recipeDirectory, name)),
            live2DExportTypes
        ],
        { cwd: consumerDirectory, stdio: 'inherit' }
    );
    await buildVite({
        configFile: false,
        root: consumerDirectory,
        logLevel: 'warn',
        build: {
            outDir: join(consumerDirectory, 'recipe-build'),
            lib: {
                entry: Object.fromEntries(
                    recipeFiles.map(name => [name.slice(0, -3), join(recipeDirectory, name)])
                ),
                formats: ['es']
            },
            minify: false
        }
    });

    await writeFile(
        join(consumerDirectory, 'esm-consumer.mjs'),
        [
            "import { Renderer, Vector3, version } from 'hilo3d';",
            "import { createParticleStageSystem } from '@hilo/addon-particle';",
            "import { createPhysicsStageSystem } from '@hilo/addon-physics';",
            "import { Live2DNode, Live2DModel, configureLive2D, createCubismCoreSource, live2DFeature, loadLive2DAssets } from '@hilo/addon-live2d';",
            "import { createCubismRuntime } from '@hilo/addon-live2d/cubism';",
            "import { buildLive2DRuntime, runLive2DRuntimeCLI } from '@hilo/addon-live2d/tools';",
            "import { createRapier2DPhysicsSystem } from '@hilo/addon-physics/rapier2d';",
            "import { createRapier3DPhysicsSystem } from '@hilo/addon-physics/rapier3d';",
            "import { existsSync, readFileSync } from 'node:fs';",
            "for (const optionalTool of ['rollup', 'typescript']) if (existsSync(`node_modules/${optionalTool}`)) throw new Error(`Consumer unexpectedly installed optional build tool ${optionalTool}`);",
            "if (typeof Renderer !== 'function') throw new Error('Renderer is not exported.');",
            "if (typeof Vector3 !== 'function') throw new Error('Vector3 is not exported.');",
            "if (typeof version !== 'string') throw new Error('version is not exported.');",
            "if (typeof createParticleStageSystem !== 'function') throw new Error('Particle System factory is not exported.');",
            "if (typeof createPhysicsStageSystem !== 'function') throw new Error('Physics System factory is not exported.');",
            "if (typeof Live2DNode !== 'function' || typeof createCubismCoreSource !== 'function' || typeof loadLive2DAssets !== 'function' || typeof live2DFeature.create !== 'function') throw new Error('Live2D public API is not exported.');",
            "if (typeof Live2DModel !== 'function' || typeof Live2DModel.load !== 'function' || typeof configureLive2D !== 'function') throw new Error('High-level Live2D API is not exported.');",
            "if (typeof createCubismRuntime !== 'function' || typeof buildLive2DRuntime !== 'function' || typeof runLive2DRuntimeCLI !== 'function') throw new Error('Live2D runtime/tool subpaths are not exported.');",
            "if (typeof createRapier2DPhysicsSystem !== 'function') throw new Error('Rapier 2D System factory is not exported.');",
            "if (typeof createRapier3DPhysicsSystem !== 'function') throw new Error('Rapier 3D System factory is not exported.');",
            "for (const mapPath of ['node_modules/@hilo/addon-particle/dist/index.js.map', 'node_modules/@hilo/addon-physics/dist/index.js.map', 'node_modules/@hilo/addon-live2d/dist/index.js.map']) {",
            "  const map = JSON.parse(readFileSync(mapPath, 'utf8'));",
            '  if (!Array.isArray(map.sourcesContent) || map.sourcesContent.length !== map.sources.length) throw new Error(`Missing inline sources for ${mapPath}`);',
            '}',
            'const vector = new Vector3(1, 2, 3);',
            "if (!vector) throw new Error('Vector3 could not be constructed.');",
            ''
        ].join('\n'),
        'utf8'
    );
    execFileSync(process.execPath, ['esm-consumer.mjs'], {
        cwd: consumerDirectory,
        stdio: 'inherit'
    });
    const runtimeHelp = execFileSync(
        join(consumerDirectory, 'node_modules/.bin/hilo-live2d-runtime'),
        ['--help'],
        { cwd: consumerDirectory, encoding: 'utf8' }
    );
    if (!runtimeHelp.includes('hilo-live2d-runtime --sdk') || !runtimeHelp.includes('--output')) {
        throw new Error('Installed Live2D runtime executable did not print its deployment help.');
    }
} finally {
    await rm(temporaryRoot, { force: true, recursive: true });
}
