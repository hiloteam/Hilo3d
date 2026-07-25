type CatalogBackend = 'webgl2' | 'webgpu';

export const EXAMPLE_CATEGORIES = [
    {
        id: 'getting-started',
        label: 'Getting started',
        description: 'Small examples for learning the basic Hilo3D workflow.'
    },
    {
        id: '2d',
        label: '2D games',
        description: 'Sprites, atlas animation, Canvas text, batching, layers, and camera stacks.'
    },
    {
        id: 'geometry',
        label: 'Geometry',
        description: 'Mesh construction, attributes, helpers, and instancing.'
    },
    {
        id: 'materials',
        label: 'Materials & shaders',
        description: 'Material models, custom shaders, transparency, and environments.'
    },
    {
        id: 'lighting',
        label: 'Lighting & shadows',
        description: 'Lights, shadows, and image-based lighting.'
    },
    {
        id: 'textures',
        label: 'Textures & media',
        description: 'Texture formats, image data, video, HDR, and color spaces.'
    },
    {
        id: 'animation',
        label: 'Animation',
        description: 'Animation clips, tweening, morphing, and dynamic scenes.'
    },
    {
        id: 'rendering',
        label: 'Rendering',
        description: 'Render targets, post-processing, buffers, and render pipelines.'
    },
    {
        id: 'interaction',
        label: 'Interaction',
        description: 'Picking, ray casting, camera helpers, pointer input, and XR.'
    },
    {
        id: 'loaders',
        label: 'Loaders & tools',
        description: 'Asset loaders, cloning, progress reporting, and the glTF viewer.'
    },
    {
        id: 'physics',
        label: 'Physics',
        description: 'Physics integration and simulation examples.'
    },
    {
        id: 'advanced',
        label: 'Advanced',
        description: 'Diagnostics, resource management, math, and lower-level APIs.'
    }
] as const;

export type ExampleCategoryId = (typeof EXAMPLE_CATEGORIES)[number]['id'];

export interface ExampleCatalogEntry {
    readonly id: string;
    readonly path: string;
    readonly title: string;
    readonly description: string;
    readonly category: ExampleCategoryId;
    readonly sourcePath: string;
    readonly supportedBackends: readonly CatalogBackend[];
    readonly defaultQuery: Readonly<Record<string, string>>;
    readonly searchText: string;
}

const CATEGORY_ORDER = new Map(
    EXAMPLE_CATEGORIES.map((category, index) => [category.id, index] as const)
);
const BOTH_BACKENDS = ['webgl2', 'webgpu'] as const;
const WEBGL2_ONLY = ['webgl2'] as const;
const WEBGPU_ONLY = ['webgpu'] as const;

const TITLE_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
    'MultiSampledRenderbuffers.html': 'Multisampled Renderbuffers',
    'cubeTexture_HDR.html': 'HDR Cube Texture',
    'glTFViewer/index.html': 'glTF Viewer',
    'loader/glTF_clone.html': 'glTF Clone',
    'loader/glTF_loader.html': 'glTF Loader',
    'quickStart.html': 'Quick Start',
    'resourceManagerTest.html': 'Resource Manager Diagnostics',
    'sRGB.html': 'sRGB Color Space',
    'shaderToy.html': 'ShaderToy',
    'sphereEnvMap.html': 'Sphere Environment Map',
    'sphericalHarmonics.html': 'Spherical Harmonics',
    'uniformBufferObject.html': 'Uniform Buffer Objects',
    'update_sub_texture.html': 'Update Sub-texture',
    'webgl_support.html': 'Graphics Backend Support',
    'compute_gpu_driven.html': 'WebGPU Compute & GPU-Driven Rendering',
    'compute_particles.html': 'Hilo3D Compute Particle Field',
    'compute_raytracing.html': 'Hilo3D Crystal Compute Path Tracer',
    '2d_sprite_animation.html': '2D Moon Moth Animation',
    '2d_sorting_town.html': '2D Sorting Town',
    '2d_text.html': '2D Canvas Text',
    '2d_sprite_batch.html': '2D Sprite Batch'
});

const DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
    'glTFViewer/index.html': 'Load glTF 2.0 models from a URL, files, or a dropped folder.',
    'compute_gpu_driven.html':
        'See Forward+, Gaussian splats, and a curl-noise Hilo3D GPU particle wordmark stay on the public Render Graph.',
    'compute_particles.html':
        'Drive 65,536 GPU bodies through aurora, stars, cyber dunes, meteor-wake force fields, boundary collisions, and indirect glow rendering.',
    'compute_raytracing.html':
        'Progressively path trace a refractive Hilo3D crystal wordmark, glass sphere, champagne-metal cube, soft shadows, and cinematic HDR bloom.',
    '2d_sprite_animation.html':
        'Animate an ImageGen-authored atlas while three ordered cameras compose a 2D background, a 3D moon, and clickable 2D UI.',
    '2d_sorting_town.html':
        'Guide an A* courier through an ImageGen-authored pixel town while foot-Y ordering keeps buildings, trees, and the walker correctly layered.',
    '2d_text.html':
        'Rasterize styled multiline Canvas text only when content changes, then render and click it as Sprite UI.',
    '2d_sprite_batch.html':
        'Render 4,096 ImageGen-authored collectibles from one atlas in 32 portable instance batches.',
    'pbr.html': 'Render a glTF asset with physically based materials and environment lighting.',
    'quickStart.html': 'Create a stage, camera, lights, and an animated PBR mesh.',
    'scriptable_pipeline.html':
        'Compose a custom render pipeline through the public scriptable pipeline API.',
    'shaderToy.html': 'Run an interactive fragment shader with pointer and time inputs.',
    'webgl_support.html': 'Inspect the graphics backend selected for the current browser.'
});

