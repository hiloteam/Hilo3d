import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('../../../src/render/**/*.ts', {
    eager: true,
    query: '?raw',
    import: 'default'
});
const legacyRenderRoots = import.meta.glob([
    '../../../src/renderer/**/*.ts',
    '../../../src/rhi/**/*.ts'
]);

function sourceAt(suffix: string): string {
    const matches = Object.entries(sources).filter(([path]) => path.endsWith(suffix));
    if (matches.length !== 1) {
        throw new Error(
            `Expected one render source ending in ${suffix}, found ${String(matches.length)}`
        );
    }
    return matches[0]?.[1] ?? '';
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function bodyFromSignature(
    source: string,
    signatureIndex: number,
    displayName: string
): string | null {
    const openingParenthesis = source.indexOf('(', signatureIndex);
    if (openingParenthesis < 0) throw new Error(`Could not parse ${displayName} parameters`);
    let parameterDepth = 0;
    let closingParenthesis = -1;
    for (let index = openingParenthesis; index < source.length; index++) {
        const character = source[index];
        if (character === '(') parameterDepth++;
        else if (character === ')' && --parameterDepth === 0) {
            closingParenthesis = index;
            break;
        }
    }
    if (closingParenthesis < 0) throw new Error(`Could not parse ${displayName} parameters`);

    const openingBrace = source.indexOf('{', closingParenthesis + 1);
    const overloadEnd = source.indexOf(';', closingParenthesis + 1);
    if (openingBrace < 0) throw new Error(`Could not find ${displayName} body`);
    if (overloadEnd >= 0 && overloadEnd < openingBrace) return null;
    let depth = 0;
    for (let index = openingBrace; index < source.length; index++) {
        const character = source[index];
        if (character === '{') depth++;
        else if (character === '}' && --depth === 0) {
            return source.slice(openingBrace, index + 1);
        }
    }
    throw new Error(`Could not find the end of ${displayName} body`);
}

function methodBody(source: string, methodName: string): string {
    const escapedName = escapeRegExp(methodName);
    const signatures = new RegExp(
        `^\\s{4}(?:(?:public|private|protected|static|override|async|readonly)\\s+)*${escapedName}(?:<[^\\n{]+>)?\\s*\\(`,
        'gmu'
    );
    for (const signature of source.matchAll(signatures)) {
        const signatureIndex = signature.index;
        const body = bodyFromSignature(source, signatureIndex, methodName);
        if (body) return body;
    }
    throw new Error(`Could not find ${methodName} method body`);
}

function functionBody(source: string, functionName: string): string {
    const escapedName = escapeRegExp(functionName);
    const signature = new RegExp(
        String.raw`^(?:export\s+)?(?:async\s+)?function\s+${escapedName}(?:<[^\n{]+>)?\s*\(`,
        'mu'
    ).exec(source);
    if (!signature) throw new Error(`Could not find ${functionName} function`);
    const body = bodyFromSignature(source, signature.index, functionName);
    if (!body) throw new Error(`Could not find ${functionName} implementation`);
    return body;
}

describe('render hot-path architecture', () => {
    it('keeps resource-only scriptable passes out of scene semantic activation', () => {
        const pipeline = sourceAt('/render/internal/ScriptableRenderPipelineContext.ts');
        for (const methodName of [
            'configureFullscreenDraw',
            'configureComputeDispatch',
            'configureGPUDrivenDraw'
        ]) {
            const body = methodBody(pipeline, methodName);
            expect(body).toContain('beginScriptableResourcePass(context)');
            expect(body).not.toContain('beginScriptableMeshPass(context)');
            expect(body).not.toContain('prepareScriptableCullingScene');
        }

        const rendererList = methodBody(pipeline, 'appendRendererListDraws');
        expect(rendererList).toContain('beginScriptableMeshPass(context)');
        expect(rendererList).not.toContain('beginScriptableResourcePass(context)');
    });

    it('batches Clustered Forward+ bucket draws into one depth and one color graph pass', () => {
        const clustered = sourceAt('/render/pipeline/ClusteredForwardPlus.ts');
        const depth = methodBody(clustered, 'recordDepthPrepass');
        const color = methodBody(clustered, 'recordColorPasses');

        expect(depth).toContain('this.#depthBatchPass');
        expect(color).toContain('this.#colorBatchPass');
        expect(depth.match(/context\.graph\.addPass\s*\(/gu)).toHaveLength(1);
        expect(color.match(/context\.graph\.addPass\s*\(/gu)).toHaveLength(1);
    });

    it('keeps RHI under render and backend renderer implementations internal', () => {
        expect(Object.keys(legacyRenderRoots)).toEqual([]);
        expect(
            Object.keys(sources).filter(path =>
                /\/(?:WebGLRenderer|WebGPURenderer)\.ts$/u.test(path)
            )
        ).toEqual([]);
    });

    it('exposes only the async factory and returns the shared RHI driver without a facade', () => {
        const renderer = sourceAt('/render/Renderer.ts');
        const factory = sourceAt('/render/internal/RendererFactory.ts');
        expect(factory).toMatch(/from\s+['"]\.\/SharedRendererDriver['"]/u);
        expect(factory).not.toMatch(/from\s+['"]\.\/(?:webgl2|webgpu)\//u);

        const constructor = methodBody(renderer, 'constructor');
        const create = methodBody(renderer, 'create');
        const constructRenderer = functionBody(factory, 'constructRenderer');
        expect(constructor).toMatch(/Renderer cannot be constructed directly/u);
        expect(create).toMatch(/return\s+createRenderer\s*\(\s*options\s*\)/u);
        expect(constructRenderer).toMatch(/return\s+new\s+SharedRendererDriver\s*\(/u);
        expect(`${renderer}\n${factory}`).not.toMatch(/new\s+Proxy\s*\(/u);
        expect(renderer).not.toMatch(
            /^\s{4}(?:(?:public|private|protected|override|async)\s+)*(?:render|renderFrame|renderToTarget|present)\s*\(/mu
        );
        expect(renderer).not.toMatch(
            /\b(?:driver|delegate|implementation)\.(?:render|renderFrame|renderToTarget|present)\s*\(/u
        );
    });

    it('keeps generic RHI command forwarding out of the public renderer layer', () => {
        const publicLayer = [
            sourceAt('/render/Renderer.ts'),
            sourceAt('/render/RendererCore.ts')
        ].join('\n');
        expect(publicLayer).not.toMatch(/from\s+['"][^'"]*\/rhi(?:\/|['"])/u);
        expect(publicLayer).not.toMatch(/\bRHIRenderPassEncoder\b/u);
        expect(publicLayer).not.toMatch(
            /\.(?:setPipeline|setBindGroup|setVertexBuffer|setIndexBuffer|draw|drawIndexed)\s*\(/u
        );
    });

    it('keeps only the production WebGL2 and WebGPU RHI backends', () => {
        const factory = sourceAt('/render/rhi/RHIFactory.ts');
        expect(factory).toContain('createWebGL2RHIDevice(');
        expect(factory).toContain('createWebGPUDevice(');
        expect(factory).toMatch(/from\s+['"]\.\/backends\/webgl2['"]/u);
        expect(factory).toMatch(/from\s+['"]\.\/backends\/webgpu['"]/u);
        expect(factory).not.toMatch(/new\s+Proxy\s*\(/u);
        expect(
            Object.keys(sources).filter(path =>
                /\/render\/(?:internal\/(?:webgl2|webgpu)|rhi\/(?:legacy|webgl2|webgpu))\//u.test(
                    path
                )
            )
        ).toEqual([]);
    });

    it('resolves external and shadow-atlas texture bindings without per-draw allocation', () => {
        const externalRegistry = sourceAt('/render/renderer/ExternalTextureBindingRegistry.ts');
        const shadowBinding = sourceAt('/render/renderer/ShadowAtlasTextureBinding.ts');
        const externalResolve = methodBody(externalRegistry, 'resolve');
        const shadowResolve = methodBody(shadowBinding, 'resolve');

        const bindingAllocation = /Object\.freeze|return\s*\{|\.map\s*\(|\.slice\s*\(|\.\.\./u;
        expect(externalResolve).not.toMatch(bindingAllocation);
        expect(shadowResolve).not.toMatch(bindingAllocation);
        expect(shadowResolve).toContain('return resources;');
        expect(methodBody(shadowBinding, 'update')).toContain(
            'this.#resources.textureView = resource.view'
        );
    });

    it('routes default rendering through the shared pipeline and keeps draw execution allocation-free', () => {
        const hostRecord = methodBody(
            sourceAt('/render/internal/RenderPipelineHost.ts'),
            'recordPipeline'
        );
        const drawExecute = methodBody(
            sourceAt('/render/renderer/passes/SharedDrawPass.ts'),
            'execute'
        );

        expect(hostRecord).not.toContain('recordDefaultPipeline');
        expect(hostRecord).toContain('createPipelineContext');
        expect(hostRecord.indexOf('createPipelineContext')).toBeLessThan(
            hostRecord.indexOf('runtime.record')
        );
        expect(drawExecute).toContain('draw.execute(');
        expect(drawExecute).not.toMatch(
            /\bnew\s+|Object\.freeze|\.(?:map|filter|flatMap|forEach|slice)\s*\(|\.\.\./u
        );
    });

    it('keeps GPU Scene geometry buckets independent from shared material handles', () => {
        const clustered = sourceAt('/render/pipeline/ClusteredForwardPlus.ts');
        const packObject = methodBody(clustered, 'packObject');

        expect(clustered).toContain(
            "import SharedMaterialRecordDatabase from '../renderer/SharedMaterialRecordDatabase'"
        );
        expect(packObject).toContain('this.#objectUInts[floatOffset + 48] = logicalIndex');
        expect(packObject).toContain(
            'this.#objectUInts[floatOffset + 51] = this.#materialDatabase'
        );
        expect(clustered).toContain('buckets[object.metadata.x]');
        expect(clustered).toContain(
            'v_materialIndex = floatBitsToUint(objects.values[objectBase + 12u].w)'
        );
        expect(clustered).not.toContain('private packMaterials(');
    });

    it('keeps previous-frame Hi-Z bounds conservative for large projected objects', () => {
        const clustered = sourceAt('/render/pipeline/ClusteredForwardPlus.ts');

        expect(clustered).toContain('const MAX_HIZ_OCCLUSION_DIAMETER = 1 << MAX_HIZ_LEVEL_COUNT');
        expect(clustered).toContain(
            'frame.previousProjection * vec4<f32>(viewCenter.xyz + signs * radius, 1.0)'
        );
        expect(clustered).toContain('for (var cornerIndex = 0u; cornerIndex < 8u;');
        expect(clustered).toContain('(maximumUv - minimumUv) * frame.viewport.zw');
        expect(clustered).toContain('const maxHiZOcclusionDiameter = 2 ** hiZLevelCount');
        expect(clustered).toContain('diameter > ${String(maxHiZOcclusionDiameter)}.0');
        expect(clustered).toContain('ceil(log2(diameter)) - 1.0');
        expect(clustered).not.toContain('floor(log2(diameter)) - 1.0');
        expect(clustered).toContain(
            'sqrt(projectionScale * projectionScale + vec2<f32>(1.0)) * radius'
        );
        expect(clustered).toContain('mesh.frustumTest ? OBJECT_FRUSTUM_CULLING_FLAG : 0');
        expect(clustered).toContain('const MAX_HIZ_LEVEL_COUNT = 13');
        expect(clustered).toContain('length: options.hiZLevelCount');
        expect(clustered).toContain('OBJECT_HIZ_STABLE_FLAG');
        expect(clustered).toContain('const occlusionStable = transformStable && boundsStable');
    });

    it('keeps clustered allocation empty-tile aware, deterministic, and directional-global', () => {
        const clustered = sourceAt('/render/pipeline/ClusteredForwardPlus.ts');

        expect(clustered).toContain('vec2<u32>(frameData.cluster.z, 0u)');
        expect(clustered).toContain('let previous = atomicMin(');
        expect(clustered).not.toContain('clusterCursors');
        expect(clustered).toContain('if (id.x >= frameData.directional.y) { return; }');
        expect(clustered).toContain(
            'for (uint lightIndex = 0u; lightIndex < directional.x; lightIndex += 1u)'
        );
    });

    it('uses one compact visible table without requiring indirect-first-instance', () => {
        const clustered = sourceAt('/render/pipeline/ClusteredForwardPlus.ts');

        expect(clustered).toContain("label: 'GPU Scene visible compact table'");
        expect(clustered).toContain('byteLength: this.#visibleBucketCapacity * 4');
        expect(clustered).not.toContain('this.#visibleBucketCapacity * physicalCount * 4');
        expect(clustered).toContain('atomicStore(&indirectArguments[bucket * 5u + 4u], 0u)');
        expect(clustered).toContain('bucketOffsets[bucket *');
        expect(clustered).toContain(
            'visibleIndices.values[visibleOffset.value + uint(gl_InstanceIndex)]'
        );
    });

    it('records fallback into HDR before symmetric bloom and the single display transform', () => {
        const clustered = sourceAt('/render/pipeline/ClusteredForwardPlus.ts');
        const record = methodBody(clustered, 'record');
        const display = methodBody(clustered, 'recordDisplay');

        expect(record.indexOf('this.recordFallback(')).toBeLessThan(
            record.indexOf('this.recordDisplay(')
        );
        expect(record).toContain("format: 'rgba16float'");
        expect(display).toContain('BLOOM_HORIZONTAL_PASS');
        expect(display).toContain('BLOOM_VERTICAL_PASS');
        expect(record).toContain('const bloomEnabled = this.#options.bloomStrength > 0');
        expect(display).toContain('this.#options.bloomStrength > 0');
        expect(clustered).toContain('const withBloom = bloomStrength > 0');
        expect(clustered).not.toContain('BLOOM_BLUR_PASS');
        expect(clustered).not.toContain('fallbackPresentPass');
    });

    it('updates scene transforms without building a throwaway CPU cull for GPU-only frames', () => {
        const clustered = sourceAt('/render/pipeline/ClusteredForwardPlus.ts');
        const record = methodBody(clustered, 'record');

        expect(record).toContain('context.prepareScene();');
        expect(record).not.toContain('context.cull({ frustumCulling: false })');
        expect(record.match(/context\.cull\s*\(/gu)).toHaveLength(1);
        expect(record.indexOf('if (this.#fallbackObjectCount !== 0)')).toBeLessThan(
            record.indexOf('fallbackCulling = context.cull()')
        );
    });

    it('shares one invariant GPU Scene clip transform across depth, attributes, and color passes', () => {
        const clustered = sourceAt('/render/pipeline/ClusteredForwardPlus.ts');

        expect(clustered.match(/\$\{GPU_SCENE_POSITION_TRANSFORM_SOURCE\}/gu)).toHaveLength(5);
        expect(
            clustered.match(/gl_Position = gpuSceneClipPosition\(objectBase, a_position\);/gu)
        ).toHaveLength(5);
        expect(clustered).not.toContain('gl_Position = readFrameMatrix(0u) * worldPosition;');
    });
});
