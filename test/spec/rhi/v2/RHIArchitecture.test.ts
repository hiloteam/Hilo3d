import { describe, expect, it } from 'vitest';

const coreSources = import.meta.glob<string>('../../../../src/render/rhi/core/**/*.ts', {
    eager: true,
    query: '?raw',
    import: 'default'
});
const sharedRenderSources = import.meta.glob<string>(
    [
        '../../../../src/render/*.{ts,tsx,mts,cts}',
        '../../../../src/render/internal/*.{ts,tsx,mts,cts}',
        '../../../../src/render/{frame,graph,renderer,ubo}/**/*.{ts,tsx,mts,cts}'
    ],
    {
        eager: true,
        query: '?raw',
        import: 'default'
    }
);
const webGL2BackendSources = import.meta.glob<string>(
    '../../../../src/render/rhi/backends/webgl2/**/*.{ts,tsx,mts,cts}',
    { eager: true, query: '?raw', import: 'default' }
);
const webGPUBackendSources = import.meta.glob<string>(
    '../../../../src/render/rhi/backends/webgpu/**/*.{ts,tsx,mts,cts}',
    { eager: true, query: '?raw', import: 'default' }
);
const renderGraphCompilerSource = import.meta.glob<string>(
    '../../../../src/render/graph/RenderGraphCompiler.ts',
    { eager: true, query: '?raw', import: 'default' }
);
const preparedDrawSource = import.meta.glob<string>(
    '../../../../src/render/renderer/PreparedDraw.ts',
    { eager: true, query: '?raw', import: 'default' }
);
const sharedDrawPassSource = import.meta.glob<string>(
    '../../../../src/render/renderer/passes/SharedDrawPass.ts',
    { eager: true, query: '?raw', import: 'default' }
);
const webGPUV2RenderPassSource = import.meta.glob<string>(
    '../../../../src/render/rhi/backends/webgpu/WebGPUV2RenderPass.ts',
    { eager: true, query: '?raw', import: 'default' }
);
const rhiCopyValidationSource = import.meta.glob<string>(
    '../../../../src/render/rhi/core/RHICopyValidation.ts',
    { eager: true, query: '?raw', import: 'default' }
);
const webGL2CommandsSource = import.meta.glob<string>(
    '../../../../src/render/rhi/backends/webgl2/WebGL2Commands.ts',
    { eager: true, query: '?raw', import: 'default' }
);
const webGL2PipelineSource = import.meta.glob<string>(
    '../../../../src/render/rhi/backends/webgl2/WebGL2Pipeline.ts',
    { eager: true, query: '?raw', import: 'default' }
);
const webGPUV2CommandsSource = import.meta.glob<string>(
    '../../../../src/render/rhi/backends/webgpu/WebGPUV2Commands.ts',
    { eager: true, query: '?raw', import: 'default' }
);
const webGPUV2BaseSource = import.meta.glob<string>(
    '../../../../src/render/rhi/backends/webgpu/WebGPUV2Base.ts',
    { eager: true, query: '?raw', import: 'default' }
);
const webGPUV2QueueSource = import.meta.glob<string>(
    '../../../../src/render/rhi/backends/webgpu/WebGPUV2Queue.ts',
    { eager: true, query: '?raw', import: 'default' }
);

interface SourceViolation {
    readonly path: string;
    readonly match: string;
}

function collectMatches(
    pattern: RegExp,
    sources: Readonly<Record<string, string>> = coreSources
): SourceViolation[] {
    const violations: SourceViolation[] = [];
    for (const [path, source] of Object.entries(sources)) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
            violations.push({ path, match: match[0] });
        }
    }
    return violations;
}

function methodBody(source: string, methodName: string): string {
    const signature = new RegExp(
        `\\n\\s{4}(?:(?:public|private|protected)\\s+)?${methodName}\\s*\\(`,
        'u'
    ).exec(source);
    if (!signature) throw new Error(`Could not find ${methodName} method`);
    const openingBrace = source.indexOf('{', signature.index);
    if (openingBrace < 0) throw new Error(`Could not find ${methodName} method body`);
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
        const character = source[index];
        if (character === '{') depth += 1;
        else if (character === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(openingBrace, index + 1);
        }
    }
    throw new Error(`Could not find the end of ${methodName} method`);
}

