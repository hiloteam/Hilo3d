import * as CANNON from 'cannon-es';
import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext } from '../shared/init';

interface PhysicsWorldOptions {
    iterations?: number;
    broadphase?: CANNON.Broadphase;
}

interface BodyOptions {
    mass?: number;
}

class PhysicsWorld implements Hilo3d.Tickable {
    readonly world: CANNON.World;
    private readonly bodies = new Map<Hilo3d.Mesh, CANNON.Body>();

    constructor(gravity = new Hilo3d.Vector3(0, -9.8, 0), options: PhysicsWorldOptions = {}) {
        const solver = new CANNON.GSSolver();
        solver.iterations = options.iterations ?? 10;
        this.world = new CANNON.World({
            gravity: new CANNON.Vec3(gravity.x, gravity.y, gravity.z),
            broadphase: options.broadphase ?? new CANNON.NaiveBroadphase(),
            solver
        });
    }

    bindMesh(mesh: Hilo3d.Mesh, options: BodyOptions = {}): CANNON.Body {
        const geometry = mesh.geometry;
        let shape: CANNON.Shape;
        if (geometry instanceof Hilo3d.BoxGeometry) {
            shape = new CANNON.Box(
                new CANNON.Vec3(geometry.width / 2, geometry.height / 2, geometry.depth / 2)
            );
        } else if (geometry instanceof Hilo3d.SphereGeometry) {
            shape = new CANNON.Sphere(geometry.radius);
        } else {
            throw new TypeError('PhysicsWorld only supports box and sphere geometry.');
        }

        this.unbindMesh(mesh);
        const body = new CANNON.Body({
            mass: options.mass ?? 1,
            position: new CANNON.Vec3(mesh.x, mesh.y, mesh.z),
            quaternion: new CANNON.Quaternion(
                mesh.quaternion.x,
                mesh.quaternion.y,
                mesh.quaternion.z,
                mesh.quaternion.w
            ),
            shape
        });
        this.world.addBody(body);
        this.bodies.set(mesh, body);
        return body;
    }

    unbindMesh(mesh: Hilo3d.Mesh): void {
        const body = this.bodies.get(mesh);
        if (!body) return;
        this.world.removeBody(body);
        this.bodies.delete(mesh);
    }

    createGround(): CANNON.Body {
        const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        this.world.addBody(body);
        return body;
    }

    tick(deltaTime: number): void {
        this.world.step(1 / 60, deltaTime / 1000, 3);
        for (const [mesh, body] of this.bodies) {
            mesh.position.set(body.position.x, body.position.y, body.position.z);
            mesh.quaternion.set(
                body.quaternion.x,
                body.quaternion.y,
                body.quaternion.z,
                body.quaternion.w
            );
        }
    }
}

function random(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

const { stage, directionLight, ambientLight, ticker } = createExampleContext();
stage.rotation.degX = 20;
ambientLight.enabled = false;
directionLight.amount = 10;
directionLight.direction = new Hilo3d.Vector3(0, -1, -1);

const physics = new PhysicsWorld(new Hilo3d.Vector3(0, -5, 0));
physics.createGround();
new Hilo3d.AxisNetHelper({ size: 10 }).setScale(10).addTo(stage);
ticker.addTick(physics);

for (let index = 0; index < 50; index++) {
    ticker.timeout(() => {
        const geometry =
            Math.random() > 0.5
                ? new Hilo3d.BoxGeometry({
                      width: random(0.1, 0.2),
                      height: random(0.1, 0.2),
                      depth: random(0.1, 0.2)
                  })
                : new Hilo3d.SphereGeometry({ radius: random(0.05, 0.1) });
        const mesh = new Hilo3d.Mesh({
            y: 1,
            rotationX: Math.random() * 360,
            rotationZ: Math.random() * 360,
            geometry,
            material: new Hilo3d.PBRMaterial({
                baseColor: new Hilo3d.Color(1, 0, 0)
            })
        }).addTo(stage);
        physics.bindMesh(mesh);
    }, index * 500);
}
