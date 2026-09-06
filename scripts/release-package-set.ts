import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PackageManifest {
    readonly name?: unknown;
    readonly peerDependencies?: Readonly<Record<string, unknown>>;
    readonly repository?: {
        readonly url?: unknown;
    };
    readonly version?: unknown;
}

const repositoryRoot = resolve(import.meta.dirname, '..');
const packagePaths = ['package.json', 'addon-particle/package.json', 'addon-physics/package.json'];
const expectedRepository = 'git+https://github.com/hiloteam/Hilo3d.git';
const expectedNames = new Map<string, string>([
    ['package.json', 'hilo3d'],
    ['addon-particle/package.json', '@hilo/addon-particle'],
    ['addon-physics/package.json', '@hilo/addon-physics']
]);

function readManifest(relativePath: string): PackageManifest {
    return JSON.parse(
        readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
    ) as PackageManifest;
}

const rootManifest = readManifest('package.json');
if (typeof rootManifest.version !== 'string') {
    throw new Error('package.json must declare a string version.');
}

for (const relativePath of packagePaths) {
    const manifest = readManifest(relativePath);
    if (manifest.name !== expectedNames.get(relativePath)) {
        throw new Error(
            `${relativePath} must declare package name ${String(expectedNames.get(relativePath))}.`
        );
    }
    if (manifest.version !== rootManifest.version) {
        throw new Error(
            `${relativePath} version ${String(manifest.version)} does not match ${rootManifest.version}.`
        );
    }
    if (manifest.repository?.url !== expectedRepository) {
        throw new Error(`${relativePath} must publish from ${expectedRepository}.`);
    }
    if (
        relativePath !== 'package.json' &&
        manifest.peerDependencies?.['hilo3d'] !== rootManifest.version
    ) {
        throw new Error(
            `${relativePath} must require hilo3d ${rootManifest.version} as an exact peer version.`
        );
    }
}

console.log(`Verified synchronized release ${rootManifest.version}: ${packagePaths.join(', ')}.`);