function functionBody(source: string, functionName: string): string {
    const signature = new RegExp(`function\\s+${functionName}\\s*\\(`, 'u').exec(source);
    if (!signature) throw new Error(`Could not find ${functionName} function`);
    const openingBrace = source.indexOf('{', signature.index);
    if (openingBrace < 0) throw new Error(`Could not find ${functionName} function body`);
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
        const character = source[index];
        if (character === '{') depth += 1;
        else if (character === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(openingBrace, index + 1);
        }
    }
    throw new Error(`Could not find the end of ${functionName} function`);
}

describe('RHI v2 core architecture', () => {
    it('exists as a complete backend-neutral package', () => {
        const paths = Object.keys(coreSources);
        expect(paths.length).toBeGreaterThanOrEqual(10);
        for (const file of [
            'RHITypes.ts',
            'RHICapabilities.ts',
            'RHIIdentity.ts',
            'RHIResources.ts',
            'RHIPipeline.ts',
            'RHICommands.ts',
            'RHIQueue.ts',
            'RHISurface.ts',
            'RHIValidation.ts',
            'RHICopyValidation.ts',
            'index.ts'
        ]) {
            expect(
                paths.some(path => path.endsWith(`/core/${file}`)),
                file
            ).toBe(true);
        }
    });

    it('does not depend on the legacy RHI or either concrete backend', () => {
        expect(
            collectMatches(
                /from\s+['"][^'"]*(?:\/rhi\/RHI|\.\.\/RHI|\/webgl2\/|\/webgpu\/|\/backends\/)[^'"]*['"]/gu
            )
        ).toEqual([]);
    });

    it('contains no native graphics API types or calls', () => {
        expect(
            collectMatches(
                /\b(?:WebGL2RenderingContext|WebGLRenderingContext|GPU(?:Adapter|BindGroup|Buffer|CanvasContext|CommandEncoder|Device|Queue|RenderPassEncoder|RenderPipeline|Sampler|ShaderModule|Texture|TextureView))\b|\bgl\s*\.|navigator\s*\.\s*gpu/gu
            )
        ).toEqual([]);
    });

    it('does not contain renderer or scene semantics', () => {
        expect(
            collectMatches(
                /from\s+['"][^'"]*(?:core\/|material\/|geometry\/|light\/|shader\/|texture\/|Renderer|RenderList|RenderTarget|internal\/)[^'"]*['"]/gu
            )
        ).toEqual([]);
        expect(
            collectMatches(/\b(?:Scene|Mesh|Material|LightManager|PreparedDraw|RenderList)\b/gu)
        ).toEqual([]);
    });
});

describe('RHI v2 hardware boundary', () => {
    it('keeps shared renderer, frame and graph code free of native graphics APIs', () => {
        const violations = collectMatches(
            /\b(?:GPU[A-Z][A-Za-z0-9_]*|WebGL(?:2[A-Z][A-Za-z0-9_]*|[A-Z][A-Za-z0-9_]*)|GL(?:bitfield|boolean|char|enum|float|int|intptr|sizei|sizeiptr|uint))\b|\bnavigator\s*(?:\?\.|\.)\s*gpu\b|\bgl\s*(?:\?\.|\.)|\.getContext\s*\(\s*['"](?:webgl2?|webgpu)['"]/gu,
            sharedRenderSources
        );
        expect(violations).toEqual([]);
    });

    it('keeps shared renderer, frame and graph code independent of concrete backends', () => {
        expect(
            collectMatches(
                /(?:from\s+|import\s*(?:\(\s*)?)["'][^"']*(?:\/(?:internal\/(?:webgl2|webgpu)|rhi\/(?:backends\/)?(?:webgl2|webgpu)))(?:\/[^"']*)?["']/gu,
                sharedRenderSources
            )
        ).toEqual([]);
    });

    it('does not mix native APIs between the new concrete backends', () => {
        expect(
            collectMatches(
                /\bGPU[A-Z][A-Za-z0-9_]*\b|\bnavigator\s*(?:\?\.|\.)\s*gpu\b/gu,
                webGL2BackendSources
            )
        ).toEqual([]);
        expect(
            collectMatches(
                /\bWebGL(?:2[A-Z][A-Za-z0-9_]*|[A-Z][A-Za-z0-9_]*)\b|\bgl\s*(?:\?\.|\.)/gu,
                webGPUBackendSources
            )
        ).toEqual([]);
    });
});

describe('Render Graph and PreparedDraw architecture', () => {
    it('keeps graph compilation pure and independent from queue execution', () => {
        const sources = Object.values(renderGraphCompilerSource);
        expect(sources).toHaveLength(1);
        expect(
            collectMatches(
                /\.(?:beginFrame|endFrame|createBuffer|createTexture|beginRenderPass|draw|submit)\s*\(/gu,
                renderGraphCompilerSource
            )
        ).toEqual([]);
        expect(
            collectMatches(
                /from\s+['"][^'"]*(?:RenderGraphExecutor|\/backends\/|\/webgl2\/|\/webgpu\/)[^'"]*['"]/gu,
                renderGraphCompilerSource
            )
        ).toEqual([]);
    });

    it('keeps PreparedDraw execute free of steady-state collection and object allocation', () => {
        const source = Object.values(preparedDrawSource)[0];
        expect(source).toBeDefined();
        const execute = methodBody(source ?? '', 'execute');
        expect(execute).toMatch(/\.setVertexBufferRecord\s*\(/u);
        expect(execute).toMatch(/\.setIndexBufferRecord\s*\(/u);
        expect(execute).toMatch(/\.drawRecord\s*\(/u);
        expect(execute).toMatch(/\.drawIndexedRecord\s*\(/u);
        expect(execute).not.toMatch(/\.setVertexBuffer\s*\(/u);
        expect(execute).not.toMatch(/\.setIndexBuffer\s*\(/u);
        expect(execute).not.toMatch(/\.draw\s*\(/u);
        expect(execute).not.toMatch(/\.drawIndexed\s*\(/u);
        expect(execute).not.toMatch(
            /(?:\bnew\s+|\.(?:map|filter|slice|flatMap)\s*\(|Array\.from\s*\(|\.\.\.|=>|JSON\.stringify\s*\()/gu
        );
        expect(execute).not.toMatch(/\b(?:Map|Set|Array)\b/gu);
    });

    it('keeps shared pass execute descriptor-stable and allocation-free', () => {
        const source = Object.values(sharedDrawPassSource)[0];
        expect(source).toBeDefined();
        const execute = methodBody(source ?? '', 'execute');
        expect(execute).toMatch(/\.beginRenderPass\s*\(/u);
        expect(execute).toMatch(/\.execute\s*\(\s*pass(?:,\s*[^)]*)?\)/u);
        expect(execute).toMatch(/\.end\s*\(\)/u);
        expect(execute).not.toMatch(
            /(?:\bnew\s+|\.(?:map|filter|slice|flatMap|concat)\s*\(|Array\.(?:from|of)\s*\(|\.\.\.|=>|JSON\.stringify\s*\()/gu
        );
        expect(execute).not.toMatch(
            /\b(?:Map|Set|Array|createGraphicsPipeline|createBindGroup|createTexture|createView)\b/gu
        );
    });

    it('prepares WebGL VAOs outside draw execution and keeps lookup allocation-free', () => {
        const source = Object.values(webGL2PipelineSource)[0] ?? '';
        const prepare = methodBody(source, 'prepareVertexInput');
        const bind = methodBody(source, 'bindVertexArray');
        expect(prepare).toMatch(/\.ensureVertexArray\s*\(/u);
        expect(bind).toMatch(/\.findVertexArray\s*\(/u);
        expect(bind).not.toMatch(
            /(?:\bnew\s+|createVertexArray\s*\(|new\s+(?:Uint|Int|Float)\d+Array\s*\()/gu
        );
        expect(bind).not.toMatch(/\.ensureVertexArray\s*\(/u);
        const sharedPrepare = methodBody(
            Object.values(sharedDrawPassSource)[0] ?? '',
            'prepareForExecute'
        );
        expect(sharedPrepare).toMatch(/\.prepareVertexInput\s*\(\s*\)/u);
    });
});

describe('WebGPU v2 render-pass hot-path architecture', () => {
    it('uses preallocated scalar storage and allocation-free command paths', () => {
        const source = Object.values(webGPUV2RenderPassSource)[0];
        expect(source).toBeDefined();
        const renderPassSource = source ?? '';
        const steadyStateMethods = [
            'setPipeline',
            'setBindGroup',
            'setVertexBuffer',
            'setVertexBufferRecord',
            'setIndexBuffer',
            'setIndexBufferRecord',
            'setViewport',
            'setViewportRecord',
            'setScissorRect',
            'setScissorRectRecord',
            'setBlendConstant',
            'setStencilReference',
            'draw',
            'drawRecord',
            'drawIndexed',
            'drawIndexedRecord',
            'validatePipelineCompatibility',
            'validateBindGroupLayout',
            'validateDynamicOffsets',
            'assertPipelineAndBindings'
        ];
        const forbiddenAllocation =
            /(?:\bnew\s+|\.(?:map|filter|slice|flatMap|find|every|reduce)\s*\(|Array\.(?:from|of)\s*\(|Object\.(?:entries|keys|values)\s*\(|\.\.\.|=>)/gu;

        for (const methodName of steadyStateMethods) {
            expect(methodBody(renderPassSource, methodName), methodName).not.toMatch(
                forbiddenAllocation
            );
        }

        expect(renderPassSource).toMatch(/#boundVertexBufferOffsets: Float64Array/u);
        expect(renderPassSource).toMatch(/#boundVertexBufferSizes: Float64Array/u);
        expect(methodBody(renderPassSource, 'setVertexBuffer')).not.toMatch(
            /#boundVertexBuffers\s*\[[^\]]+\]\s*=\s*\{/u
        );
        expect(methodBody(renderPassSource, 'setIndexBuffer')).not.toMatch(
            /#indexBuffer\s*=\s*\{/u
        );
    });

    it('keeps stable record methods direct instead of forwarding through scalar commands', () => {
        const sourcePairs = [
            ['WebGL2', Object.values(webGL2CommandsSource)[0] ?? ''],
            ['WebGPU', Object.values(webGPUV2RenderPassSource)[0] ?? '']
        ] as const;
        const methodPairs = [
            ['setVertexBufferRecord', 'setVertexBuffer'],
            ['setIndexBufferRecord', 'setIndexBuffer'],
            ['drawRecord', 'draw'],
            ['drawIndexedRecord', 'drawIndexed']
        ] as const;

        for (const [backend, source] of sourcePairs) {
            for (const [recordMethod, scalarMethod] of methodPairs) {
                expect(methodBody(source, recordMethod), `${backend}.${recordMethod}`).not.toMatch(
                    new RegExp(`\\bthis\\.${scalarMethod}\\s*\\(`, 'u')
                );
            }
        }
    });
});

describe('WebGPU v2 frame-retention hot-path architecture', () => {
    it('uses frame stamps and pooled indexed storage without per-frame identity collections', () => {
        const baseSource = Object.values(webGPUV2BaseSource)[0] ?? '';
        const retainForFrame = methodBody(baseSource, 'retainForFrame');
        expect(retainForFrame).toMatch(/#lastRetainedFrameId\s*===\s*frameId/u);
        expect(retainForFrame).toMatch(/return false/u);
        expect(retainForFrame).toMatch(/#retainCount\s*\+=\s*1/u);

        const commandsSource = Object.values(webGPUV2CommandsSource)[0] ?? '';
        const retain = methodBody(commandsSource, 'retain');
        expect(retain).toMatch(/\.retainForFrame\s*\(\s*this\.frameId\s*\)/u);
        expect(retain).toMatch(/\.objects\s*\[\s*index\s*\]\s*=\s*object/u);
        expect(retain).not.toMatch(/\b(?:Set|Map)\b|\.(?:has|add|push)\s*\(/gu);
        expect(commandsSource).not.toMatch(/#retainedObjects/u);

        const queueSource = Object.values(webGPUV2QueueSource)[0] ?? '';
        const release = methodBody(queueSource, 'releaseFrameReferences');
        expect(release).toMatch(/index\s*<\s*references\.count/u);
        expect(release).toMatch(/references\.objects\s*\[\s*index\s*\]\s*=\s*null/u);
        expect(release).toMatch(/references\.count\s*=\s*0/u);
        expect(release).not.toMatch(/\.push\s*\(|\.length\s*=\s*0/u);
        expect(queueSource).not.toMatch(/#freeRetainedObjects/u);
        expect(queueSource).toMatch(
            /#submitBuffers:\s*GPUCommandBuffer\[\]\s*=\s*\[null as unknown as GPUCommandBuffer\]/u
        );
        expect(queueSource).toMatch(
            /#submitBuffers\s*\[\s*0\s*\]\s*=\s*null as unknown as GPUCommandBuffer/u
        );
    });
});

describe('RHI queued upload hot-path architecture', () => {
    it('keeps successful core write validation scalar and free of dynamic path strings', () => {
        const source = Object.values(rhiCopyValidationSource)[0] ?? '';
        for (const functionName of [
            'validateBufferRange',
            'validateRHIWriteBufferParameters',
            'validateLinearTextureLayout',
            'validateRHIWriteTextureParameters',
            'resolveRHIExternalImageSourceDimensionsInto',
            'validateExternalImageCopyParameters'
        ]) {
            const body = functionBody(source, functionName);
            expect(body, functionName).not.toMatch(/`[^`]*\$\{/gu);
            expect(body, functionName).not.toMatch(
                /(?:return\s*\{|Object\.(?:freeze|assign|create)\s*\(|Array\.(?:from|of)\s*\(|\.(?:map|filter|slice|flatMap)\s*\()/gu
            );
        }
        expect(functionBody(source, 'validateRHIWriteTextureParameters')).not.toMatch(
            /normalizeCopy(?:Extent|Origin)|textureMipExtent|validateTextureCopy\s*\(/gu
        );
        expect(functionBody(source, 'validateExternalImageCopyParameters')).not.toMatch(
            /getRHIExternalImageSourceDimensions|normalizeCopy(?:Extent|Origin)|textureMipExtent|validateTextureCopy\s*\(/gu
        );
    });

    it('uses scalar WebGL upload coordinates and queue-owned WebGPU native dictionaries', () => {
        const webGLSource = Object.values(webGL2CommandsSource)[0] ?? '';
        const webGLUpload = methodBody(webGLSource, 'uploadBufferBytesToTexture');
        expect(webGLUpload).not.toMatch(/normalizedExtent\s*\(|const\s+origin\s*=\s*\{/gu);
        const webGLExternalUpload = methodBody(webGLSource, 'uploadExternalImageToTexture');
        expect(webGLExternalUpload).not.toMatch(
            /normalizedExtent\s*\(|\.bind\s*\(|pixelStores|for\s*\(\s*const\s*\[/gu
        );

        const webGPUSource = Object.values(webGPUV2CommandsSource)[0] ?? '';
        const webGPUWriteTexture = methodBody(webGPUSource, 'writeTexture');
        expect(webGPUWriteTexture).toMatch(/this\.queue\.textureUploadSource/gu);
        expect(webGPUWriteTexture).toMatch(/this\.queue\.textureUploadDestination/gu);
        expect(webGPUWriteTexture).toMatch(/this\.queue\.textureUploadExtent/gu);
        expect(webGPUWriteTexture).not.toMatch(
            /native(?:ImageCopyTexture|TextureCopyExtent|WebGPUOrigin)\s*\(|copyBufferToTexture\s*\(\s*\{/gu
        );
        const webGPUExternalUpload = methodBody(webGPUSource, 'copyExternalImageToTexture');
        expect(webGPUExternalUpload).toMatch(/this\.queue\.externalImageSource/gu);
        expect(webGPUExternalUpload).toMatch(/this\.queue\.externalImageDestination/gu);
        expect(webGPUExternalUpload).toMatch(/this\.queue\.externalImageExtent/gu);
        expect(webGPUExternalUpload).not.toMatch(
            /nativeWebGPUOrigin\s*\(|copyExternalImageToTexture\s*\(\s*\{/gu
        );

        const queueSource = Object.values(webGPUV2QueueSource)[0] ?? '';
        expect(queueSource).toMatch(/readonly textureUploadSource: GPUTexelCopyBufferInfo/gu);
        expect(queueSource).toMatch(/readonly textureUploadDestination: GPUTexelCopyTextureInfo/gu);
        expect(queueSource).toMatch(/readonly textureUploadExtent: GPUExtent3DDict/gu);
        expect(queueSource).toMatch(
            /readonly externalImageSource: GPUCopyExternalImageSourceInfo/gu
        );
        expect(queueSource).toMatch(
            /readonly externalImageDestination: GPUCopyExternalImageDestInfo/gu
        );
        expect(queueSource).toMatch(/readonly externalImageExtent: GPUExtent3DDict/gu);
    });
});
