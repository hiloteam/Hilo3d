import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const Program = Hilo3d.Program;
const vertexShader = 'void main(){gl_Position=vec4(0.0, 0.0, 0.0, 1.0);}';
const fragmentShader = 'precision mediump float;void main(){gl_FragColor=vec4(1.0);}';

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
                'precision mediump float;uniform sampler2D maps[1];void main(){gl_FragColor=texture2D(maps[0],vec2(0.0));}'
        });

        expect(() => {
            program.setUniform('maps', new Int32Array([0]));
        }).not.toThrow();
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
                    'varying vec3 mismatch;void main(){mismatch=vec3(1.0);gl_Position=vec4(0.0,0.0,0.0,1.0);}',
                fragShader:
                    'precision mediump float;varying vec4 mismatch;void main(){gl_FragColor=mismatch;}'
            });
        }).toThrow(Hilo3d.ProgramLinkError);
    });
});
