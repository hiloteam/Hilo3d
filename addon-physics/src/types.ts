/** Physics simulation dimensionality. The two dimensions use separate backend modules. */
export type PhysicsDimension = '2d' | '3d';

export interface PhysicsVector2 {
    readonly x: number;
    readonly y: number;
}

export interface PhysicsVector3 extends PhysicsVector2 {
    readonly z: number;
}

export interface PhysicsQuaternion {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
}

export interface PhysicsPose2D {
    readonly position: PhysicsVector2;
    /** Counter-clockwise angle in radians. */
    readonly rotation: number;
}

export interface PhysicsPose3D {
    readonly position: PhysicsVector3;
    readonly rotation: PhysicsQuaternion;
}

export type PhysicsVector<D extends PhysicsDimension> = D extends '2d'
    ? PhysicsVector2
    : PhysicsVector3;
export type PhysicsRotation<D extends PhysicsDimension> = D extends '2d'
    ? number
    : PhysicsQuaternion;
export type PhysicsAngularVelocity<D extends PhysicsDimension> = D extends '2d'
    ? number
    : PhysicsVector3;
export type PhysicsPose<D extends PhysicsDimension> = D extends '2d'
    ? PhysicsPose2D
    : PhysicsPose3D;

export type PhysicsRigidBodyType =
    'dynamic' | 'fixed' | 'kinematic-position' | 'kinematic-velocity';

interface PhysicsRigidBodyDescriptorBase {
    readonly type?: PhysicsRigidBodyType;
    readonly enabled?: boolean;
    readonly gravityScale?: number;
    readonly additionalMass?: number;
    readonly linearDamping?: number;
    readonly angularDamping?: number;
    readonly canSleep?: boolean;
    readonly sleeping?: boolean;
    readonly continuousCollisionDetection?: boolean;
    readonly softCcdPrediction?: number;
    readonly dominanceGroup?: number;
    readonly additionalSolverIterations?: number;
    readonly userData?: unknown;
}

export interface PhysicsRigidBodyDescriptor2D extends PhysicsRigidBodyDescriptorBase {
    readonly position?: PhysicsVector2;
    readonly rotation?: number;
    readonly linearVelocity?: PhysicsVector2;
    readonly angularVelocity?: number;
    readonly enabledTranslations?: readonly [x: boolean, y: boolean];
    readonly rotationEnabled?: boolean;
}

export interface PhysicsRigidBodyDescriptor3D extends PhysicsRigidBodyDescriptorBase {
    readonly position?: PhysicsVector3;
    readonly rotation?: PhysicsQuaternion;
    readonly linearVelocity?: PhysicsVector3;
    readonly angularVelocity?: PhysicsVector3;
    readonly enabledTranslations?: readonly [x: boolean, y: boolean, z: boolean];
    readonly enabledRotations?: readonly [x: boolean, y: boolean, z: boolean];
}

export type PhysicsRigidBodyDescriptor<D extends PhysicsDimension> = D extends '2d'
    ? PhysicsRigidBodyDescriptor2D
    : PhysicsRigidBodyDescriptor3D;

export interface PhysicsBallShape {
    readonly type: 'ball';
    readonly radius: number;
}

export interface PhysicsCuboidShape2D {
    readonly type: 'cuboid';
    readonly halfExtents: PhysicsVector2;
    readonly borderRadius?: number;
}

export interface PhysicsCuboidShape3D {
    readonly type: 'cuboid';
    readonly halfExtents: PhysicsVector3;
    readonly borderRadius?: number;
}

export interface PhysicsCapsuleShape {
    readonly type: 'capsule';
    readonly halfHeight: number;
    readonly radius: number;
}

export interface PhysicsSegmentShape2D {
    readonly type: 'segment';
    readonly a: PhysicsVector2;
    readonly b: PhysicsVector2;
}

export interface PhysicsTriangleShape2D {
    readonly type: 'triangle';
    readonly a: PhysicsVector2;
    readonly b: PhysicsVector2;
    readonly c: PhysicsVector2;
    readonly borderRadius?: number;
}

