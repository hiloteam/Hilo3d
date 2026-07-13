import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const Program = Hilo3d.Program;
const vertexShader = '#version 300 es\nvoid main(){gl_Position=vec4(0.0, 0.0, 0.0, 1.0);}';
const fragmentShader =
    '#version 300 es\nprecision mediump float;out vec4 fragColor;void main(){fragColor=vec4(1.0);}';

describe('Program', () => {
    it('create', () => {
        const program = new Program({
            state: testEnv.state,
            vertexShader,
            fragShader: fragmentShader
        });
        expect(program.isProgram).toBe(true);
        expect(program.className).toBe('Program');
    });

    it('getProgram & cache & destroy', () => {
        const shader = new Hilo3d.Shader({ vs: vertexShader, fs: fragmentShader });
        const program = Program.getProgram(shader, testEnv.state);
        expect(Program.cache.get(shader.id)).toBe(program);

        expect(program.destroy()).toBe(program);
        expect(Program.cache.get(shader.id)).toBeUndefined();
        expect(program.program).toBeNull();
        expect(program.uniforms).toEqual({});
        expect(program.attributes).toEqual({});
        expect(program.uniformBlocks).toEqual({});
        expect(program.destroy()).toBe(program);
    });

    it('getBlankProgram', () => {
        const blankProgram = Program.getBlankProgram(testEnv.state);
        expect(blankProgram.isProgram).toBe(true);
        expect(blankProgram.program).not.toBeNull();
        expect(Program.getBlankProgram(testEnv.state)).toBe(blankProgram);
    });

    it('accepts numeric array data for a one-element sampler array', () => {
        const program = new Program({
            state: testEnv.state,
            vertexShader,
            fragShader:
                '#version 300 es\nprecision mediump float;uniform sampler2D maps[1];out vec4 fragColor;void main(){fragColor=texture(maps[0],vec2(0.0));}'
        });

        expect(() => {
            program.setUniform('maps', new Int32Array([0]));
        }).not.toThrow();
    });

    it('supports every WebGL2 sampler through classic uniform binding', () => {
        const program = new Program({
            state: testEnv.state,
            vertexShader,
            fragShader:
                '#version 300 es\nprecision highp float;uniform highp sampler3D volume;out vec4 fragColor;void main(){fragColor=texture(volume,vec3(0.0));}'
        });

        expect(program.uniforms['volume']?.textureIndex).toBe(0);
        expect(() => {
            program.setUniform('volume', 0);
        }).not.toThrow();
    });

    it('rejects active non-sampler classic uniforms', () => {
        expect(() => {
            new Program({
                state: testEnv.state,
                vertexShader:
                    '#version 300 es\nuniform float scale;void main(){gl_Position=vec4(scale,0.0,0.0,1.0);}',
                fragShader: fragmentShader
            });
        }).toThrow(/place non-texture data in a std140 uniform block/);
    });

    it('reflects and binds built-in uniform blocks at their fixed ABI point', () => {
        const program = new Program({
            state: testEnv.state,
            vertexShader:
                '#version 300 es\nlayout(std140) uniform CameraBlock {mat4 u_viewMatrix;mat4 u_projectionMatrix;mat4 u_viewProjectionMatrix;mat4 u_viewInverseMatrix;mat4 u_projectionInverseMatrix;mat3 u_viewInverseNormalMatrix;vec4 u_cameraPositionNear;vec4 u_cameraParams;};void main(){gl_Position=u_projectionMatrix*vec4(0.0,0.0,0.0,1.0);}',
            fragShader: fragmentShader
        });
        const block = program.uniformBlocks['CameraBlock'];
        const buffer = new Hilo3d.UniformBuffer(new Float32Array(100));

        expect(block).toMatchObject({ name: 'CameraBlock', bindingPoint: 1, byteLength: 400 });
        expect(block?.activeUniformIndices.length).toBeGreaterThan(0);
        expect(block?.uniformNames).toContain('u_projectionMatrix');
        expect(() => {
            program.setUniformBlock('CameraBlock', buffer);
        }).not.toThrow();
        buffer.destroy();
    });

    it('rejects a built-in block whose GLSL layout diverges from the canonical ABI', () => {
        expect(() => {
            new Program({
                state: testEnv.state,
                vertexShader:
                    '#version 300 es\nlayout(std140) uniform CameraBlock {mat4 projection;};void main(){gl_Position=projection*vec4(0.0,0.0,0.0,1.0);}',
                fragShader: fragmentShader
            });
        }).toThrow(/canonical ABI requires 400/);
    });

    it('throws the public ShaderCompilationError for invalid GLSL', () => {
        expect(() => {
            new Program({
                state: testEnv.state,
                vertexShader: 'this is not valid GLSL',
                fragShader: fragmentShader
            });
        }).toThrow(Hilo3d.ShaderCompilationError);
    });

    it('throws the public ProgramLinkError for incompatible shader stages', () => {
        expect(() => {
            new Program({
                state: testEnv.state,
                vertexShader:
                    '#version 300 es\nout vec3 mismatch;void main(){mismatch=vec3(1.0);gl_Position=vec4(0.0,0.0,0.0,1.0);}',
                fragShader:
                    '#version 300 es\nprecision mediump float;in vec4 mismatch;out vec4 fragColor;void main(){fragColor=mismatch;}'
            });
        }).toThrow(Hilo3d.ProgramLinkError);
    });
});
