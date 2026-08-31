import { Matrix4, Quaternion, Vector3, type Node } from 'hilo3d';
import type { PhysicsTransformTarget } from './PhysicsBackend.js';
import type { PhysicsPose2D, PhysicsPose3D, PhysicsQuaternion, PhysicsVector3 } from './types.js';

const SCALE_EPSILON = 1e-5;
const PIVOT_EPSILON = 1e-8;

function sceneRoot(node: Node): Node {
    let root = node;
    while (root.parent) root = root.parent;
    return root;
}

function requireRigidParent(node: Node, scale: Vector3): void {
    const parent = node.parent;
    if (!parent) return;
    parent.worldMatrix.getScaling(scale);
    if (
        Math.abs(scale.x - 1) > SCALE_EPSILON ||
        Math.abs(scale.y - 1) > SCALE_EPSILON ||
        Math.abs(scale.z - 1) > SCALE_EPSILON
    ) {
        throw new Error(
            `Physics-bound node ${node.name || node.id} cannot inherit scaled parent transforms.`
        );
    }
}

function requireZeroPivot(node: Node): void {
    if (
        Math.abs(node.pivotX) > PIVOT_EPSILON ||
        Math.abs(node.pivotY) > PIVOT_EPSILON ||
        Math.abs(node.pivotZ) > PIVOT_EPSILON
    ) {
        throw new Error(`Physics-bound node ${node.name || node.id} must use a zero pivot.`);
    }
}

/** World-space Hilo3D Node transform bridge for a 3D physics body. Scale is visual-only. */
export class HiloNodeTransform3D implements PhysicsTransformTarget<'3d'> {
    readonly node: Node;
    private readonly position = new Vector3();
    private readonly rotation = new Quaternion();
    private readonly scale = new Vector3();
    private readonly worldMatrix = new Matrix4();
    private readonly localMatrix = new Matrix4();
    private readonly inverseParent = new Matrix4();

    constructor(node: Node) {
        this.node = node;
        requireZeroPivot(node);
    }

    readPose(): PhysicsPose3D {
        sceneRoot(this.node).updateMatrixWorld(true);
        requireRigidParent(this.node, this.scale);
        this.node.worldMatrix.getTranslation(this.position);
        this.node.worldMatrix.getRotation(this.rotation);
        const position = this.position.elements;
        const rotation = this.rotation.elements;
        return {
            position: {
                x: position[0],
                y: position[1],
                z: position[2]
            },
            rotation: {
                x: rotation[0],
                y: rotation[1],
                z: rotation[2],
                w: rotation[3]
            }
        };
    }

    writePose(pose: PhysicsPose3D): void {
        const parent = this.node.parent;
        if (parent) {
            sceneRoot(parent).updateMatrixWorld(true);
            requireRigidParent(this.node, this.scale);
        }
        this.position.set(pose.position.x, pose.position.y, pose.position.z);
        this.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
        this.worldMatrix.fromRotationTranslation(this.rotation, this.position);
        if (parent) {
            this.inverseParent.copy(parent.worldMatrix).invert();
            this.localMatrix.multiply(this.inverseParent, this.worldMatrix);
        } else {
            this.localMatrix.copy(this.worldMatrix);
        }
        this.localMatrix.getTranslation(this.position);
        this.localMatrix.getRotation(this.rotation);
        this.node.setPosition(this.position.x, this.position.y, this.position.z);
        this.node.quaternion.copy(this.rotation);
    }

    invalidateHistory(): void {
        this.node.invalidateTransformHistory();
    }
}

function angleFromZQuaternion(rotation: PhysicsQuaternion): number {
    return 2 * Math.atan2(rotation.z, rotation.w);
}

function zQuaternion(angle: number): PhysicsQuaternion {
    const halfAngle = angle * 0.5;
    return { x: 0, y: 0, z: Math.sin(halfAngle), w: Math.cos(halfAngle) };
}

/** XY-plane bridge for Camera2D/Sprite scenes. The Node's initial Z coordinate is preserved. */
export class HiloNodeTransform2D implements PhysicsTransformTarget<'2d'> {
    readonly node: Node;
    private readonly transform3D: HiloNodeTransform3D;
    private readonly z: number;

    constructor(node: Node) {
        this.node = node;
        this.transform3D = new HiloNodeTransform3D(node);
        this.z = this.transform3D.readPose().position.z;
    }

    readPose(): PhysicsPose2D {
        const value = this.transform3D.readPose();
        return {
            position: { x: value.position.x, y: value.position.y },
            rotation: angleFromZQuaternion(value.rotation)
        };
    }

    writePose(pose: PhysicsPose2D): void {
        const position: PhysicsVector3 = {
            x: pose.position.x,
            y: pose.position.y,
            z: this.z
        };
        this.transform3D.writePose({ position, rotation: zQuaternion(pose.rotation) });
    }

    invalidateHistory(): void {
        this.transform3D.invalidateHistory();
    }
}