function categoryForPath(path: string): ExampleCategoryId {
    const normalized = path.toLowerCase();
    if (normalized === 'quickstart.html') return 'getting-started';
    if (normalized.startsWith('2d_')) return '2d';
    if (normalized.startsWith('physics/')) return 'physics';
    if (normalized.startsWith('loader/') || normalized.startsWith('gltfviewer/')) return 'loaders';
    if (
        /(?:geometry|billboard|wireframe|frustum_test|camerahelper|normal_map|uv_map)/u.test(
            normalized
        )
    ) {
        return 'geometry';
    }
    if (/(?:light|shadow|sphericalharmonics)/u.test(normalized)) return 'lighting';
    if (/(?:animation|tween|morph|lifegame|custom_anim_state)/u.test(normalized)) {
        return 'animation';
    }
    if (
        /(?:texture|srgb|hdr|video|sphereenvmap|update_sub_texture|compressed_texture)/u.test(
            normalized
        )
    ) {
        return 'textures';
    }
    if (
        /(?:post_process|bloom|ssao|rendertarget|drawbuffers|depthtexture|stencil|multisampled|scriptable_pipeline|compute_gpu_driven|compute_particles)/u.test(
            normalized
        )
    ) {
        return 'rendering';
    }
    if (/(?:raycast|mesh_picker|mouse_event|webxr)/u.test(normalized)) return 'interaction';
    if (/(?:pbr|polly|shader|transparent|fog|skybox|refract|snow|spheremap)/u.test(normalized)) {
        return 'materials';
    }
    return 'advanced';
}

function formatWord(word: string): string {
    const normalized = word.toLowerCase();
    const acronyms: Readonly<Record<string, string>> = {
        gltf: 'glTF',
        hdr: 'HDR',
        khc: 'KHC',
        osg: 'OSG',
        pbr: 'PBR',
        smd: 'SMD',
        srgb: 'sRGB',
        ssao: 'SSAO',
        tga: 'TGA',
        uv: 'UV',
        webgl: 'WebGL',
        webgpu: 'WebGPU',
        webxr: 'WebXR'
    };
    const acronym = acronyms[normalized];
    if (acronym) return acronym;
    return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

function titleForPath(path: string): string {
    const override = TITLE_OVERRIDES[path];
    if (override) return override;
    const filename = path.slice(path.lastIndexOf('/') + 1, -'.html'.length);
    return filename
        .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
        .replace(/([A-Za-z])([0-9])/gu, '$1 $2')
        .replace(/[_-]+/gu, ' ')
        .split(/\s+/u)
        .filter(Boolean)
        .map(formatWord)
        .join(' ');
}

function descriptionForEntry(path: string, title: string, category: ExampleCategoryId): string {
    const override = DESCRIPTION_OVERRIDES[path];
    if (override) return override;
    const categoryLabel =
        EXAMPLE_CATEGORIES.find(candidate => candidate.id === category)?.label ?? 'Hilo3D';
    return `Explore ${title} in the ${categoryLabel.toLowerCase()} examples.`;
}

function sourcePathForEntry(path: string): string {
    if (path === 'glTFViewer/index.html') return 'glTFViewer/app/index.ts';
    return `${path.slice(0, -'.html'.length)}.ts`;
}

function createEntry(path: string): ExampleCatalogEntry {
    const id = path.slice(0, -'.html'.length);
    const title = titleForPath(path);
    const category = categoryForPath(path);
    const description = descriptionForEntry(path, title, category);
    const sourcePath = sourcePathForEntry(path);
    const supportedBackends =
        path === 'webxr.html'
            ? WEBGL2_ONLY
            : path === 'compute_gpu_driven.html' ||
                path === 'compute_particles.html' ||
                path === 'compute_raytracing.html'
              ? WEBGPU_ONLY
              : BOTH_BACKENDS;
    const defaultQuery =
        path === 'glTFViewer/index.html'
            ? Object.freeze({ url: '/examples/models/Tmall/Tmall.gltf' })
            : Object.freeze({});
    return Object.freeze({
        id,
        path,
        title,
        description,
        category,
        sourcePath,
        supportedBackends,
        defaultQuery,
        searchText: `${title} ${path} ${category}`.toLowerCase()
    });
}

export function createExampleCatalog(paths: readonly string[]): readonly ExampleCatalogEntry[] {
    return Object.freeze(
        paths
            .filter(path => path !== 'index.html' && path !== 'list.html')
            .map(createEntry)
            .sort((left, right) => {
                const categoryDifference =
                    (CATEGORY_ORDER.get(left.category) ?? 0) -
                    (CATEGORY_ORDER.get(right.category) ?? 0);
                return (
                    categoryDifference ||
                    left.title.localeCompare(right.title, 'en', { sensitivity: 'base' })
                );
            })
    );
}

export function examplesForBackend(
    catalog: readonly ExampleCatalogEntry[],
    backend: CatalogBackend
): readonly ExampleCatalogEntry[] {
    return catalog.filter(entry => entry.supportedBackends.includes(backend));
}
