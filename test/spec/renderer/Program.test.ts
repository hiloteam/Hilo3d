import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import Program, {
    ProgramLinkError,
    ShaderCompilationError
} from '../../../src/render/internal/webgl2/Program';
import VertexArrayObject from '../../../src/render/internal/webgl2/VertexArrayObject';
import WebGL2Driver from '../../../src/render/internal/webgl2/WebGL2Driver';
import { cameraBlockLayout } from '../../../src/render/ubo/BuiltInUniformBlocks';
import { releaseWebGLUniformBuffer } from '../../../src/render/internal/webgl2/WebGLState';
import { testEnv } from '../../setup';

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
        expect(Program.getCache(testEnv.gl).get(shader.id)).toBe(program);

        expect(program.destroy()).toBe(program);
        expect(Program.getCache(testEnv.gl).get(shader.id)).toBeUndefined();
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
                '#version 300 es\nlayout(std140) uniform CameraBlock {mat4 u_viewMatrix;mat4 u_projectionMatrix;mat4 u_viewProjectionMatrix;mat4 u_viewInverseMatrix;mat4 u_projectionInverseMatrix;mat3 u_viewInverseNormalMatrix;vec4 u_cameraPositionNear;vec4 u_cameraParams;vec4 u_viewport;};void main(){gl_Position=u_projectionMatrix*vec4(0.0,0.0,0.0,1.0);}',
            fragShader: fragmentShader
        });
        const block = program.uniformBlocks['CameraBlock'];
        const buffer = new Hilo3d.UniformBuffer(cameraBlockLayout);

        expect(block).toMatchObject({ name: 'CameraBlock', bindingPoint: 1, byteLength: 416 });
        expect(block?.activeUniformIndices.length).toBeGreaterThan(0);
        expect(block?.uniformNames).toContain('u_projectionMatrix');
        expect(() => {
            program.setUniformBlock('CameraBlock', buffer);
        }).not.toThrow();
        releaseWebGLUniformBuffer(testEnv.state, buffer);
    });

    it('accepts driver reflection that removes an inactive canonical block tail', () => {
        const nativeQuery = testEnv.gl.getActiveUniformBlockParameter.bind(testEnv.gl);
        const reflection = vi
            .spyOn(testEnv.gl, 'getActiveUniformBlockParameter')
            .mockImplementation((program, blockIndex, parameter): unknown => {
                const value: unknown = nativeQuery(program, blockIndex, parameter);
                return parameter === testEnv.gl.UNIFORM_BLOCK_DATA_SIZE && value === 416
                    ? 400
                    : value;
            });

        try {
            const program = new Program({
                state: testEnv.state,
                vertexShader:
                    '#version 300 es\nlayout(std140) uniform CameraBlock {mat4 u_viewMatrix;mat4 u_projectionMatrix;mat4 u_viewProjectionMatrix;mat4 u_viewInverseMatrix;mat4 u_projectionInverseMatrix;mat3 u_viewInverseNormalMatrix;vec4 u_cameraPositionNear;vec4 u_cameraParams;vec4 u_viewport;};void main(){gl_Position=u_projectionMatrix*vec4(0.0,0.0,0.0,1.0);}',
                fragShader: fragmentShader
            });

            expect(program.uniformBlocks['CameraBlock']?.byteLength).toBe(416);
        } finally {
            reflection.mockRestore();
        }
    });

    it('rejects a built-in block whose GLSL layout diverges from the canonical ABI', () => {
        expect(() => {
            new Program({
                state: testEnv.state,
                vertexShader:
                    '#version 300 es\nlayout(std140) uniform CameraBlock {mat4 projection;};void main(){gl_Position=projection*vec4(0.0,0.0,0.0,1.0);}',
                fragShader: fragmentShader
            });
        }).toThrow(/outside the canonical WebGL2 ABI/);
    });

    it('throws the public ShaderCompilationError for invalid GLSL', () => {
        expect(() => {
            new Program({
                state: testEnv.state,
                vertexShader: 'this is not valid GLSL',
                fragShader: fragmentShader
            });
        }).toThrow(ShaderCompilationError);
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
        }).toThrow(ProgramLinkError);
    });

    it('uses pure integer pointers for reflected ivec and uvec inputs', () => {
        const renderer = new WebGL2Driver({
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false
        });
        renderer.initContext();
        const gl = renderer.gl;
        expect(gl.getError()).toBe(gl.NO_ERROR);

        const program = new Program({
            state: renderer.state,
            vertexShader: `#version 300 es
                in ivec2 signedValue;
                in uvec2 unsignedValue;
                in vec2 floatValue;
                in mat2 matrixValue;
                in mat3 matrix3Value;
                in mat4 matrix4Value;
                void main() {
                    float combined = float(signedValue.x + signedValue.y) +
                        float(unsignedValue.x + unsignedValue.y) +
                        dot(floatValue, vec2(1.0)) + matrixValue[0][0] + matrixValue[1][1] +
                        matrix3Value[0][0] + matrix3Value[1][1] + matrix3Value[2][2] +
                        matrix4Value[0][0] + matrix4Value[1][1] + matrix4Value[2][2] + matrix4Value[3][3];
                    gl_Position = vec4(combined * 0.000001, 0.0, 0.0, 1.0);
                }`,
            fragShader: fragmentShader
        });
        const vao = new VertexArrayObject(gl, '_hiloIntegerAttributePointers', {
            mode: gl.POINTS
        });

        try {
            const signedAttribute = program.attributes['signedValue'];
            const unsignedAttribute = program.attributes['unsignedValue'];
            const floatAttribute = program.attributes['floatValue'];
            const matrixAttribute = program.attributes['matrixValue'];
            const matrix3Attribute = program.attributes['matrix3Value'];
            const matrix4Attribute = program.attributes['matrix4Value'];
            expect(signedAttribute).toBeDefined();
            expect(unsignedAttribute).toBeDefined();
            expect(floatAttribute).toBeDefined();
            expect(matrixAttribute).toBeDefined();
            if (
                !signedAttribute ||
                !unsignedAttribute ||
                !floatAttribute ||
                !matrixAttribute ||
                !matrix3Attribute ||
                !matrix4Attribute
            ) {
                throw new Error('Expected every test vertex attribute to remain active');
            }

            vao.addAttribute(
                new Hilo3d.GeometryData(new Int32Array([1, 2]), 2),
                signedAttribute,
                gl.STATIC_DRAW
            );
            vao.addAttribute(
                new Hilo3d.GeometryData(new Uint32Array([3, 4]), 2),
                unsignedAttribute,
                gl.STATIC_DRAW
            );
            vao.addAttribute(
                new Hilo3d.GeometryData(new Float32Array([0.25, 0.5]), 2),
                floatAttribute,
                gl.STATIC_DRAW
            );
            vao.addAttribute(
                new Hilo3d.GeometryData(new Float32Array([1, 0, 0, 1]), 4),
                matrixAttribute,
                gl.STATIC_DRAW
            );
            vao.addAttribute(
                new Hilo3d.GeometryData(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 9),
                matrix3Attribute,
                gl.STATIC_DRAW
            );
            vao.addAttribute(
                new Hilo3d.GeometryData(
                    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
                    16
                ),
                matrix4Attribute,
                gl.STATIC_DRAW
            );

            expect(
                gl.getVertexAttrib(signedAttribute.location, gl.VERTEX_ATTRIB_ARRAY_INTEGER)
            ).toBe(true);
            expect(
                gl.getVertexAttrib(unsignedAttribute.location, gl.VERTEX_ATTRIB_ARRAY_INTEGER)
            ).toBe(true);
            expect(
                gl.getVertexAttrib(floatAttribute.location, gl.VERTEX_ATTRIB_ARRAY_INTEGER)
            ).toBe(false);
            expect(
                gl.getVertexAttrib(matrixAttribute.location, gl.VERTEX_ATTRIB_ARRAY_INTEGER)
            ).toBe(false);
            expect(
                gl.getVertexAttrib(matrix3Attribute.location + 2, gl.VERTEX_ATTRIB_ARRAY_INTEGER)
            ).toBe(false);
            expect(
                gl.getVertexAttrib(matrix4Attribute.location + 3, gl.VERTEX_ATTRIB_ARRAY_INTEGER)
            ).toBe(false);

            program.useProgram();
            vao.draw();
            expect(gl.getError()).toBe(gl.NO_ERROR);

            expect(() => {
                signedAttribute.pointer({ type: gl.UNSIGNED_INT, size: 2 });
            }).toThrow(/Signed integer vertex attribute/);
            expect(() => {
                unsignedAttribute.pointer({ type: gl.INT, size: 2 });
            }).toThrow(/Unsigned integer vertex attribute/);
            expect(() => {
                signedAttribute.pointer({ type: gl.INT, size: 2, normalized: true });
            }).toThrow(/cannot use normalized storage/);
            expect(() => {
                floatAttribute.pointer({ type: gl.INT, size: 2 });
            }).toThrow(/Converted vertex attribute/);
            expect(() => {
                floatAttribute.pointer({ type: gl.FLOAT, size: 2, normalized: true });
            }).toThrow(/can only normalize byte or short integer storage/);
            expect(gl.getError()).toBe(gl.NO_ERROR);
        } finally {
            vao.getResources().forEach(resource => resource.destroy());
            vao.destroy();
            program.destroy();
            renderer.destroy();
        }
    });
});
