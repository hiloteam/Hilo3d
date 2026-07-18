import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseNpmPackResult } from './npm-pack-result';

const projectRoot = resolve(import.meta.dirname, '..');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'hilo3d-package-'));
const archiveDirectory = join(temporaryRoot, 'archive');
const consumerDirectory = join(temporaryRoot, 'consumer');

try {
    await mkdir(archiveDirectory);
    await mkdir(consumerDirectory);

    const packOutput = execFileSync(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', archiveDirectory],
        { cwd: projectRoot, encoding: 'utf8' }
    );
    const packResult = parseNpmPackResult(packOutput);
    const archivePath = join(archiveDirectory, packResult.filename);

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
            resolve(projectRoot, 'node_modules/gl-matrix'),
            resolve(projectRoot, 'node_modules/web-naga')
        ],
        { cwd: consumerDirectory, stdio: 'inherit' }
    );

    await writeFile(
        join(consumerDirectory, 'esm-consumer.mjs'),
        [
            "import { Renderer, Vector3, version } from 'hilo3d';",
            "if (typeof Renderer !== 'function') throw new Error('Renderer is not exported.');",
            "if (typeof Vector3 !== 'function') throw new Error('Vector3 is not exported.');",
            "if (typeof version !== 'string') throw new Error('version is not exported.');",
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
