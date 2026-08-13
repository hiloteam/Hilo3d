import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { RGBA, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';

describe('modern material model', () => {
    it('separates immutable definition structure from mutable instance data', () => {
        const material = new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            compositing: { mode: 'alpha-blend', premultiplied: true }
        });

        expect(material.isMaterialInstance).toBe(true);
        expect(Object.isFrozen(material.definition)).toBe(true);
        expect(material.definition.getPass('forward')?.state.cullMode).toBe('back');
        expect(material.isTransparent).toBe(true);
        expect(material.revision).toBe(0);

        material.opacity = 0.5;
        expect(material.revision).toBe(1);
        material.opacity = 0.5;
        expect(material.revision).toBe(1);
    });

    it('keeps coverage independent from compositing', () => {
        const material = new Hilo3d.BasicMaterial({
            coverage: { mode: 'mask', cutoff: 0.4 },
            compositing: { mode: 'opaque' }
        });

        expect(material.coverage).toEqual({ mode: 'mask', cutoff: 0.4 });
        expect(material.isTransparent).toBe(false);
        expect(material.getRenderOption()['ALPHA_CUTOFF']).toBe(1);
    });

    it('validates authored temporal reactivity as mutable material data', () => {
        const material = new Hilo3d.PBRMaterial({ temporalReactiveFactor: 0.75 });

        expect(material.temporalReactiveFactor).toBe(0.75);
        const revision = material.revision;
        material.temporalReactiveFactor = 0.25;
        expect(material.revision).toBe(revision + 1);
        expect(() => {
            material.temporalReactiveFactor = 1.01;
        }).toThrow(/temporal reactive factor/u);
    });

    it('makes straight and premultiplied additive compositing explicit', () => {
        const straight = new Hilo3d.BasicMaterial({
            compositing: { mode: 'additive', premultiplied: false }
        });
        const premultiplied = new Hilo3d.BasicMaterial({
            compositing: { mode: 'additive', premultiplied: true }
        });

        expect(Hilo3d.resolveMaterialPassState(straight, 'forward')?.blend).toBe(
            Hilo3d.MaterialBlendPreset.STRAIGHT_ALPHA_ADDITIVE
        );
        expect(Hilo3d.resolveMaterialPassState(premultiplied, 'forward')?.blend).toBe(
            Hilo3d.MaterialBlendPreset.PREMULTIPLIED_ADDITIVE
        );
        expect(straight.definition).not.toBe(premultiplied.definition);
    });

    it('publishes per-slot texture semantics and dirty revisions', () => {
        const first = new Hilo3d.Texture({ uv: 1 });
        const material = new Hilo3d.BasicMaterial({
            diffuse: { texture: first, uvSet: 1, encoding: 'srgb' }
        });
        const initialRevision = material.revision;
        const second = new Hilo3d.Texture({ uv: 1 });

        material.setTextureSlot('diffuse', {
            texture: second,
            uvSet: 1,
            encoding: 'linear'
        });

        expect(material.getTextureSlot('diffuse')).toMatchObject({
            texture: second,
            uvSet: 1,
            encoding: 'linear'
        });
        expect(material.getDirtyTextureSlots()).toContain(
            material.definition.getTextureSlot('diffuse')?.index
        );
        expect(material.revision).toBe(initialRevision + 1);
    });

    it('declares the fallback sampler texture as explicit RGBA8 byte data', () => {
        const texture = Hilo3d.semantic.getBlankTexture();

        expect(texture.internalFormat).toBe(RGBA8);
        expect(texture.format).toBe(RGBA);
        expect(texture.type).toBe(UNSIGNED_BYTE);
        expect(texture.image).toBeInstanceOf(Uint8Array);
    });

    it('exports typed semantic and texture-slot constants instead of magic identifiers', () => {
        expect(Hilo3d.MaterialAttributeSemantic.POSITION).toBe('POSITION');
        expect(Hilo3d.MaterialUniformSemantic.MODEL).toBe('MODEL');
        expect(Hilo3d.MaterialTextureSemantic.BASE_COLOR_MAP).toBe('BASECOLORMAP');
        expect(Hilo3d.MaterialTextureSlot.NORMAL).toBe(0);
        expect(Object.isFrozen(Hilo3d.MaterialAttributeSemantic)).toBe(true);
        expect(Object.isFrozen(Hilo3d.MaterialUniformSemantic)).toBe(true);
        expect(Object.isFrozen(Hilo3d.MaterialTextureSemantic)).toBe(true);
        expect(Object.isFrozen(Hilo3d.MaterialTextureSlot)).toBe(true);
    });

    it('declares the implemented built-in semantic passes', () => {
        const material = new Hilo3d.BasicMaterial();

        expect(material.definition.getPass('forward')).not.toBeNull();
        expect(material.definition.getPass('depth-only')).not.toBeNull();
        expect(material.definition.getPass('shadow-caster')).not.toBeNull();
        expect(material.definition.getPass('picking')).not.toBeNull();
        expect(material.definition.getPass('motion-vector')).toMatchObject({
            fragmentOutput: 'motion-vector',
            state: {
                depthCompare: 'equal',
                depthWrite: false
            }
        });
        expect(material.definition.getPass('material-attributes')).toMatchObject({
            fragmentOutput: 'material-attributes',
            state: {
                depthCompare: 'equal',
                depthWrite: false
            }
        });
    });

    it('enforces the material-attributes target ABI before RHI frame creation', () => {
        const material = new Hilo3d.PBRMaterial();
        const compiler = new Hilo3d.MaterialCompiler();
        const request = {
            instance: material,
            role: 'material-attributes' as const,
            vertexLayoutClass: 'static-mesh',
            renderingProfile: 'portable' as const,
            backend: 'webgpu' as const
        };

        expect(
            compiler.compile({
                ...request,
                target: {
                    colorFormats: ['rgba16float'],
                    depthStencilFormat: 'depth32float',
                    sampleCount: 1
                }
            })
        ).not.toBeNull();
        expect(() =>
            compiler.compile({
                ...request,
                target: {
                    colorFormats: ['rgba8unorm'],
                    depthStencilFormat: 'depth32float',
                    sampleCount: 1
                }
            })
        ).toThrow(/Material attributes role requires one single-sample rgba16float/u);
    });

    it('accepts the optional authored reactive target for motion vectors', () => {
        const material = new Hilo3d.PBRMaterial();
        const compiler = new Hilo3d.MaterialCompiler();
        const request = {
            instance: material,
            role: 'motion-vector' as const,
            vertexLayoutClass: 'static-mesh',
            renderingProfile: 'portable' as const,
            backend: 'webgpu' as const
        };

        expect(
            compiler.compile({
                ...request,
                target: {
                    colorFormats: ['rgba16float', 'r8unorm'],
                    depthStencilFormat: 'depth32float',
                    sampleCount: 1
                }
            })
        ).not.toBeNull();
        expect(() =>
            compiler.compile({
                ...request,
                target: {
                    colorFormats: ['rgba16float', 'rgba8unorm'],
                    depthStencilFormat: 'depth32float',
                    sampleCount: 1
                }
            })
        ).toThrow(/optional r8unorm reactive/u);
    });
});
