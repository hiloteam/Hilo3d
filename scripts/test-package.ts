import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
            resolve(projectRoot, 'node_modules/gl-matrix'),
            resolve(projectRoot, 'node_modules/web-naga'),
            resolve(projectRoot, 'node_modules/@dimforge/rapier2d-compat'),
            resolve(projectRoot, 'node_modules/@dimforge/rapier3d-compat')
        ],
        { cwd: consumerDirectory, stdio: 'inherit' }
    );

    await writeFile(
        join(consumerDirectory, 'esm-consumer.mjs'),
        [
            "import { Engine, World, LocalTransform, MeshRenderer, Vector3, version } from 'hilo3d';",
            "import { createParticleWorldSystem } from '@hilo3d/addon-particle';",
            "import { createPhysicsSystem } from '@hilo3d/addon-physics';",
            "import { createRapier2DPhysicsSystem } from '@hilo3d/addon-physics/rapier2d';",
            "import { createRapier3DPhysicsSystem } from '@hilo3d/addon-physics/rapier3d';",
            "import { readFileSync } from 'node:fs';",
            "if (typeof Engine !== 'function') throw new Error('Engine is not exported.');",
            "if (typeof World !== 'function') throw new Error('World is not exported.');",
            "if (typeof LocalTransform !== 'object') throw new Error('LocalTransform is not exported.');",
            "if (typeof MeshRenderer !== 'object') throw new Error('MeshRenderer is not exported.');",
            "if (typeof Vector3 !== 'function') throw new Error('Vector3 is not exported.');",
            "if (typeof version !== 'string') throw new Error('version is not exported.');",
            "if (typeof createParticleWorldSystem !== 'function') throw new Error('Particle World System factory is not exported.');",
            "if (typeof createPhysicsSystem !== 'function') throw new Error('Physics World System factory is not exported.');",
            "if (typeof createRapier2DPhysicsSystem !== 'function') throw new Error('Rapier 2D System factory is not exported.');",
            "if (typeof createRapier3DPhysicsSystem !== 'function') throw new Error('Rapier 3D System factory is not exported.');",
            "for (const mapPath of ['node_modules/@hilo3d/addon-particle/dist/index.js.map', 'node_modules/@hilo3d/addon-physics/dist/index.js.map']) {",
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
} finally {
    await rm(temporaryRoot, { force: true, recursive: true });
}