export interface PhysicsPolylineShape2D {
    readonly type: 'polyline';
    /** Packed x/y vertices. */
    readonly vertices: Float32Array;
    /** Optional packed segment endpoint indices. */
    readonly indices?: Uint32Array;
}

export interface PhysicsTriangleMeshShape2D {
    readonly type: 'trimesh';
    /** Packed x/y vertices. */
    readonly vertices: Float32Array;
    readonly indices: Uint32Array;
}

export interface PhysicsConvexHullShape2D {
    readonly type: 'convex-hull';
    /** Packed x/y points. */
    readonly points: Float32Array;
    readonly borderRadius?: number;
}

export interface PhysicsHeightfieldShape2D {
    readonly type: 'heightfield';
    readonly heights: Float32Array;
    readonly scale: PhysicsVector2;
}

export interface PhysicsHalfspaceShape2D {
    readonly type: 'halfspace';
    readonly normal: PhysicsVector2;
}

export type PhysicsShape2D =
    | PhysicsBallShape
    | PhysicsCuboidShape2D
    | PhysicsCapsuleShape
    | PhysicsSegmentShape2D
    | PhysicsTriangleShape2D
    | PhysicsPolylineShape2D
    | PhysicsTriangleMeshShape2D
    | PhysicsConvexHullShape2D
    | PhysicsHeightfieldShape2D
    | PhysicsHalfspaceShape2D;

export interface PhysicsCylinderShape3D {
    readonly type: 'cylinder';
    readonly halfHeight: number;
    readonly radius: number;
    readonly borderRadius?: number;
}

export interface PhysicsConeShape3D {
    readonly type: 'cone';
    readonly halfHeight: number;
    readonly radius: number;
    readonly borderRadius?: number;
}

export interface PhysicsTriangleMeshShape3D {
    readonly type: 'trimesh';
    /** Packed x/y/z vertices. */
    readonly vertices: Float32Array;
    readonly indices: Uint32Array;
}

export interface PhysicsConvexHullShape3D {
    readonly type: 'convex-hull';
    /** Packed x/y/z points. */
    readonly points: Float32Array;
    readonly borderRadius?: number;
}

export interface PhysicsHeightfieldShape3D {
    readonly type: 'heightfield';
    /** Number of terrain cells along the local Z axis. */
    readonly rows: number;
    /** Number of terrain cells along the local X axis. */
    readonly columns: number;
    /** Column-major samples; length must be `(rows + 1) * (columns + 1)`. */
    readonly heights: Float32Array;
    readonly scale: PhysicsVector3;
}

export type PhysicsShape3D =
    | PhysicsBallShape
    | PhysicsCuboidShape3D
    | PhysicsCapsuleShape
    | PhysicsCylinderShape3D
    | PhysicsConeShape3D
    | PhysicsTriangleMeshShape3D
    | PhysicsConvexHullShape3D
    | PhysicsHeightfieldShape3D;

export type PhysicsShape<D extends PhysicsDimension> = D extends '2d'
    ? PhysicsShape2D
    : PhysicsShape3D;

export interface PhysicsInteractionGroups {
    /** 16-bit set of groups this collider belongs to. */
    readonly memberships: number;
    /** 16-bit set of groups this collider may interact with. */
    readonly filter: number;
}

export type PhysicsCoefficientCombineRule = 'average' | 'min' | 'multiply' | 'max';

interface PhysicsColliderDescriptorBase {
    readonly enabled?: boolean;
    readonly sensor?: boolean;
    readonly density?: number;
    readonly mass?: number;
    readonly friction?: number;
    readonly restitution?: number;
    readonly frictionCombineRule?: PhysicsCoefficientCombineRule;
    readonly restitutionCombineRule?: PhysicsCoefficientCombineRule;
    readonly contactSkin?: number;
    readonly collisionGroups?: PhysicsInteractionGroups;
    readonly solverGroups?: PhysicsInteractionGroups;
    /** Generate collision start/end events for this collider. */
    readonly collisionEvents?: boolean;
    /** Generate contact-force events above this magnitude. */
    readonly contactForceEventThreshold?: number;
    readonly userData?: unknown;
}

