import type {
    PhysicsPose3D,
    PhysicsRigidBody,
    PhysicsVector3,
    PhysicsWorld
} from '@hilo/addon-physics';

export interface BridgeAnchor {
    readonly body: PhysicsRigidBody<'3d'>;
    readonly local: PhysicsVector3;
}

export interface BridgeCable {
    readonly first: BridgeAnchor;
    readonly second: BridgeAnchor;
    readonly kind: 'main' | 'hanger' | 'link';
}

export interface BridgeMetrics {
    readonly loads: number;
    readonly deflection: number;
    readonly joints: number;
    readonly lateralDisplacement: number;
}

export interface BridgeExperiment {
    readonly deck: readonly PhysicsRigidBody<'3d'>[];
    readonly cablePoints: readonly PhysicsRigidBody<'3d'>[];
    readonly cables: readonly BridgeCable[];
    readonly loadMass: number;
    readonly addLoad: () => PhysicsRigidBody<'3d'> | null;
    readonly clearLoads: () => void;
    readonly reset: () => void;
    readonly sway: () => void;
    readonly metrics: () => BridgeMetrics;
}

const zero: PhysicsVector3 = { x: 0, y: 0, z: 0 };

/** A cable-supported, articulated bridge; every visible suspension line has physical anchors. */
export function createBridgeExperiment(world: PhysicsWorld<'3d'>): BridgeExperiment {
    const fixed = world.createRigidBody({ type: 'fixed' });
    const deck: PhysicsRigidBody<'3d'>[] = [];
    const cablePoints: PhysicsRigidBody<'3d'>[] = [];
    const cables: BridgeCable[] = [];
    const initial: { readonly body: PhysicsRigidBody<'3d'>; readonly pose: PhysicsPose3D }[] = [];
    const loads: PhysicsRigidBody<'3d'>[] = [];
    const loadMass = 3.2;
    const deckHeight = 1.8;
    const count = 11;
    const step = 0.7;
    const side = 0.88;

    function anchor(body: PhysicsRigidBody<'3d'>, local: PhysicsVector3 = zero): BridgeAnchor {
        return { body, local };
    }
    function rope(
        first: BridgeAnchor,
        second: BridgeAnchor,
        length: number,
        kind: BridgeCable['kind']
    ): void {
        world.createJoint(
            {
                type: 'rope',
                anchor1: first.local,
                anchor2: second.local,
                length,
                contactsEnabled: false
            },
            first.body,
            second.body
        );
        cables.push({ first, second, kind });
    }
    function save(body: PhysicsRigidBody<'3d'>): void {
        initial.push({ body, pose: body.pose });
    }

    // Fixed approach ledges catch falling cargo; the canyon itself remains a real open span.
    for (const x of [-4.7, 4.7]) {
        world.createCollider(
            {
                shape: { type: 'cuboid', halfExtents: { x: 0.88, y: 0.1, z: 1.05 } },
                localPosition: { x, y: 1.61, z: 0 },
                friction: 0.8
            },
            fixed
        );
    }
    world.createCollider(
        {
            shape: { type: 'cuboid', halfExtents: { x: 6.1, y: 0.12, z: 2.9 } },
            localPosition: { x: 0, y: -0.58, z: 0 },
            friction: 0.9
        },
        fixed
    );

    for (let index = 0; index < count; index += 1) {
        const x = (index - (count - 1) / 2) * step;
        const body = world.createRigidBody({
            type: 'dynamic',
            position: { x, y: deckHeight, z: 0 },
            linearDamping: 0.18,
            angularDamping: 0.35,
            additionalSolverIterations: 6,
            canSleep: false
        });
        world.createCollider(
            {
                shape: { type: 'cuboid', halfExtents: { x: 0.34, y: 0.085, z: 0.95 } },
                mass: 0.85,
                friction: 0.95,
                restitution: 0.02
            },
            body
        );
        deck.push(body);
        save(body);
        const previous = deck[index - 1];
        if (previous) {
            for (const z of [-side, side])
                rope(
                    anchor(previous, { x: 0.34, y: 0, z }),
                    anchor(body, { x: -0.34, y: 0, z }),
                    0.095,
                    'link'
                );
        }
    }

    for (const z of [-side, side]) {
        let previous = anchor(fixed, { x: -4.25, y: 4.35, z });
        let previousPosition = previous.local;
        for (let index = 0; index < count; index += 1) {
            const deckBody = deck[index];
            if (!deckBody) throw new Error('Bridge deck segment is missing.');
            const x = (index - (count - 1) / 2) * step;
            const y = 2.95 + 1.4 * (x / 4.25) ** 2;
            const position = { x, y, z };
            const body = world.createRigidBody({
                type: 'dynamic',
                position,
                linearDamping: 0.25,
                angularDamping: 0.4,
                canSleep: false,
                additionalSolverIterations: 6
            });
            world.createCollider(
                {
                    shape: { type: 'ball', radius: 0.055 },
                    mass: 0.12,
                    collisionGroups: { memberships: 2, filter: 0 }
                },
                body
            );
            cablePoints.push(body);
            save(body);
            const current = anchor(body);
            rope(
                previous,
                current,
                Math.hypot(position.x - previousPosition.x, position.y - previousPosition.y) *
                    1.002,
                'main'
            );
            const deckAnchor = anchor(deckBody, { x: 0, y: 0.075, z });
            world.createJoint(
                {
                    type: 'spring',
                    anchor1: zero,
                    anchor2: deckAnchor.local,
                    restLength: y - deckHeight - 0.075 - (0.85 * 9.81) / 90,
                    stiffness: 45,
                    damping: 4.5
                },
                body,
                deckBody
            );
            cables.push({ first: current, second: deckAnchor, kind: 'hanger' });
            previous = current;
            previousPosition = position;
        }
        const end = { x: 4.25, y: 4.35, z };
        rope(
            previous,
            anchor(fixed, end),
            Math.hypot(end.x - previousPosition.x, end.y - previousPosition.y) * 1.002,
            'main'
        );
        const firstDeck = deck[0];
        const lastDeck = deck[count - 1];
        if (!firstDeck || !lastDeck) throw new Error('Bridge approach segment is missing.');
        rope(
            anchor(fixed, { x: -3.86, y: deckHeight, z }),
            anchor(firstDeck, { x: -0.34, y: 0, z }),
            0.13,
            'link'
        );
        rope(
            anchor(lastDeck, { x: 0.34, y: 0, z }),
            anchor(fixed, { x: 3.86, y: deckHeight, z }),
            0.13,
            'link'
        );
    }

    function clearLoads(): void {
        for (const body of loads) world.removeRigidBody(body);
        loads.length = 0;
    }
    function metrics(): BridgeMetrics {
        const middle = deck.slice(4, 7);
        const meanHeight =
            middle.reduce((sum, body) => sum + body.pose.position.y, 0) / middle.length;
        const lateral = middle.reduce((sum, body) => sum + body.pose.position.z, 0) / middle.length;
        return {
            loads: loads.length,
            deflection: deckHeight - meanHeight,
            joints: world.getDiagnostics().jointCount,
            lateralDisplacement: lateral
        };
    }
    return {
        deck,
        cablePoints,
        cables,
        loadMass,
        addLoad(): PhysicsRigidBody<'3d'> | null {
            if (loads.length >= 4) return null;
            const columns = [-1, 1, -2, 2] as const;
            const column = columns[loads.length] ?? 0;
            const support = deck[column + 5];
            if (!support) throw new Error('Bridge load support is missing.');
            const supportPosition = support.pose.position;
            const body = world.createRigidBody({
                type: 'dynamic',
                position: { x: supportPosition.x, y: supportPosition.y + 0.95, z: 0 },
                continuousCollisionDetection: true,
                linearDamping: 0.12,
                angularDamping: 0.3
            });
            world.createCollider(
                {
                    shape: { type: 'cuboid', halfExtents: { x: 0.25, y: 0.27, z: 0.31 } },
                    mass: loadMass,
                    friction: 1.1,
                    restitution: 0.02
                },
                body
            );
            loads.push(body);
            return body;
        },
        clearLoads,
        reset(): void {
            clearLoads();
            for (const { body, pose } of initial) {
                body.setPose(pose);
                body.setLinearVelocity(zero);
                body.setAngularVelocity(zero);
            }
        },
        sway(): void {
            for (let index = 3; index < 8; index += 1)
                deck[index]?.applyImpulse({ x: 0, y: 0.1, z: 0.65 });
        },
        metrics
    };
}
