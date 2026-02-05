// modified from https://github.com/06wj/gl-extensions-constants/blob/master/index.js

/**
 * Describes the frequency divisor used for instanced rendering.
 * @memberOf constants
 * @type {GLenum}
 */
export const VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE = 0x88FE;
/**
 * Passed to getParameter to get the vendor string of the graphics driver.
 * @memberOf constants
 * @type {GLenum}
 */
export const UNMASKED_VENDOR_WEBGL = 0x9245;
/**
 * Passed to getParameter to get the renderer string of the graphics driver.
 * @memberOf constants
 * @type {GLenum}
 */
export const UNMASKED_RENDERER_WEBGL = 0x9246;
/**
 * Returns the maximum available anisotropy.
 * @memberOf constants
 * @type {GLenum}
 */
export const MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84FF;
/**
 * Passed to texParameter to set the desired maximum anisotropy for a texture.
 * @memberOf constants
 * @type {GLenum}
 */
export const TEXTURE_MAX_ANISOTROPY_EXT = 0x84FE;
/**
 * A DXT1-compressed image in an RGB image format.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGB_S3TC_DXT1_EXT = 0x83F0;
/**
 * A DXT1-compressed image in an RGB image format with a simple on/off alpha value.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGBA_S3TC_DXT1_EXT = 0x83F1;
/**
 * A DXT3-compressed image in an RGBA image format. Compared to a 32-bit RGBA texture, it offers 4:1 compression.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGBA_S3TC_DXT3_EXT = 0x83F2;
/**
 * A DXT5-compressed image in an RGBA image format. It also provides a 4:1 compression, but differs to the DXT3 compression in how the alpha compression is done.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGBA_S3TC_DXT5_EXT = 0x83F3;
/**
 * One-channel (red) unsigned format compression.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_R11_EAC = 0x9270;
/**
 * One-channel (red) signed format compression.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_SIGNED_R11_EAC = 0x9271;
/**
 * Two-channel (red and green) unsigned format compression.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RG11_EAC = 0x9272;
/**
 * Two-channel (red and green) signed format compression.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_SIGNED_RG11_EAC = 0x9273;
/**
 * Compresses RBG8 data with no alpha channel.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGB8_ETC2 = 0x9274;
/**
 * Compresses RGBA8 data. The RGB part is encoded the same as RGB_ETC2, but the alpha part is encoded separately.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGBA8_ETC2_EAC = 0x9275;
/**
 * Compresses sRBG8 data with no alpha channel.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_SRGB8_ETC2 = 0x9276;
/**
 * Compresses sRGBA8 data. The sRGB part is encoded the same as SRGB_ETC2, but the alpha part is encoded separately.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_SRGB8_ALPHA8_ETC2_EAC = 0x9277;
/**
 * Similar to RGB8_ETC, but with ability to punch through the alpha channel, which means to make it completely opaque or transparent.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2 = 0x9278;
/**
 * Similar to SRGB8_ETC, but with ability to punch through the alpha channel, which means to make it completely opaque or transparent.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2 = 0x9279;
/**
 * RGB compression in 4-bit mode. One block for each 4×4 pixels.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGB_PVRTC_4BPPV1_IMG = 0x8C00;
/**
 * RGBA compression in 4-bit mode. One block for each 4×4 pixels.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGBA_PVRTC_4BPPV1_IMG = 0x8C02;
/**
 * RGB compression in 2-bit mode. One block for each 8×4 pixels.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGB_PVRTC_2BPPV1_IMG = 0x8C01;
/**
 * RGBA compression in 2-bit mode. One block for each 8×4 pixe
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGBA_PVRTC_2BPPV1_IMG = 0x8C03;
/**
 * Compresses 24-bit RGB data with no alpha channel.
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGB_ETC1_WEBGL = 0x8D64;
export const /**
 *
 * @memberOf constants
 * @type {GLenum}
 */
    _WEBGL = 0x8C92; //  Compresses RGB textures with no alpha channel.
/**
 * Compresses RGBA textures using explicit alpha encoding (useful when alpha transitions are sharp).
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL = 0x8C92;
/**
 * Compresses RGBA textures using interpolated alpha encoding (useful when alpha transitions are gradient).
 * @memberOf constants
 * @type {GLenum}
 */
export const COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL = 0x87EE;
/**
 * Unsigned integer type for 24-bit depth texture data.
 * @memberOf constants
 * @type {GLenum}
 */
export const UNSIGNED_INT_24_8_WEBGL = 0x84FA;
/**
 * Half floating-point type (16-bit).
 * @memberOf constants
 * @type {GLenum}
 */
export const HALF_FLOAT_OES = 0x8D61;
/**
 * RGBA 32-bit floating-point color-renderable format.
 * @memberOf constants
 * @type {GLenum}
 */
export const RGBA32F_EXT = 0x8814;
/**
 * RGB 32-bit floating-point color-renderable format.
 * @memberOf constants
 * @type {GLenum}
 */
export const RGB32F_EXT = 0x8815;
/**
 * Returns the type of the color-renderable format of the attachment.
 * @memberOf constants
 * @type {GLenum}
 */
