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
});
