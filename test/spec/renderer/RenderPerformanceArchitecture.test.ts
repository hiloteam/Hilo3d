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

function matchCount(source: string, pattern: RegExp): number {
    pattern.lastIndex = 0;
    return [...source.matchAll(pattern)].length;
}

const allocationHeavyOperation =
    /(?:\.(?:map|filter|slice)\s*\(|Array\.from\s*\(|\.\.\.|\binstanceof\b|new\s+(?:Map|Set|Array|[A-Z][A-Za-z0-9]*Array)\s*[<(])/gu;

describe('render hot-path architecture', () => {
    it('keeps RHI under render and backend renderer implementations internal', () => {
        expect(Object.keys(legacyRenderRoots)).toEqual([]);
        expect(
            Object.keys(sources).filter(path =>
                /\/(?:WebGLRenderer|WebGPURenderer)\.ts$/u.test(path)
            )
        ).toEqual([]);
    });

    it('constructs and returns the shared RHI v2 driver instead of a render facade', () => {
        const renderer = sourceAt('/render/Renderer.ts');
        const factory = sourceAt('/render/internal/RendererFactory.ts');
        expect(factory).toMatch(/from\s+['"]\.\/SharedRendererDriver['"]/u);
        expect(factory).not.toMatch(/from\s+['"]\.\/(?:webgl2|webgpu)\//u);

        const constructor = methodBody(renderer, 'constructor');
        const constructRenderer = functionBody(factory, 'constructRenderer');
        expect(constructor).toMatch(/return\s+constructRenderer\s*\(\s*options\s*\)/u);
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

    it('keeps the v2 factory primary and the migration factory explicitly legacy', () => {
        const factory = sourceAt('/render/rhi/RHIFactory.ts');
        const legacyFactory = sourceAt('/render/rhi/legacy/RHIFactory.ts');
        const webglDriver = sourceAt('/render/internal/webgl2/WebGL2Driver.ts');
        const webgpuDriver = sourceAt('/render/internal/webgpu/WebGPUDriver.ts');

        expect(factory).toContain('createWebGL2RHIDevice(');
        expect(factory).toContain('createWebGPUV2Device(');
        expect(factory).not.toMatch(/from\s+['"]\.\/(?:webgl2|webgpu)\//u);
        expect(factory).not.toMatch(/new\s+Proxy\s*\(/u);

        expect(legacyFactory).toMatch(/return\s+new\s+WebGLRHI\s*\(/u);
        expect(legacyFactory).toMatch(/return\s+new\s+WebGPURHI\s*\(/u);
        expect(legacyFactory).not.toMatch(/new\s+Proxy\s*\(/u);
        expect(methodBody(webglDriver, 'createContext')).toContain("constructLegacyRHI('webgl2',");
        expect(methodBody(webgpuDriver, 'initialize')).toContain("constructLegacyRHI('webgpu',");
    });

    it('retains the WebGL2 frame-scoped native session and direct VAO draw loop', () => {
        const driver = sourceAt('/render/internal/webgl2/WebGL2Driver.ts');
        const render = methodBody(driver, 'render');
        const nativeSession = methodBody(driver, 'runWithNativeSession');
        const renderMesh = methodBody(driver, 'renderMesh');

        expect(render).toContain('this.runWithNativeSession(');
        expect(nativeSession).toContain('rhi.device.runWithNativeContext(');
        expect(renderMesh).toContain('this.setupMesh(');
        expect(renderMesh).toContain('vao.draw()');
        expect(renderMesh).not.toMatch(/createCommandEncoder|RHIRenderPassEncoder/u);
        expect(driver).not.toMatch(/\bRHIRenderPassEncoder\b/u);
    });

    it('retains the WebGPU native encoder, native submit, and command-state draw path', () => {
        const driver = sourceAt('/render/internal/webgpu/WebGPUDriver.ts');
        const device = sourceAt('/render/rhi/webgpu/WebGPUDevice.ts');
        const renderInternal = methodBody(driver, 'renderInternal');
        const encodeDraw = methodBody(driver, 'encodeDraw');
        const createNativeEncoder = methodBody(device, 'createNativeCommandEncoder');
        const submitNative = methodBody(device, 'submitNative');

        expect(renderInternal).toContain('this.concreteDevice.createNativeCommandEncoder(');
        expect(renderInternal).toContain('this.concreteDevice.submitNative(');
        expect(encodeDraw).toContain('this.commandState.setPipeline(');
        expect(encodeDraw).toContain('this.commandState.setBindGroup(');
        expect(encodeDraw).toContain('this.commandState.setVertexBuffer(');
        expect(encodeDraw).toMatch(/pass\.(?:draw|drawIndexed)\s*\(/u);
        expect(driver).not.toMatch(/\bRHIRenderPassEncoder\b/u);

        expect(createNativeEncoder).toContain('this.#nativeHandle.createCommandEncoder(');
        expect(createNativeEncoder).not.toMatch(/new\s+WebGPUCommandEncoder/u);
        expect(submitNative).toContain('this.#nativeHandle.queue.submit(');
    });

    it('keeps the established draw methods free of collection-copy and type-dispatch work', () => {
        const hotMethods = [
            [sourceAt('/render/internal/webgl2/WebGL2Driver.ts'), 'renderMesh'],
            [sourceAt('/render/internal/webgl2/VertexArrayObject.ts'), 'draw'],
            [sourceAt('/render/internal/webgl2/VertexArrayObject.ts'), 'drawInstance'],
            [sourceAt('/render/internal/webgpu/WebGPUDriver.ts'), 'encodeDraw'],
            [sourceAt('/render/internal/webgpu/WebGPUCommandState.ts'), 'setPipeline'],
            [sourceAt('/render/internal/webgpu/WebGPUCommandState.ts'), 'setVertexBuffer'],
            [sourceAt('/render/internal/webgpu/WebGPUCommandState.ts'), 'setIndexBuffer'],
            [sourceAt('/render/rhi/webgpu/WebGPUDevice.ts'), 'createNativeCommandEncoder'],
            [sourceAt('/render/rhi/webgpu/WebGPUDevice.ts'), 'submitNative']
        ] as const;

        const violations = hotMethods.flatMap(([source, method]) => {
            const body = methodBody(source, method);
            return [...body.matchAll(allocationHeavyOperation)].map(match => ({
                method,
                match: match[0]
            }));
        });
        expect(violations).toEqual([]);
    });

    it('does not grow the existing dynamic-offset compatibility allocations', () => {
        const state = sourceAt('/render/internal/webgpu/WebGPUCommandState.ts');

        // These are compatibility snapshots around WebGPU's two dynamic-offset overloads. They are
        // capped here so the refactor cannot spread allocation-heavy work to other command state.
        expect(matchCount(state, /Array\.from\s*\(/gu)).toBeLessThanOrEqual(2);
        expect(matchCount(state, /\[\s*\.\.\./gu)).toBeLessThanOrEqual(1);
        expect(matchCount(state, /\binstanceof\b/gu)).toBeLessThanOrEqual(1);
        expect(matchCount(state, /new\s+Map(?:\s*<|\s*\()/gu)).toBeLessThanOrEqual(2);
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
});
