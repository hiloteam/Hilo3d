import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const VS = '#version 300 es\nin vec3 position; void main(){gl_Position=vec4(position,1.0);}';
const FS = '#version 300 es\nprecision highp float; out vec4 color; void main(){color=vec4(1.0);}';

describe('ShaderMaterial', () => {
    it('stores immutable source and state in its definition', () => {
        const material = new Hilo3d.ShaderMaterial({
            vs: VS,
            fs: FS,
            state: { cullMode: 'none', depthTest: false }
        });
        const pass = material.definition.getPass('forward');

        expect(material.isShaderMaterial).toBe(true);
        expect(pass?.shader).toMatchObject({
            kind: 'glsl',
            vertexSource: VS,
            fragmentSource: FS
        });
        expect(pass?.state).toMatchObject({ cullMode: 'none', depthTest: false });
    });

    it('publishes typed static defines without a compile callback', () => {
        const material = new Hilo3d.ShaderMaterial({
            vs: VS,
            fs: FS,
            defines: { TEST: 1 }
        });

        expect(material.getRenderOption({ INIT: 1 })).toMatchObject({
            INIT: 1,
            HILO_CUSTOM_OPTION_TEST: 1
        });
    });
});
