import Shader from '../../shader/Shader';
import mipmapFragmentSource from '../../shader/webgpu/mipmap.frag';
import mipmapVertexSource from '../../shader/webgpu/mipmap.vert';
import type { RHIGraphicsShaderArtifactInput } from '../rhi/core';
import type { ShaderArtifactCompiler } from './ShaderArtifactCompiler';

const WEBGPU_MIPMAP_SHADER = new Shader({
    vs: mipmapVertexSource,
    fs: mipmapFragmentSource
});

/**
 * Prepare the WebGPU-only mipmap utility through the same GLSL preprocessing and Naga path as
 * renderer shaders. The RHI receives artifacts and never imports or translates engine GLSL.
 *
 * @internal
 */
export function prepareWebGPUMipmapShaderArtifacts(
    compiler: ShaderArtifactCompiler
): Readonly<RHIGraphicsShaderArtifactInput> {
    const compiled = compiler.compile(WEBGPU_MIPMAP_SHADER, 'webgpu');
    return Object.freeze({
        vertex: compiled.vertex,
        fragment: compiled.fragment
    });
}
