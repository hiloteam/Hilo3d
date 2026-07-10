import should from 'should';
import sinon from 'sinon';
import * as Hilo3d from '../src/Hilo3d';

type Done = (error?: Error) => void;

export interface TestEnvironment {
    stage: InstanceType<typeof Hilo3d.Stage>;
    camera: InstanceType<typeof Hilo3d.PerspectiveCamera>;
    renderer: InstanceType<typeof Hilo3d.WebGLRenderer>;
    gl: WebGLRenderingContext;
    state: InstanceType<typeof Hilo3d.WebGLState>;
    geometry: InstanceType<typeof Hilo3d.MorphGeometry>;
    material: InstanceType<typeof Hilo3d.Material>;
    mesh: InstanceType<typeof Hilo3d.Mesh>;
    fog: InstanceType<typeof Hilo3d.Fog>;
}

let environment: TestEnvironment | undefined;

export const utils = {
    click(element: Element): void {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    },

    diffWithScreenshot(_name: string, done: Done): void {
        done();
    },

    createHilo3dEnv(forceNew = false): TestEnvironment {
        if (!environment || forceNew) {
            const camera = new Hilo3d.PerspectiveCamera();
            const stage = new Hilo3d.Stage({ camera });
            stage.tick(0);

            const { renderer } = stage;
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
};

const epsilon = 1e-7;

interface ShouldAssertionContext {
    obj: unknown;
    params: Record<string, unknown>;
}

interface ShouldRuntime {
    Assertion: {
        add<Arguments extends readonly unknown[]>(
            name: string,
            assertion: (this: ShouldAssertionContext, ...args: Arguments) => void
        ): void;
    };
}

const shouldRuntime = should as typeof should & ShouldRuntime;

shouldRuntime.Assertion.add('equalishValues', function equalishValues(
    this: ShouldAssertionContext,
    ...expected: number[]
) {
    const actual = Array.from(this.obj as ArrayLike<number>);
    this.params = { operator: 'to be approximately equal', actual, expected };
    should(actual.length).above(0);
    actual.forEach((value, index) => {
        should(Math.abs(value - expected[index]!)).below(epsilon);
    });
});

shouldRuntime.Assertion.add('equalish', function equalish(
    this: ShouldAssertionContext,
    expected: number
) {
    const actual = this.obj as number;
    this.params = { operator: 'to be approximately equal', actual, expected };
    if (Number.isNaN(actual) || Number.isNaN(expected)) {
        should(Number.isNaN(actual)).equal(Number.isNaN(expected));
    } else {
        should(Math.abs(actual - expected)).below(epsilon);
    }
});

const stageElement = document.createElement('div');
stageElement.id = 'stage';
document.body.append(stageElement);

window._IS_WEB = false;
window._IS_CI = true;

Object.assign(globalThis, {
    Hilo3d,
    sinon,
    utils,
    testEnv: utils.createHilo3dEnv()
});
