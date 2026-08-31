import ShaderMaterial, { type ShaderMaterialParameters } from '../material/ShaderMaterial';
import type Material from '../material/MaterialInstance';
import Texture from '../texture/Texture';
import { MaterialAttributeSemantic } from '../material/MaterialSemantics';

const materialsByTexture = new WeakMap<Texture, SpriteMaterial>();

const SPRITE_VERTEX_SHADER = `
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
};

#ifdef HILO_WEBGPU
layout(std140) uniform InstanceBlock {
    mat4 u_instanceModelMatrices[128];
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
    // and SpriteFrame's negative-height rectangles both resolve in that convention on WebGL2.
    // WebGPU samples from a top-left texture origin, so every Sprite frame crosses this one
    // backend-native normalization boundary regardless of the texture's authored flipY policy.
    v_texcoord.y = 1.0 - v_texcoord.y;
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

interface RenderSpriteMesh {
    readonly isSprite: boolean;
    readonly spriteUVRect: Float32Array;
    readonly spriteSizeAnchor: Float32Array;
    readonly spriteTint: ArrayLike<number>;
}

function readMeshProperty(mesh: object, key: PropertyKey): unknown {
    return Reflect.get(mesh, key);
}

function requireSprite(mesh: object): RenderSpriteMesh {
    const uv = readMeshProperty(mesh, 'spriteUVRect');
    const size = readMeshProperty(mesh, 'spriteSizeAnchor');
    const tint = readMeshProperty(mesh, 'spriteTint');
    if (
        readMeshProperty(mesh, 'isSprite') !== true ||
        !(uv instanceof Float32Array) ||
        !(size instanceof Float32Array) ||
        (typeof tint !== 'object' && typeof tint !== 'function') ||
        tint === null
    ) {
        throw new TypeError('SpriteMaterial requires an extracted sprite render record.');
    }
    return {
        isSprite: true,
        spriteUVRect: uv,
        spriteSizeAnchor: size,
        spriteTint: tint as ArrayLike<number>
    };
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
            sourceRevision: 'Hilo3d.SpriteMaterial:2',
            compositing: {
                mode: 'alpha-blend',
                premultiplied: texture.premultiplyAlpha
            },
            state: {
                depthTest: false,
                depthWrite: false,
                cullMode: 'none'
            },
            attributes: {
                a_position: MaterialAttributeSemantic.POSITION,
                a_texcoord0: MaterialAttributeSemantic.TEXCOORD_0
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