export interface PhysicsColliderDescriptor2D extends PhysicsColliderDescriptorBase {
    readonly shape: PhysicsShape2D;
    readonly localPosition?: PhysicsVector2;
    readonly localRotation?: number;
}

export interface PhysicsColliderDescriptor3D extends PhysicsColliderDescriptorBase {
    readonly shape: PhysicsShape3D;
    readonly localPosition?: PhysicsVector3;
    readonly localRotation?: PhysicsQuaternion;
}

export type PhysicsColliderDescriptor<D extends PhysicsDimension> = D extends '2d'
    ? PhysicsColliderDescriptor2D
    : PhysicsColliderDescriptor3D;

interface PhysicsJointDescriptorBase {
    readonly contactsEnabled?: boolean;
}

export type PhysicsJointDescriptor2D = PhysicsJointDescriptorBase &
    (
        | {
              readonly type: 'fixed';
              readonly anchor1: PhysicsVector2;
              readonly anchor2: PhysicsVector2;
              readonly rotation1?: number;
              readonly rotation2?: number;
          }
        | {
              readonly type: 'revolute';
              readonly anchor1: PhysicsVector2;
              readonly anchor2: PhysicsVector2;
              readonly limits?: readonly [min: number, max: number];
          }
        | {
              readonly type: 'prismatic';
              readonly anchor1: PhysicsVector2;
              readonly anchor2: PhysicsVector2;
              readonly axis: PhysicsVector2;
              readonly limits?: readonly [min: number, max: number];
          }
        | {
              readonly type: 'rope';
              readonly length: number;
              readonly anchor1: PhysicsVector2;
              readonly anchor2: PhysicsVector2;
          }
        | {
              readonly type: 'spring';
              readonly restLength: number;
              readonly stiffness: number;
              readonly damping: number;
              readonly anchor1: PhysicsVector2;
              readonly anchor2: PhysicsVector2;
          }
    );

export type PhysicsJointDescriptor3D = PhysicsJointDescriptorBase &
    (
        | {
              readonly type: 'fixed';
              readonly anchor1: PhysicsVector3;
              readonly anchor2: PhysicsVector3;
              readonly rotation1?: PhysicsQuaternion;
              readonly rotation2?: PhysicsQuaternion;
          }
        | {
              readonly type: 'spherical';
              readonly anchor1: PhysicsVector3;
              readonly anchor2: PhysicsVector3;
          }
        | {
              readonly type: 'revolute' | 'prismatic';
              readonly anchor1: PhysicsVector3;
              readonly anchor2: PhysicsVector3;
              readonly axis: PhysicsVector3;
              readonly limits?: readonly [min: number, max: number];
          }
        | {
              readonly type: 'rope';
              readonly length: number;
              readonly anchor1: PhysicsVector3;
              readonly anchor2: PhysicsVector3;
          }
        | {
              readonly type: 'spring';
              readonly restLength: number;
              readonly stiffness: number;
              readonly damping: number;
              readonly anchor1: PhysicsVector3;
              readonly anchor2: PhysicsVector3;
          }
    );

export type PhysicsJointDescriptor<D extends PhysicsDimension> = D extends '2d'
    ? PhysicsJointDescriptor2D
    : PhysicsJointDescriptor3D;

export interface PhysicsQueryFilter {
    readonly groups?: PhysicsInteractionGroups;
    readonly excludeCollider?: number;
    readonly excludeRigidBody?: number;
    readonly excludeFixed?: boolean;
    readonly excludeKinematic?: boolean;
    readonly excludeDynamic?: boolean;
    readonly excludeSensors?: boolean;
    readonly excludeSolids?: boolean;
    readonly predicate?: (colliderHandle: number) => boolean;
}

export interface PhysicsRaycastHit2D {
    readonly colliderHandle: number;
    readonly point: PhysicsVector2;
    readonly normal: PhysicsVector2;
    readonly distance: number;
}

export interface PhysicsRaycastHit3D {
    readonly colliderHandle: number;
    readonly point: PhysicsVector3;
    readonly normal: PhysicsVector3;
    readonly distance: number;
}

export type PhysicsRaycastHit<D extends PhysicsDimension> = D extends '2d'
    ? PhysicsRaycastHit2D
    : PhysicsRaycastHit3D;

