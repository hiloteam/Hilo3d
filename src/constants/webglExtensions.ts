// modified from https://github.com/06wj/gl-extensions-constants/blob/master/index.js

/**
 * Describes the frequency divisor used for instanced rendering.
 */
export const VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE = 0x88fe;
/**
 * Passed to getParameter to get the vendor string of the graphics driver.
 */
export const UNMASKED_VENDOR_WEBGL = 0x9245;
/**
 * Passed to getParameter to get the renderer string of the graphics driver.
 */
export const UNMASKED_RENDERER_WEBGL = 0x9246;
/**
 * Returns the maximum available anisotropy.
 */
export const MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84ff;
/**
 * Passed to texParameter to set the desired maximum anisotropy for a texture.
 */
export const TEXTURE_MAX_ANISOTROPY_EXT = 0x84fe;
/**
 * A DXT1-compressed image in an RGB image format.
 */
export const COMPRESSED_RGB_S3TC_DXT1_EXT = 0x83f0;
/**
 * A DXT1-compressed image in an RGB image format with a simple on/off alpha value.
 */
export const COMPRESSED_RGBA_S3TC_DXT1_EXT = 0x83f1;
/**
 * A DXT3-compressed image in an RGBA image format. Compared to a 32-bit RGBA texture, it offers 4:1 compression.
 */
export const COMPRESSED_RGBA_S3TC_DXT3_EXT = 0x83f2;
/**
 * A DXT5-compressed image in an RGBA image format. It also provides a 4:1 compression, but differs to the DXT3 compression in how the alpha compression is done.
 */
export const COMPRESSED_RGBA_S3TC_DXT5_EXT = 0x83f3;
/**
 * One-channel (red) unsigned format compression.
 */
export const COMPRESSED_R11_EAC = 0x9270;
/**
 * One-channel (red) signed format compression.
 */
export const COMPRESSED_SIGNED_R11_EAC = 0x9271;
/**
 * Two-channel (red and green) unsigned format compression.
 */
export const COMPRESSED_RG11_EAC = 0x9272;
/**
 * Two-channel (red and green) signed format compression.
 */
export const COMPRESSED_SIGNED_RG11_EAC = 0x9273;
/**
 * Compresses RBG8 data with no alpha channel.
 */
export const COMPRESSED_RGB8_ETC2 = 0x9274;
/**
 * Compresses RGBA8 data. The RGB part is encoded the same as RGB_ETC2, but the alpha part is encoded separately.
 */
export const COMPRESSED_RGBA8_ETC2_EAC = 0x9275;
/**
 * Compresses sRBG8 data with no alpha channel.
 */
export const COMPRESSED_SRGB8_ETC2 = 0x9276;
/**
 * Compresses sRGBA8 data. The sRGB part is encoded the same as SRGB_ETC2, but the alpha part is encoded separately.
 */
export const COMPRESSED_SRGB8_ALPHA8_ETC2_EAC = 0x9277;
/**
 * Similar to RGB8_ETC, but with ability to punch through the alpha channel, which means to make it completely opaque or transparent.
 */
export const COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2 = 0x9278;
/**
 * Similar to SRGB8_ETC, but with ability to punch through the alpha channel, which means to make it completely opaque or transparent.
 */
export const COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2 = 0x9279;
/**
 * RGB compression in 4-bit mode. One block for each 4×4 pixels.
 */
export const COMPRESSED_RGB_PVRTC_4BPPV1_IMG = 0x8c00;
/**
 * RGBA compression in 4-bit mode. One block for each 4×4 pixels.
 */
export const COMPRESSED_RGBA_PVRTC_4BPPV1_IMG = 0x8c02;
/**
 * RGB compression in 2-bit mode. One block for each 8×4 pixels.
 */
export const COMPRESSED_RGB_PVRTC_2BPPV1_IMG = 0x8c01;
/**
 * RGBA compression in 2-bit mode. One block for each 8×4 pixe
 */
export const COMPRESSED_RGBA_PVRTC_2BPPV1_IMG = 0x8c03;
/**
 * Compresses 24-bit RGB data with no alpha channel.
 */
export const COMPRESSED_RGB_ETC1_WEBGL = 0x8d64;
export const /**
     *
     */
    _WEBGL = 0x8c92; //  Compresses RGB textures with no alpha channel.
/**
 * Compresses RGBA textures using explicit alpha encoding (useful when alpha transitions are sharp).
 */
export const COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL = 0x8c92;
/**
 * Compresses RGBA textures using interpolated alpha encoding (useful when alpha transitions are gradient).
 */
export const COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL = 0x87ee;
/**
 * Unsigned integer type for 24-bit depth texture data.
 */
export const UNSIGNED_INT_24_8_WEBGL = 0x84fa;
/**
 * Half floating-point type (16-bit).
 */
export const HALF_FLOAT_OES = 0x8d61;
/**
 * RGBA 32-bit floating-point color-renderable format.
 */
export const RGBA32F_EXT = 0x8814;
/**
 * RGB 32-bit floating-point color-renderable format.
 */
