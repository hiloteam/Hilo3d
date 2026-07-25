import ShaderMaterial, { type ShaderMaterialParameters } from '../material/ShaderMaterial';
import type Material from '../material/Material';
import Texture from '../texture/Texture';
import type Sprite from './Sprite';

const materialsByTexture = new WeakMap<Texture, SpriteMaterial>();

const SPRITE_VERTEX_SHADER = `
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
    mat4 u_viewInverseMatrix;
    mat4 u_projectionInverseMatrix;
    mat3 u_viewInverseNormalMatrix;
    vec4 u_cameraPositionNear;
    vec4 u_cameraParams;
    vec4 u_viewport;
};

#ifdef HILO_WEBGPU
layout(std140) uniform InstanceBlock {
    mat4 u_instanceModelMatrices[128];
    mat4 u_instanceNormalMatrices[128];
};
#define u_modelMatrix u_instanceModelMatrices[gl_InstanceIndex]
#else
in mat4 u_modelMatrix;
#endif

in vec3 a_position;
in vec2 a_texcoord0;
in vec4 i_uvRect;
in vec4 i_sizeAnchor;
in vec4 i_tint;

out vec2 v_texcoord;
out vec4 v_tint;

void main() {
    vec2 localPosition =
        (a_position.xy + vec2(0.5) - i_sizeAnchor.zw) * i_sizeAnchor.xy;
    gl_Position =
        u_viewProjectionMatrix * u_modelMatrix * vec4(localPosition, a_position.z, 1.0);
    v_texcoord = i_uvRect.xy + a_texcoord0 * i_uvRect.zw;
#ifdef HILO_WEBGPU
    // PlaneGeometry carries WebGL's bottom-left V convention. Texture uploads with flipY=true
    // retain that convention in WebGL2, while WebGPU samples from a top-left texture origin.
    // A negative frame height already represents a non-flipped, top-left source.
    if (i_uvRect.w > 0.0) {
        v_texcoord.y = 1.0 - v_texcoord.y;
    }
#endif
    v_tint = i_tint;
}
`;

const SPRITE_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_spriteTexture;
in vec2 v_texcoord;
in vec4 v_tint;
layout(location = 0) out vec4 outColor;

void main() {
    outColor = texture(u_spriteTexture, v_texcoord) * v_tint;
}
`;

function requireSprite(mesh: object): Sprite {
    if (Reflect.get(mesh, 'isSprite') !== true) {
        throw new TypeError('SpriteMaterial instance bindings require a Sprite.');
    }
    return mesh as Sprite;
}

function requireSpriteMaterial(material: Material): SpriteMaterial {
    if (!(material instanceof SpriteMaterial)) {
        throw new TypeError('Sprite sampler binding requires a SpriteMaterial.');
    }
    return material;
}

export interface SpriteMaterialParameters extends Omit<
    ShaderMaterialParameters,
    'attributes' | 'uniforms' | 'uniformBlocks' | 'vs' | 'fs' | 'needBasicAttributes'
> {
    texture: Texture;
}

/**
 * Portable atlas material used by Sprite batches.
 *
 * One instance stream carries UV rectangle, logical size/anchor, and tint. The existing shared
 * instance compiler supplies transforms as WebGL2 vertex attributes or the WebGPU InstanceBlock.
 */
class SpriteMaterial extends ShaderMaterial {
    readonly isSpriteMaterial = true;
    override readonly className = 'SpriteMaterial';
    texture: Texture;

    constructor(params: SpriteMaterialParameters) {
        if (!(params.texture instanceof Texture)) {
            throw new TypeError('SpriteMaterial.texture must be a Texture.');
        }
        const { texture, ...materialParameters } = params;
        super({
            ...materialParameters,
            shaderCacheId: materialParameters.shaderCacheId ?? 'Hilo3d.SpriteMaterial',
            needBasicAttributes: false,
            needBasicUniforms: false,
            lightType: 'NONE',
            transparent: true,
            depthTest: materialParameters.depthTest ?? false,
            depthMask: materialParameters.depthMask ?? false,
            cullFace: materialParameters.cullFace ?? false,
            premultiplyAlpha: materialParameters.premultiplyAlpha ?? texture.premultiplyAlpha,
            castShadows: false,
            receiveShadows: false,
            attributes: {
                a_position: 'POSITION',
                a_texcoord0: 'TEXCOORD_0'
            },
            uniforms: {
                u_modelMatrix: {
                    isDependMesh: true,
                    get(mesh) {
                        return mesh.worldMatrix;
                    }
                },
                u_spriteTexture: {
                    get(_mesh, material): Texture {
                        return requireSpriteMaterial(material).texture;
                    }
                },
                i_uvRect: {
                    isDependMesh: true,
                    get(mesh): Float32Array {
                        return requireSprite(mesh).spriteUVRect;
                    }
                },
                i_sizeAnchor: {
                    isDependMesh: true,
                    get(mesh): Float32Array {
                        return requireSprite(mesh).spriteSizeAnchor;
                    }
                },
                i_tint: {
                    isDependMesh: true,
                    get(mesh): ArrayLike<number> {
                        return requireSprite(mesh).spriteTint;
                    }
                }
            },
            vs: SPRITE_VERTEX_SHADER,
            fs: SPRITE_FRAGMENT_SHADER
        });
        this.texture = texture;
    }

    /**
     * Return the shared default material for a texture. Sharing this exact object is what lets the
     * renderer merge sprites into one instanced draw.
     */
    static forTexture(texture: Texture): SpriteMaterial {
        let material = materialsByTexture.get(texture);
        if (!material) {
            material = new SpriteMaterial({ texture });
            materialsByTexture.set(texture, material);
        }
        return material;
    }
}

export default SpriteMaterial;