export interface PhysicsShapeCastHit2D {
    readonly colliderHandle: number;
    readonly timeOfImpact: number;
    readonly witness1: PhysicsVector2;
    readonly witness2: PhysicsVector2;
    readonly normal1: PhysicsVector2;
    readonly normal2: PhysicsVector2;
}

export interface PhysicsShapeCastHit3D {
    readonly colliderHandle: number;
    readonly timeOfImpact: number;
    readonly witness1: PhysicsVector3;
    readonly witness2: PhysicsVector3;
    readonly normal1: PhysicsVector3;
    readonly normal2: PhysicsVector3;
}

export type PhysicsShapeCastHit<D extends PhysicsDimension> = D extends '2d'
    ? PhysicsShapeCastHit2D
    : PhysicsShapeCastHit3D;

export interface PhysicsPointProjection2D {
    readonly colliderHandle: number;
    readonly point: PhysicsVector2;
    readonly inside: boolean;
}

export interface PhysicsPointProjection3D {
    readonly colliderHandle: number;
    readonly point: PhysicsVector3;
    readonly inside: boolean;
}

export type PhysicsPointProjection<D extends PhysicsDimension> = D extends '2d'
    ? PhysicsPointProjection2D
    : PhysicsPointProjection3D;

export interface PhysicsShapeCastOptions {
    /** Extra separation accepted as a hit. Defaults to zero. */
    readonly targetDistance?: number;
    /** Multiplier applied to the supplied velocity. Defaults to one. */
    readonly maxTimeOfImpact?: number;
    /** Report initial penetration instead of ignoring separating motion. Defaults to true. */
    readonly stopAtPenetration?: boolean;
    readonly filter?: PhysicsQueryFilter;
}

export interface PhysicsOverlapShapeOptions {
    /** Bounded result capacity. Defaults to 64. */
    readonly maxResults?: number;
    readonly filter?: PhysicsQueryFilter;
}

export interface PhysicsCharacterAutostepOptions {
    readonly maxHeight: number;
    readonly minWidth: number;
    readonly includeDynamicBodies?: boolean;
}

export interface PhysicsCharacterControllerOptions<D extends PhysicsDimension> {
    /** Separation maintained from obstacles. Must be positive. */
    readonly offset: number;
    readonly up?: PhysicsVector<D>;
    readonly slide?: boolean;
    readonly autostep?: PhysicsCharacterAutostepOptions | false;
    /** Radians. */
    readonly maxSlopeClimbAngle?: number;
    /** Radians. */
    readonly minSlopeSlideAngle?: number;
    readonly snapToGroundDistance?: number | false;
    readonly applyImpulsesToDynamicBodies?: boolean;
    readonly characterMass?: number | null;
    readonly normalNudgeFactor?: number;
}

export interface PhysicsCharacterCollision<D extends PhysicsDimension> {
    readonly colliderHandle: number | null;
    readonly translationApplied: PhysicsVector<D>;
    readonly translationRemaining: PhysicsVector<D>;
    readonly timeOfImpact: number;
    readonly witness1: PhysicsVector<D>;
    readonly witness2: PhysicsVector<D>;
    readonly normal1: PhysicsVector<D>;
    readonly normal2: PhysicsVector<D>;
}

export interface PhysicsCharacterMovement<D extends PhysicsDimension> {
    readonly translation: PhysicsVector<D>;
    readonly grounded: boolean;
    readonly collisions: readonly PhysicsCharacterCollision<D>[];
}

export interface PhysicsDebugGeometry {
    /** Packed line-list positions: x/y for 2D, x/y/z for 3D. */
    readonly vertices: Float32Array;
    /** One RGBA color per vertex. */
    readonly colors: Float32Array;
}

export interface PhysicsWorldDiagnostics {
    readonly bodyCount: number;
    readonly colliderCount: number;
    readonly jointCount: number;
    readonly characterControllerCount: number;
    readonly simulatedSteps: number;
    readonly droppedTimeSeconds: number;
    readonly accumulatorSeconds: number;
    readonly interpolationAlpha: number;
}
