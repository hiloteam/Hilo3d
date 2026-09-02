export type CatalogBackend = 'webgl2' | 'webgpu';

export const EXAMPLE_CATEGORIES = [
    { id: 'basics', label: 'ECS basics' },
    { id: 'assets', label: 'Assets' },
    { id: 'addons', label: 'Addons' }
] as const;

export type ExampleCategoryId = (typeof EXAMPLE_CATEGORIES)[number]['id'];

export interface ExampleCatalogEntry {
    readonly id: string;
    readonly path: string;
    readonly title: string;
    readonly description: string;
    readonly category: ExampleCategoryId;
    readonly supportedBackends: readonly CatalogBackend[];
}

const BOTH = ['webgl2', 'webgpu'] as const;

export const EXAMPLE_CATALOG: readonly ExampleCatalogEntry[] = Object.freeze([
    {
        id: 'quick-start',
        path: 'quickStart.html',
        title: 'Quick Start',
        description: 'Create a World, compose a renderable Entity, and submit it through Engine.',
        category: 'basics',
        supportedBackends: BOTH
    },
    {
        id: 'composition',
        path: 'composition.html',
        title: 'Composition & hierarchy',
        description: 'Compose render, interaction data, and transform hierarchy on one Entity.',
        category: 'basics',
        supportedBackends: BOTH
    },
    {
        id: 'gltf-prefab',
        path: 'gltf.html',
        title: 'glTF prefab',
        description: 'Load authoring data and instantiate it directly into a World.',
        category: 'assets',
        supportedBackends: BOTH
    },
    {
        id: 'physics',
        path: 'physics.html',
        title: 'RigidBody + MeshRenderer',
        description: 'Put render and physics components on one Entity without a binding object.',
        category: 'addons',
        supportedBackends: BOTH
    },
    {
        id: 'particles',
        path: 'particles.html',
        title: 'Particle World System',
        description:
            'Own particle resources through a World System and render extension component.',
        category: 'addons',
        supportedBackends: BOTH
    }
]);
