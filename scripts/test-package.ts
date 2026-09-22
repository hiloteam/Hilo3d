import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build as buildVite } from 'vite';
import { parseNpmPackResult } from './npm-pack-result';
import { verifyAssetPackage } from '../addon-assets/test/package';
import { verifyLive2DPackage } from '../addon-live2d/test/package';

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
    const assetsArchivePath = pack(resolve(projectRoot, 'addon-assets'));

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
            assetsArchivePath,
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
            ...recipeFiles.map(name => join(recipeDirectory, name))
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
            "import { AssetManager, WorkerTextureDecoder } from '@hilo/addon-assets';",
            "if (typeof AssetManager !== 'function' || typeof WorkerTextureDecoder !== 'function') throw new Error('Asset addon ESM entry is missing');",
            "import { createParticleStageSystem } from '@hilo/addon-particle';",
            "import { createPhysicsStageSystem } from '@hilo/addon-physics';",
            "import { createRapier2DPhysicsSystem } from '@hilo/addon-physics/rapier2d';",
            "import { createRapier3DPhysicsSystem } from '@hilo/addon-physics/rapier3d';",
            "import { existsSync, readFileSync } from 'node:fs';",
            "for (const optionalTool of ['rollup', 'typescript']) if (existsSync(`node_modules/${optionalTool}`)) throw new Error(`Consumer unexpectedly installed optional build tool ${optionalTool}`);",
            "if (typeof Renderer !== 'function') throw new Error('Renderer is not exported.');",
            "if (typeof Vector3 !== 'function') throw new Error('Vector3 is not exported.');",
            "if (typeof version !== 'string') throw new Error('version is not exported.');",
            "if (typeof createParticleStageSystem !== 'function') throw new Error('Particle System factory is not exported.');",
            "if (typeof createPhysicsStageSystem !== 'function') throw new Error('Physics System factory is not exported.');",
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
    await verifyLive2DPackage(consumerDirectory);
    await verifyAssetPackage(consumerDirectory);
} finally {
    await rm(temporaryRoot, { force: true, recursive: true });
}