export const RGB32F_EXT = 0x8815;
/**
 * Returns the type of the color-renderable format of the attachment.
 */
export const FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT = 0x8211;
/**
 * Unsigned normalized integer type.
 */
export const UNSIGNED_NORMALIZED_EXT = 0x8c17;
/**
 * Produces the minimum color components of the source and destination colors.
 */
export const MIN_EXT = 0x8007;
/**
 * Produces the maximum color components of the source and destination colors.
 */
export const MAX_EXT = 0x8008;
/**
 * Unsized sRGB format that leaves the precision up to the driver.
 */
export const SRGB_EXT = 0x8c40;
/**
 * Unsized sRGB format with unsized alpha component.
 */
export const SRGB_ALPHA_EXT = 0x8c42;
/**
 * Sized (8-bit) sRGB and alpha formats.
 */
export const SRGB8_ALPHA8_EXT = 0x8c43;
/**
 * Returns the framebuffer color encoding.
 */
export const FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING_EXT = 0x8210;
/**
 * Indicates the accuracy of the derivative calculation for the GLSL built-in functions: dFdx, dFdy, and fwidth.
 */
export const FRAGMENT_SHADER_DERIVATIVE_HINT_OES = 0x8b8b;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT0_WEBGL = 0x8ce0;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT1_WEBGL = 0x8ce1;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT2_WEBGL = 0x8ce2;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT3_WEBGL = 0x8ce3;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT4_WEBGL = 0x8ce4;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT5_WEBGL = 0x8ce5;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT6_WEBGL = 0x8ce6;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT7_WEBGL = 0x8ce7;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT8_WEBGL = 0x8ce8;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT9_WEBGL = 0x8ce9;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT10_WEBGL = 0x8cea;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT11_WEBGL = 0x8ceb;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT12_WEBGL = 0x8cec;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT13_WEBGL = 0x8ced;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT14_WEBGL = 0x8cee;
/**
 * Framebuffer color attachment point
 */
export const COLOR_ATTACHMENT15_WEBGL = 0x8cef;
/**
 * Draw buffer
 */
export const DRAW_BUFFER0_WEBGL = 0x8825;
/**
 * Draw buffer
 */
export const DRAW_BUFFER1_WEBGL = 0x8826;
/**
 * Draw buffer
 */
export const DRAW_BUFFER2_WEBGL = 0x8827;
/**
 * Draw buffer
 */
export const DRAW_BUFFER3_WEBGL = 0x8828;
/**
 * Draw buffer
 */
export const DRAW_BUFFER4_WEBGL = 0x8829;
/**
 * Draw buffer
 */
export const DRAW_BUFFER5_WEBGL = 0x882a;
/**
 * Draw buffer
 */
export const DRAW_BUFFER6_WEBGL = 0x882b;
/**
 * Draw buffer
 */
export const DRAW_BUFFER7_WEBGL = 0x882c;
/**
 * Draw buffer
 */
export const DRAW_BUFFER8_WEBGL = 0x882d;
/**
 * Draw buffer
 */
export const DRAW_BUFFER9_WEBGL = 0x882e;
/**
 * Draw buffer
 */
export const DRAW_BUFFER10_WEBGL = 0x882f;
/**
 * Draw buffer
 */
export const DRAW_BUFFER11_WEBGL = 0x8830;
/**
 * Draw buffer
 */
export const DRAW_BUFFER12_WEBGL = 0x8831;
/**
 * Draw buffer
 */
export const DRAW_BUFFER13_WEBGL = 0x8832;
/**
 * Draw buffer
 */
export const DRAW_BUFFER14_WEBGL = 0x8833;
/**
 * Draw buffer
 */
export const DRAW_BUFFER15_WEBGL = 0x8834;
/**
 * Maximum number of framebuffer color attachment points
 */
export const MAX_COLOR_ATTACHMENTS_WEBGL = 0x8cdf;
/**
 * Maximum number of draw buffers
 */
export const MAX_DRAW_BUFFERS_WEBGL = 0x8824;
/**
 * The bound vertex array object (VAO).
 */
export const VERTEX_ARRAY_BINDING_OES = 0x85b5;
/**
 * The number of bits used to hold the query result for the given target.
 */
export const QUERY_COUNTER_BITS_EXT = 0x8864;
/**
 * The currently active query.
 */
export const CURRENT_QUERY_EXT = 0x8865;
/**
 * The query result.
 */
export const QUERY_RESULT_EXT = 0x8866;
/**
 * A Boolean indicating whether or not a query result is available.
 */
export const QUERY_RESULT_AVAILABLE_EXT = 0x8867;
/**
 * Elapsed time (in nanoseconds).
 */
export const TIME_ELAPSED_EXT = 0x88bf;
/**
 * The current time.
 */
export const TIMESTAMP_EXT = 0x8e28;
/**
 * A Boolean indicating whether or not the GPU performed any disjoint operation.
 */
export const GPU_DISJOINT_EXT = 0x8fbb;
