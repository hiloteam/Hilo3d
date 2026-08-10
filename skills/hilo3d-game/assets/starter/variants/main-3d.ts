import * as Hilo3d from 'hilo3d';
import './style.css';
import { reportStartupFailure } from './startup';

type GameState = 'playing' | 'won';

async function main(): Promise<void> {
    const app = document.querySelector<HTMLElement>('#app');
    if (!app) throw new Error('The game requires #app.');

    function backendFromUrl(): Hilo3d.StageBackend {
        const value = new URL(location.href).searchParams.get('backend');
        return value === 'webgl2' || value === 'webgpu' ? value : 'auto';
    }

    const camera = new Hilo3d.PerspectiveCamera({
        fov: 50,
        aspect: innerWidth / innerHeight,
        near: 0.1,
        far: 100,
        x: 0,
        y: 5,
        z: 8
    });
    const stage = await Hilo3d.Stage.create({
        backend: backendFromUrl(),
        container: app,
        camera,
        width: innerWidth,
        height: innerHeight,
        pixelRatio: Math.min(devicePixelRatio || 1, 2),
        antialias: true,
        clearColor: new Hilo3d.Color(0.018, 0.035, 0.085)
    });

    new Hilo3d.AmbientLight({
        color: new Hilo3d.Color(0.42, 0.55, 0.9),
        amount: 0.75
    }).addTo(stage);
    new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 0.88, 0.68),
        amount: 4,
        direction: new Hilo3d.Vector3(-1, -1.4, -0.8)
    }).addTo(stage);

    new Hilo3d.Mesh({
        geometry: new Hilo3d.PlaneGeometry({ width: 18, height: 18 }),
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.05, 0.12, 0.2),
            metallic: 0.05,
            roughness: 0.85,
            receiveShadows: true
        }),
        rotationX: -90
    }).addTo(stage);

    const player = new Hilo3d.Mesh({
        geometry: new Hilo3d.BoxGeometry({ width: 0.8, height: 0.8, depth: 0.8 }),
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.12, 0.78, 1),
            metallic: 0.3,
            roughness: 0.28,
            emission: new Hilo3d.Color(0.01, 0.12, 0.2)
        }),
        y: 0.4,
        useHandCursor: true
    }).addTo(stage);

    const beacon = new Hilo3d.Mesh({
        geometry: new Hilo3d.SphereGeometry({
            radius: 0.55,
            widthSegments: 32,
            heightSegments: 16
        }),
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(1, 0.68, 0.18),
            metallic: 0.15,
            roughness: 0.22,
            emission: new Hilo3d.Color(0.35, 0.08, 0.01)
        }),
        x: 4.3,
        y: 0.65,
        z: -4.2,
        useHandCursor: true
    }).addTo(stage);

    const obstacleGeometry = new Hilo3d.BoxGeometry({ width: 1.2, height: 1.2, depth: 1.2 });
    const obstacleMaterial = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.48, 0.18, 0.72),
        metallic: 0.15,
        roughness: 0.55
    });
    const obstaclePositions = [
        [-2.5, -1],
        [-0.2, -2.7],
        [2, -1.2],
        [2.8, 2.4],
        [-2.2, 2.9]
    ] as const;
    const obstacles = obstaclePositions.map(([x, z]) =>
        new Hilo3d.Mesh({
            geometry: obstacleGeometry,
            material: obstacleMaterial,
            x,
            y: 0.6,
            z
        }).addTo(stage)
    );

    const overlay = document.createElement('div');
    overlay.className = 'game-overlay';
    overlay.innerHTML =
        '<strong>BEACON RUN</strong> · WASD / ARROWS TO MOVE · TAP THE BEACON · R TO RESTART';
    document.body.appendChild(overlay);

    const keys = new Set<string>();
    let state: GameState = 'playing';

    function restart(): void {
        state = 'playing';
        player.setPosition(0, 0.4, 3.8);
        overlay.innerHTML =
            '<strong>BEACON RUN</strong> · WASD / ARROWS TO MOVE · TAP THE BEACON · R TO RESTART';
    }

    function win(): void {
        if (state === 'won') return;
        state = 'won';
        overlay.innerHTML = '<strong>BEACON REACHED</strong> · PRESS R TO PLAY AGAIN';
    }

    function collides(x: number, z: number): boolean {
        for (const obstacle of obstacles) {
            if (Math.abs(x - obstacle.x) < 1 && Math.abs(z - obstacle.z) < 1) return true;
        }
        return false;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
        keys.add(event.code);
        if (event.code === 'KeyR') restart();
        if (event.code.startsWith('Arrow')) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
        keys.delete(event.code);
    };
    const onBlur = (): void => {
        keys.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    beacon.on('click', () => {
        if (state !== 'playing') return;
        player.setPosition(beacon.x, player.y, beacon.z);
        win();
    });
    stage.enableDOMEvent('click');

    const game: Hilo3d.Tickable = {
        tick(dtMilliseconds): void {
            const dt = Math.min(dtMilliseconds, 50) / 1000;
            beacon.rotationY += dt * 80;
            beacon.y = 0.65 + Math.sin(performance.now() * 0.0025) * 0.12;

            if (state === 'playing') {
                let directionX =
                    Number(keys.has('KeyD') || keys.has('ArrowRight')) -
                    Number(keys.has('KeyA') || keys.has('ArrowLeft'));
                let directionZ =
                    Number(keys.has('KeyS') || keys.has('ArrowDown')) -
                    Number(keys.has('KeyW') || keys.has('ArrowUp'));
                const length = Math.hypot(directionX, directionZ);
                if (length > 0) {
                    directionX /= length;
                    directionZ /= length;
                }
                const speed = 4.5;
                const nextX = Math.max(-7.5, Math.min(7.5, player.x + directionX * speed * dt));
                const nextZ = Math.max(-7.5, Math.min(7.5, player.z + directionZ * speed * dt));
                if (!collides(nextX, player.z)) player.x = nextX;
                if (!collides(player.x, nextZ)) player.z = nextZ;
                player.rotationY -= directionX * dt * 130;
                player.rotationX += directionZ * dt * 90;

                if (Math.hypot(player.x - beacon.x, player.z - beacon.z) < 0.85) win();
            }

            const blend = 1 - Math.exp(-6 * dt);
            camera.x += (player.x - camera.x) * blend;
            camera.z += (player.z + 8 - camera.z) * blend;
            camera.lookAt(player);
        }
    };

    function resize(): void {
        const width = Math.max(1, innerWidth);
        const height = Math.max(1, innerHeight);
        stage.resize(width, height, Math.min(devicePixelRatio || 1, 2));
        camera.aspect = width / height;
    }
    window.addEventListener('resize', resize);
    resize();
    restart();

    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(game);
    ticker.addTick(stage);
    ticker.start();
    document.querySelector('#loading')?.remove();
    console.info(`Hilo3D 3D starter uses ${stage.renderer.backend}`);

    let destroyed = false;
    function destroy(): void {
        if (destroyed) return;
        destroyed = true;
        ticker.stop();
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('resize', resize);
        overlay.remove();
        stage.destroy();
    }
    window.addEventListener('beforeunload', destroy, { once: true });
}

void main().catch(reportStartupFailure);
