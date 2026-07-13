import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const maintainedRoots = ['src', 'examples', 'test', 'scripts'] as const;
const forbiddenImplementationExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.cts']);
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const forbiddenLegacyPaths = [
    'examples/js',
    'examples/glTFViewer/js',
    'src/core/Class.ts',
    'src/core/EventMixin.ts'
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
            }
        ]
    },
    ...[
        'src/core/Stage.ts',
        'src/renderer/Renderer.ts',
        'src/renderer/WebGLRenderer.ts',
        'src/renderer/WebGPURenderer.ts'
    ].map(path => ({
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
        label: 'handwritten WGSL entry point',
        pattern: /@(?:vertex|fragment|compute)\b/u
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
            for (const rule of forbiddenSourceRules) {
                if (rule.pattern.test(source)) matches.push(`${relativePath} (${rule.label})`);
            }
            if (relativePath.startsWith('src/')) {
                for (const rule of forbiddenEngineSourceRules) {
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
