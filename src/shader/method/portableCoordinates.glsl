#ifndef HILO_PORTABLE_COORDINATES
#define HILO_PORTABLE_COORDINATES

/**
 * Convert a logical, top-left-origin texture coordinate to the backend-native sampler coordinate.
 *
 * Hilo3D textures, glTF texture coordinates and public texture/readback rows all use a top-left
 * origin. WebGL samplers use a bottom-left origin while WebGPU samplers already use the portable
 * convention.
 */
vec2 hiloTextureUV(vec2 uv) {
#ifdef HILO_WEBGPU
    return uv;
#else
    return vec2(uv.x, 1.0 - uv.y);
#endif
}

/**
 * Convert a logical cube direction into the backend-native cube lookup direction.
 *
 * The WebGL backend adapts cube face rows while uploading and copying texture data. Keeping this
 * direction continuous is required for native seamless filtering across cube face boundaries.
 */
vec3 hiloTextureCubeDirection(vec3 direction) {
    return direction;
}

/**
 * Convert fullscreen geometry UVs into a backend-native render-target sampler coordinate.
 *
 * Fullscreen geometry is authored with WebGL's bottom-left UV convention. WebGPU attachments and
 * storage images expose row zero at the top, so only the WebGPU shader artifact needs a V flip.
 */
vec2 hiloRenderTargetUV(vec2 uv) {
#ifdef HILO_WEBGPU
    return vec2(uv.x, 1.0 - uv.y);
#else
    return uv;
#endif
}

/**
 * Convert the backend-native fragment position into a bottom-left-origin screen coordinate.
 *
 * GLSL ES defines gl_FragCoord from the lower-left while WebGPU fragment positions originate at
 * the upper-left. Pass the active attachment size explicitly because fragment shaders do not have
 * an implicit portable viewport-size builtin.
 */
vec2 hiloBottomLeftFragCoord(vec2 nativeFragCoord, vec2 attachmentSize) {
#ifdef HILO_WEBGPU
    return vec2(nativeFragCoord.x, attachmentSize.y - nativeFragCoord.y);
#else
    return nativeFragCoord;
#endif
}

#endif
