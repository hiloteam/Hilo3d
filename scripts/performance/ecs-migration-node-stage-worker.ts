import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

interface Manifest {
    readonly staticEntityCount: number;
    readonly dynamicEntityCount: number;
    readonly warmupFrames: number;
    readonly sampleFrames: number;
}

interface LegacyNode {
    readonly isMesh: boolean;
    readonly visible: boolean;
    y: number;
    addChild(child: LegacyNode): void;
    traverse(callback: (node: LegacyNode) => number): void;
    traverseUpdate(deltaTimeMilliseconds: number): void;
    updateMatrixWorld(): void;
}

type LegacyNodeConstructor = new (parameters?: Readonly<Record<string, unknown>>) => LegacyNode;

const baselineRoot = resolve(process.argv[2] ?? '');
if (baselineRoot.length === 0) throw new Error('Node/Stage worker requires a baseline worktree.');
const repositoryRoot = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, 'benchmarks/ecs/manifest.json'), 'utf8')
) as Manifest;
const loadDefault = async <T>(path: string): Promise<T> => {
    const loaded = (await import(pathToFileURL(resolve(baselineRoot, path)).href)) as {
        readonly default?: unknown;
    };
    if (loaded.default === undefined)
        throw new Error(`Legacy module ${path} has no default export.`);
    return loaded.default as T;
};
const Node = await loadDefault<LegacyNodeConstructor>('src/core/Node.ts');
const Mesh = await loadDefault<LegacyNodeConstructor>('src/core/Mesh.ts');
const BoxGeometry = await loadDefault<new () => object>('src/geometry/BoxGeometry.ts');
const BasicMaterial = await loadDefault<new () => object>('src/material/BasicMaterial.ts');
const totalCount = manifest.staticEntityCount + manifest.dynamicEntityCount;
const root = new Node();
const geometry = new BoxGeometry();
const material = new BasicMaterial();
const dynamicMeshes = new Array<LegacyNode>(manifest.dynamicEntityCount);
for (let index = 0; index < totalCount; index++) {
    const mesh = new Mesh({
        geometry,
        material,
        frustumTest: false,
        x: index % 1000,
        z: Math.floor(index / 1000)
    });
    if (index >= manifest.staticEntityCount) {
        dynamicMeshes[index - manifest.staticEntityCount] = mesh;
    }
    root.addChild(mesh);
}
let collected = 0;
const collect = (node: LegacyNode): number => {
    if (node.isMesh && node.visible) collected++;
    return 0;
};
let frame = 0;
function update(): void {
    const offset = frame++ % 2;
    let index = 0;
    while (index < dynamicMeshes.length) {
        const mesh = dynamicMeshes[index];
        index++;
        if (mesh) mesh.y = offset;
    }
    root.traverseUpdate(1000 / 60);
    root.updateMatrixWorld();
    collected = 0;
    root.traverse(collect);
    if (collected !== totalCount) throw new Error('Legacy scene collection count differs.');
}
for (let index = 0; index < manifest.warmupFrames; index++) update();
const samples: number[] = [];
for (let index = 0; index < manifest.sampleFrames; index++) {
    const started = performance.now();
    update();
    samples.push(performance.now() - started);
}
samples.sort((left, right) => left - right);
const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
process.stdout.write(`${JSON.stringify({ p95, collected })}\n`);
