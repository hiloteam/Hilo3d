import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { collectShaderModernityViolations } from './shader-modernity';

const projectRoot = resolve(import.meta.dirname, '..');
const maintainedRoots = ['src', 'examples', 'test', 'scripts'] as const;
const forbiddenImplementationExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.cts']);
const sourceExtensions = new Set([
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.frag',
    '.glsl',
    '.vert',
    '.wgsl'
]);
const forbiddenLegacyPaths = [
    'examples/js',
    'examples/glTFViewer/js',
    'src/core/Class.ts',
    'src/core/EventMixin.ts',
    'src/core/Node.ts',
    'src/core/Stage.ts',
    'src/renderer',
    'src/rhi'
] as const;
const packageContractFiles = ['package.json', 'vite.config.ts', 'vite.examples.config.ts'] as const;
const publicContractRules = [
    {
        path: 'src/Hilo3d.ts',
        rules: [
            {
                label: 'legacy framebuffer or shadow implementation export',
                pattern:
                    /\b(?:[A-Za-z0-9_]*Framebuffer[A-Za-z0-9_]*|LightShadow|LightShadowParameters|CubeLightShadow|CubeLightShadowParameters|ShadowCamera)\b/u
            },
            {
                label: 'backend implementation exported by the public entry point',
                pattern:
                    /(?:from\s+["']\.\/render\/(?:internal|rhi)(?:\/|["'])|\b(?:WebGL2Driver|WebGPUDriver|WebGLRenderTarget|WebGPURenderTarget|WebGLState|WebGLExtensions|WebGLCapabilities)\b)/u
            }
        ]
    },
    {
        path: 'website/index.html',
        rules: [
            {
                label: 'legacy public scene runtime in website',
                pattern: /(?:Hilo3d\.(?:Stage|Node)|new\s+Hilo3d\.Mesh|examples\/list\.html)/u
            }
        ]
    },
    ...['src/core/Engine.ts', 'src/render/RendererCore.ts'].map(path => ({
        path,
        rules: [
            {
                label: 'legacy renderer-owned framebuffer option',
                pattern: /\b(?:useFramebuffer|framebufferOption)\b/u
            }
        ]
    })),
    ...['src/light/DirectionalLight.ts', 'src/light/SpotLight.ts', 'src/light/PointLight.ts'].map(
        path => ({
            path,
            rules: [
                {
                    label: 'backend-internal lightShadow property',
                    pattern: /\blightShadow\b/u
                },
                {
                    label: 'WebGL-only public shadow orchestration',
                    pattern: /\b(?:createShadowMap|WebGLRenderer)\b/u
                }
            ]
        })
    ),
    ...['src/light/Light.ts', 'src/light/LightManager.ts'].map(path => ({
        path,
        rules: [
            {
                label: 'WebGL-only public shadow orchestration',
                pattern: /\b(?:createShadowMap|WebGLRenderer)\b/u
            }
        ]
    }))
] as const;
const forbiddenArtifactNamePatterns = [
    /(?:^|[-_.])cjs(?:[-_.]|$)/iu,
    /(?:^|[-_.])umd(?:[-_.]|$)/iu
];
const forbiddenSourceRules = [
    {
        label: 'TypeScript diagnostic suppression',
        pattern: /@ts-(?:nocheck|ignore|expect-error)\b/u
    },
    { label: 'lint suppression', pattern: /eslint-disable(?:-next-line|-line)?\b/u },
    { label: 'coverage suppression', pattern: /(?:c8|istanbul)\s+ignore\b/u },
    {
        label: 'explicit any escape hatch',
        pattern: /(?:\bas\s+any\b|:\s*any\b|<any>|\bany\[\])/u
    },
    { label: 'dynamic Class API', pattern: /\bClass\.(?:create|mix)\b/u },
    { label: 'EventMixin API', pattern: /\bEventMixin\b/u },
    {
        label: 'single-input WebGPU instance-buffer compatibility API',
        pattern: /\bgetInstanceBuffer\b/u
    },
    {
        label: 'WebGL 1 core-feature extension wrapper',
        pattern:
            /\b(?:ANGLE_instanced_arrays|EXT_blend_minmax|EXT_frag_depth|EXT_shader_texture_lod|OES_element_index_uint|OES_standard_derivatives|OES_vertex_array_object|WEBGL_depth_texture|WEBGL_draw_buffers)\b/u
    },
    { label: 'backend-specific release alias', pattern: /\breleaseGLResource\b/u },
    { label: 'UMD package subpath', pattern: /\bhilo3d\/umd\b/u },
    { label: 'UMD artifact', pattern: /\bHilo3d\.umd\b/u },
    { label: 'UMD build mode', pattern: /\blibrary-umd\b/u },
    { label: 'UMD declaration namespace', pattern: /\bexport\s+as\s+namespace\b/u },
    { label: 'global package entry', pattern: /\bglobalThis\.Hilo3d\b/u },
    { label: 'CommonJS export', pattern: /\bmodule\.exports\b/u },
    { label: 'CommonJS require call', pattern: /\brequire\s*\(/u },
    {
        label: 'UMD/CommonJS source adaptation',
        pattern: /\b(?:commonJsFooter|commonJSFooter|umdWrapper|UMD wrapper)\b/u
    },
    { label: 'CommonJS artifact', pattern: /\.cjs\b/u },
    { label: 'CommonJS package condition', pattern: /["']require["']\s*:/u },
    { label: 'UMD library format', pattern: /\bformats\s*:\s*\[[^\]]*["']umd["']/u }
] as const;
const forbiddenEngineSourceRules = [
    {
        label: 'backend-specific renderer class',
        pattern: /\b(?:WebGLRenderer|WebGPURenderer)\b/u
    }
] as const;
const forbiddenCommonRendererRules = [
    {
        label: 'backend implementation imported by the shared render layer',
        pattern:
            /(?:from\s+|import\s*(?:\(\s*)?)["'][^"']*(?:\/(?:internal\/(?:webgl2|webgpu)|rhi\/(?:backends\/)?(?:webgl2|webgpu)))(?:\/[^"']*)?["']/u
    },
    {
        label: 'native graphics handle declared by the shared render layer',
        // `GPUDriven*` and `GPUScene*` describe backend-neutral rendering techniques, not native
        // WebGPU ownership. All other `GPU*` identifiers remain confined to implementation code.
        pattern:
            /\b(?:GPU(?!(?:Driven|Scene))[A-Z][A-Za-z0-9_]*|WebGL(?:2[A-Z][A-Za-z0-9_]*|[A-Z][A-Za-z0-9_]*)|GL(?:bitfield|boolean|char|enum|float|int|intptr|sizei|sizeiptr|uint))\b/u
    },
    {
        label: 'native graphics API called by the shared render layer',
        pattern:
            /(?:\bnavigator\s*(?:\?\.|\.)\s*gpu\b|\bgl\s*(?:\?\.|\.)|\.getContext\s*\(\s*["'](?:webgl2?|webgpu)["'])/u
    }
] as const;
const forbiddenBackendCrossImportRules = {
    webgl2: {
        label: 'WebGL2 backend imports WebGPU implementation',
        pattern: /from\s+["'][^"']*(?:\/webgpu\/|\.\.\/webgpu)/u
    },
    webgpu: {
        label: 'WebGPU backend imports WebGL2 implementation',
        pattern: /from\s+["'][^"']*(?:\/webgl2\/|\.\.\/webgl2)/u
    }
} as const;
const forbiddenRendererDeviceOwnershipRules = [
    {
        label: 'renderer acquires a native graphics context instead of using its RHI owner',
        pattern: /\.getContext\s*\(\s*["'](?:webgl2|webgpu)["']/u
    },
    {
        label: 'renderer requests a WebGPU adapter instead of using its RHI owner',
        pattern: /\.requestAdapter\s*\(/u
    }
] as const;
const forbiddenRHIRules = [
    {
        label: 'engine semantic imported or declared by RHI',
        pattern: /\b(?:Mesh|Material|Stage|Light|RenderList|RenderTarget|ShaderVariant)\b/u
    },
    {
        label: 'render frontend or engine layer imported by RHI',
        pattern:
            /from\s+["'][^"']*(?:\/material\/|\/geometry\/|\/light\/|\/shader\/|\/texture\/|(?:\.\.\/){3,}core\/|(?:\.\.\/)+(?:renderer|Renderer(?:Core)?|RenderList|RenderTarget|internal)(?:\/|["']))/u
    },
    {
        label: 'reflective JSON cache key in RHI hot path',
        pattern: /\bJSON\.stringify\b/u
    }
] as const;
const forbiddenRHICoreRules = [
    {
        label: 'RHI core imports the legacy RHI module',
        pattern:
            /(?:from\s+|import\s*(?:\(\s*)?)["'][^"']*(?:\/rhi)?\/RHI(?:\.(?:[cm]?[jt]s))?["']/u
    },
    {
        label: 'RHI core imports a concrete or legacy backend',
        pattern: /(?:from\s+|import\s*(?:\(\s*)?)["'][^"']*\/(?:webgl2|webgpu)(?:\/[^"']*)?["']/u
    },
    {
        label: 'RHI core imports the legacy render internal layer',
        pattern:
            /(?:from\s+|import\s*(?:\(\s*)?)["'][^"']*\/(?:render\/)?internal(?:\/[^"']*)?["']/u
    },
    {
        label: 'RHI core imports an engine or renderer layer',
        pattern:
            /from\s+["'][^"']*(?:\/material\/|\/geometry\/|\/light\/|\/shader\/|\/texture\/|(?:\.\.\/)+(?:core|renderer|frame|graph)(?:\/|["'])|(?:\.\.\/)+(?:Renderer(?:Core)?|RenderList|RenderTarget)(?:\/|["']))/u
    },
    {
        label: 'engine or renderer semantic declared by RHI core',
        pattern:
            /\b(?:Scene|Stage|Mesh|Geometry|Material|Light|LightManager|Camera|Renderer|RendererCore|ForwardRenderer|PreparedDraw|RenderList|RenderTarget|ShaderVariant)\b/u
    },
    {
        label: 'native graphics type declared by RHI core',
        pattern: /\b(?:WebGL[A-Z0-9][A-Za-z0-9_]*|GLenum|GPU[A-Z][A-Za-z0-9_]*)\b/u
    },
    {
        label: 'native graphics API called by RHI core',
        pattern:
            /(?:\bnavigator\s*(?:\?\.|\.)\s*gpu\b|\bgl\s*(?:\?\.|\.)|\.getContext\s*\(\s*["'](?:webgl2?|webgpu)["'])/u
    }
] as const;
const forbiddenWebGPURHIRules = [
    {
        label: 'WebGPU RHI degraded to WebGL state semantics',
        pattern:
            /\b(?:WebGL(?:2[A-Z][A-Za-z0-9_]*|[A-Z][A-Za-z0-9_]*)|GL(?:bitfield|boolean|char|enum|float|int|intptr|sizei|sizeiptr|uint))\b|\bgl\s*(?:\?\.)?\s*\.|\.getContext\s*\(\s*["']webgl2?["']/u
    }
] as const;
const forbiddenWebGLRHIRules = [
    {
        label: 'WebGL RHI imports native WebGPU implementation',
        pattern: /\bGPU[A-Z][A-Za-z0-9_]*\b|\bnavigator\s*(?:\?\.)?\s*gpu\b/u
    }
] as const;
const forbiddenSharedResourceRules = [
    {
        label: 'shared resource model imports a backend implementation',
        pattern: /from\s+["'][^"']*\/render\/(?:internal|rhi)\/(?:webgl2|webgpu)\//u
    },
    {
        label: 'shared resource model declares a native graphics handle',
        pattern:
            /\b(?:GPU(?:Device|Queue|Buffer|Texture|TextureView|Sampler|BindGroup|RenderPipeline)|WebGL(?:RenderingContext|2RenderingContext|Buffer|Program|Texture|Sampler|Framebuffer|Renderbuffer|UniformLocation|VertexArrayObject))\b/u
    },
    {
        label: 'shared texture model implements a backend upload adapter',
        pattern:
            /\b(?:TextureWebGLState|synchronizeWebGLTexture|updateWebGLTexture|_glUploadTexture|_uploadTexture)\b/u
    }
] as const;
const backendNeutralExampleExclusions = new Set([
    'examples/shared/init.ts',
    'examples/webgl_support.ts',
    // WebXR is explicitly scoped to XRWebGLLayer/WebGL2 until a separate WebXR migration.
    'examples/webxr.ts'
]);
const forbiddenBackendSpecificExampleRules = [
    { label: 'legacy Framebuffer API', pattern: /\bHilo3d\.Framebuffer\b/u },
    { label: 'WebGL-only renderer type', pattern: /\bHilo3d\.WebGLRenderer\b/u },
    {
        label: 'WebGL renderer internals',
        pattern:
            /\b(?:renderer|stage\.renderer)\.(?:gl|state|framebuffer|renderMesh|renderScene|setupBlend|viewport|clear|clearDepth|clearStencil)\b/u
    },
    {
        label: 'legacy renderer-owned framebuffer option',
        pattern: /\b(?:useFramebuffer|framebufferOption)\s*:/u
    },
    {
        label: 'backend branch inside an example',
        pattern:
            /(?:\b(?:renderer|stage\.renderer)\.backend\s*(?:===|!==)|\b(?:if|switch)\s*\([^)]*\b(?:renderer|stage\.renderer)\.backend\b)/u
    }
] as const;
const forbiddenRootEntryPatterns = [
    /^\.babelrc(?:\..+)?$/u,
    /^\.mocharc(?:\..+)?$/u,
    /^babel\.config\..+$/u,
    /^gulpfile(?:\..+)?$/u,
    /^jsdoc(?:\.[^.]+)*\.(?:js|cjs|mjs|json|ts)$/u,
    /^mocha(?:\..+)?$/u,
    /^webpack(?:\.[^.]+)*\.config\..+$/u
] as const;

function projectPath(absolutePath: string): string {
    return relative(projectRoot, absolutePath);
}

function isSharedRenderSource(path: string): boolean {
    return path.startsWith('src/render/') && !path.startsWith('src/render/rhi/');
}

function matchesForbiddenArtifactName(name: string): boolean {
    return forbiddenArtifactNamePatterns.some(pattern => pattern.test(name));
}

async function collectLegacyArtifacts(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const matches: string[] = [];
    for (const entry of entries) {
        const absolutePath = join(directory, entry.name);
        const relativePath = projectPath(absolutePath);
        if (entry.isDirectory()) {
            if (matchesForbiddenArtifactName(entry.name)) matches.push(relativePath);
            matches.push(...(await collectLegacyArtifacts(absolutePath)));
            continue;
        }
        if (!entry.isFile()) continue;

        const extension = extname(entry.name);
        if (
            forbiddenImplementationExtensions.has(extension) ||
            matchesForbiddenArtifactName(entry.name)
        ) {
            matches.push(relativePath);
        }
        if (sourceExtensions.has(extension) && relativePath !== 'scripts/check-modernity.ts') {
            const source = await readFile(absolutePath, 'utf8');
            if (
                relativePath.startsWith('src/') &&
                /(?:WebGLRenderer|WebGPURenderer)\.(?:ts|tsx|mts|cts)$/u.test(relativePath)
            ) {
                matches.push(`${relativePath} (backend-specific renderer module)`);
            }
            for (const rule of forbiddenSourceRules) {
                if (rule.pattern.test(source)) matches.push(`${relativePath} (${rule.label})`);
            }
            for (const violation of collectShaderModernityViolations(relativePath, source)) {
                matches.push(`${relativePath}:${String(violation.line)} (${violation.label})`);
            }
            if (relativePath.startsWith('src/')) {
                for (const rule of forbiddenEngineSourceRules) {
                    if (rule.pattern.test(source)) {
                        matches.push(`${relativePath} (${rule.label})`);
                    }
                }
            }
            if (isSharedRenderSource(relativePath)) {
                for (const rule of forbiddenCommonRendererRules) {
                    if (rule.pattern.test(source)) {
                        matches.push(`${relativePath} (${rule.label})`);
                    }
                }
            }
            if (relativePath.startsWith('src/render/rhi/backends/webgl2/')) {
                const rule = forbiddenBackendCrossImportRules.webgl2;
                if (rule.pattern.test(source)) matches.push(`${relativePath} (${rule.label})`);
            }
            if (relativePath.startsWith('src/render/rhi/backends/webgpu/')) {
                const rule = forbiddenBackendCrossImportRules.webgpu;
                if (rule.pattern.test(source)) matches.push(`${relativePath} (${rule.label})`);
            }
            if (
                relativePath.startsWith('src/render/') &&
                !relativePath.startsWith('src/render/rhi/')
            ) {
                for (const rule of forbiddenRendererDeviceOwnershipRules) {
                    if (rule.pattern.test(source)) {
                        matches.push(`${relativePath} (${rule.label})`);
                    }
                }
            }
            if (relativePath.startsWith('src/render/rhi/')) {
                for (const rule of forbiddenRHIRules) {
                    if (rule.pattern.test(source)) {
                        matches.push(`${relativePath} (${rule.label})`);
                    }
                }
            }
            if (relativePath.startsWith('src/render/rhi/core/')) {
                for (const rule of forbiddenRHICoreRules) {
                    if (rule.pattern.test(source)) {
                        matches.push(`${relativePath} (${rule.label})`);
                    }
                }
            }
            if (relativePath.startsWith('src/render/rhi/backends/webgpu/')) {
                for (const rule of forbiddenWebGPURHIRules) {
                    if (rule.pattern.test(source)) {
                        matches.push(`${relativePath} (${rule.label})`);
                    }
                }
            }
            if (relativePath.startsWith('src/render/rhi/backends/webgl2/')) {
                for (const rule of forbiddenWebGLRHIRules) {
                    if (rule.pattern.test(source)) {
                        matches.push(`${relativePath} (${rule.label})`);
                    }
                }
            }
            if (
                relativePath.startsWith('src/texture/') ||
                relativePath.startsWith('src/material/')
            ) {
                for (const rule of forbiddenSharedResourceRules) {
                    if (rule.pattern.test(source)) {
                        matches.push(`${relativePath} (${rule.label})`);
                    }
                }
            }
            if (
                relativePath.startsWith('examples/') &&
                !backendNeutralExampleExclusions.has(relativePath)
            ) {
                for (const rule of forbiddenBackendSpecificExampleRules) {
                    if (rule.pattern.test(source)) {
                        matches.push(`${relativePath} (${rule.label})`);
                    }
                }
            }
        }
    }
    return matches;
}

async function collectPackageContractViolations(): Promise<string[]> {
    const matches: string[] = [];
    for (const path of packageContractFiles) {
        const source = await readFile(resolve(projectRoot, path), 'utf8');
        for (const rule of forbiddenSourceRules) {
            if (rule.pattern.test(source)) matches.push(`${path} (${rule.label})`);
        }
    }
    return matches;
}

async function collectPublicContractViolations(): Promise<string[]> {
    const matches: string[] = [];
    for (const contract of publicContractRules) {
        const source = await readFile(resolve(projectRoot, contract.path), 'utf8');
        for (const rule of contract.rules) {
            if (rule.pattern.test(source)) matches.push(`${contract.path} (${rule.label})`);
        }
    }
    return matches;
}

async function existingLegacyPaths(): Promise<string[]> {
    return (
        await Promise.all(
            forbiddenLegacyPaths.map(async path => {
                try {
                    await access(resolve(projectRoot, path));
                    return path;
                } catch {
                    return null;
                }
            })
        )
    ).filter((path): path is (typeof forbiddenLegacyPaths)[number] => path !== null);
}

const rootEntries = await readdir(projectRoot);
const legacyConfiguration = rootEntries.filter(entry =>
    forbiddenRootEntryPatterns.some(pattern => pattern.test(entry))
);
const legacyArtifacts = (
    await Promise.all(
        maintainedRoots.map(root => collectLegacyArtifacts(resolve(projectRoot, root)))
    )
).flat();
const violations = [
    ...new Set([
        ...legacyConfiguration,
        ...legacyArtifacts,
        ...(await existingLegacyPaths()),
        ...(await collectPackageContractViolations()),
        ...(await collectPublicContractViolations())
    ])
].sort();

if (violations.length > 0) {
    throw new Error(
        `Remove legacy implementations, APIs, module formats, or configuration:\n${violations.map(path => `- ${path}`).join('\n')}`
    );
}