export const FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT = 0x8211;
/**
 * Unsigned normalized integer type.
 * @memberOf constants
 * @type {GLenum}
 */
export const UNSIGNED_NORMALIZED_EXT = 0x8C17;
/**
 * Produces the minimum color components of the source and destination colors.
 * @memberOf constants
 * @type {GLenum}
 */
export const MIN_EXT = 0x8007;
/**
 * Produces the maximum color components of the source and destination colors.
 * @memberOf constants
 * @type {GLenum}
 */
export const MAX_EXT = 0x8008;
/**
 * Unsized sRGB format that leaves the precision up to the driver.
 * @memberOf constants
 * @type {GLenum}
 */
export const SRGB_EXT = 0x8C40;
/**
 * Unsized sRGB format with unsized alpha component.
 * @memberOf constants
 * @type {GLenum}
 */
export const SRGB_ALPHA_EXT = 0x8C42;
/**
 * Sized (8-bit) sRGB and alpha formats.
 * @memberOf constants
 * @type {GLenum}
 */
export const SRGB8_ALPHA8_EXT = 0x8C43;
/**
 * Returns the framebuffer color encoding.
 * @memberOf constants
 * @type {GLenum}
 */
export const FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING_EXT = 0x8210;
/**
 * Indicates the accuracy of the derivative calculation for the GLSL built-in functions: dFdx, dFdy, and fwidth.
 * @memberOf constants
 * @type {GLenum}
 */
export const FRAGMENT_SHADER_DERIVATIVE_HINT_OES = 0x8B8B;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT0_WEBGL = 0x8CE0;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT1_WEBGL = 0x8CE1;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT2_WEBGL = 0x8CE2;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT3_WEBGL = 0x8CE3;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT4_WEBGL = 0x8CE4;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT5_WEBGL = 0x8CE5;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT6_WEBGL = 0x8CE6;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT7_WEBGL = 0x8CE7;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT8_WEBGL = 0x8CE8;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT9_WEBGL = 0x8CE9;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT10_WEBGL = 0x8CEA;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT11_WEBGL = 0x8CEB;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT12_WEBGL = 0x8CEC;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT13_WEBGL = 0x8CED;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT14_WEBGL = 0x8CEE;
/**
 * Framebuffer color attachment point
 * @memberOf constants
 * @type {GLenum}
 */
export const COLOR_ATTACHMENT15_WEBGL = 0x8CEF;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER0_WEBGL = 0x8825;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER1_WEBGL = 0x8826;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER2_WEBGL = 0x8827;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER3_WEBGL = 0x8828;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER4_WEBGL = 0x8829;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER5_WEBGL = 0x882A;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER6_WEBGL = 0x882B;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER7_WEBGL = 0x882C;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER8_WEBGL = 0x882D;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER9_WEBGL = 0x882E;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER10_WEBGL = 0x882F;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER11_WEBGL = 0x8830;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER12_WEBGL = 0x8831;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER13_WEBGL = 0x8832;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER14_WEBGL = 0x8833;
/**
 * Draw buffer
 * @memberOf constants
 * @type {GLenum}
 */
export const DRAW_BUFFER15_WEBGL = 0x8834;
/**
 * Maximum number of framebuffer color attachment points
 * @memberOf constants
 * @type {GLenum}
 */
export const MAX_COLOR_ATTACHMENTS_WEBGL = 0x8CDF;
/**
 * Maximum number of draw buffers
 * @memberOf constants
 * @type {GLenum}
 */
export const MAX_DRAW_BUFFERS_WEBGL = 0x8824;
/**
 * The bound vertex array object (VAO).
 * @memberOf constants
 * @type {GLenum}
 */
export const VERTEX_ARRAY_BINDING_OES = 0x85B5;
/**
 * The number of bits used to hold the query result for the given target.
 * @memberOf constants
 * @type {GLenum}
 */
export const QUERY_COUNTER_BITS_EXT = 0x8864;
/**
 * The currently active query.
 * @memberOf constants
 * @type {GLenum}
 */
export const CURRENT_QUERY_EXT = 0x8865;
/**
 * The query result.
 * @memberOf constants
 * @type {GLenum}
 */
export const QUERY_RESULT_EXT = 0x8866;
/**
 * A Boolean indicating whether or not a query result is available.
 * @memberOf constants
 * @type {GLenum}
 */
export const QUERY_RESULT_AVAILABLE_EXT = 0x8867;
/**
 * Elapsed time (in nanoseconds).
 * @memberOf constants
 * @type {GLenum}
 */
export const TIME_ELAPSED_EXT = 0x88BF;
/**
 * The current time.
 * @memberOf constants
 * @type {GLenum}
 */
export const TIMESTAMP_EXT = 0x8E28;
/**
 * A Boolean indicating whether or not the GPU performed any disjoint operation.
 * @memberOf constants
 * @type {GLenum}
 */
export const GPU_DISJOINT_EXT = 0x8FBB;
