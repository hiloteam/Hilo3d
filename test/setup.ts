import { expect, type MatcherResult } from 'vitest';
import * as Hilo3d from '../src/Hilo3d';
import type WebGL2Driver from '../src/render/internal/webgl2/WebGL2Driver';
import type WebGLState from '../src/render/internal/webgl2/WebGLState';

const epsilon = 1e-7;

function readNumericValues(received: unknown): number[] | undefined {
    if (
        (!Array.isArray(received) && !ArrayBuffer.isView(received)) ||
        received instanceof DataView
    ) {
        return undefined;
    }

    const values = Array.from(received as ArrayLike<unknown>);
    return values.every((value): value is number => typeof value === 'number') ? values : undefined;
}

function toEqualishValues(received: unknown, ...expected: number[]): MatcherResult {
    const actual = readNumericValues(received);
    const pass =
        actual?.length === expected.length &&
        actual.every((value, index) => {
            const expectedValue = expected[index];
            return expectedValue !== undefined && Math.abs(value - expectedValue) < epsilon;
        });

    return {
        pass,
        actual: received,
        expected,
        message: () =>
            pass
                ? `expected ${JSON.stringify(actual)} not to approximately equal ${JSON.stringify(expected)}`
                : `expected ${JSON.stringify(actual)} to approximately equal ${JSON.stringify(expected)}`
    };
}

function toBeEqualish(received: unknown, expected: number): MatcherResult {
    const pass =
        typeof received === 'number' &&
        (Number.isNaN(received) && Number.isNaN(expected)
            ? true
            : Math.abs(received - expected) < epsilon);

    return {
        pass,
        actual: received,
        expected,
        message: () =>
            pass
                ? `expected ${String(received)} not to approximately equal ${String(expected)}`
                : `expected ${String(received)} to approximately equal ${String(expected)}`
    };
}

expect.extend({ toBeEqualish, toEqualishValues });

declare module 'vitest' {
    interface Assertion<T> {
        toBeEqualish(expected: number): T;
        toEqualishValues(...expected: number[]): T;
    }
}

export interface TestEnvironment {
    stage: Hilo3d.Stage;
    camera: Hilo3d.PerspectiveCamera;
    renderer: WebGL2Driver;
    gl: WebGL2RenderingContext;
    state: WebGLState;
    geometry: Hilo3d.MorphGeometry;
    material: Hilo3d.Material;
    mesh: Hilo3d.Mesh;
    fog: Hilo3d.Fog;
}

let environment: TestEnvironment | undefined;

export function createHilo3dEnvironment(forceNew = false): TestEnvironment {
    if (!environment || forceNew) {
        const camera = new Hilo3d.PerspectiveCamera();
        const stage = new Hilo3d.Stage({ camera });
        stage.tick(0);

        const renderer = stage.renderer.getExtension('webgl2-native') as WebGL2Driver | null;
        if (!renderer) {
            throw new Error('Expected the test Stage to expose the WebGL2 native extension');
        }
        const { gl, state } = renderer;
        const material = new Hilo3d.Material();
        const geometry = new Hilo3d.MorphGeometry();
        const mesh = new Hilo3d.Mesh({ material, geometry });
        const fog = new Hilo3d.Fog();
        stage.addChild(mesh);

        environment = {
            stage,
            camera,
            renderer,
            gl,
            state,
            geometry,
            material,
            mesh,
            fog
        };
    }

    return environment;
}

const stageElement = document.createElement('div');
stageElement.id = 'stage';
document.body.append(stageElement);

export const testEnv = createHilo3dEnvironment();
