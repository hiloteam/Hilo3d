import * as Hilo3d from 'hilo3d';
import './style.css';
import { reportStartupFailure } from './startup';

const WORLD_LAYER = 1;
type GameState = 'playing' | 'won';

async function main(): Promise<void> {
    const app = document.querySelector<HTMLElement>('#app');
    if (!app) throw new Error('The game requires #app.');

    function backendFromUrl(): Hilo3d.StageBackend {
        const value = new URL(location.href).searchParams.get('backend');
        return value === 'webgl2' || value === 'webgpu' ? value : 'auto';
    }

    const worldCamera = new Hilo3d.PerspectiveCamera({
        fov: 52,
        aspect: innerWidth / innerHeight,
        near: 0.1,
        far: 100,
        visibility: WORLD_LAYER,
        priority: 0,
        clearColor: true,
        x: 0,
        y: 4.8,
        z: 8
    });
    const uiCamera = new Hilo3d.Camera2D({
        width: innerWidth,
        height: innerHeight,
        visibility: Hilo3d.DEFAULT_2D_LAYER,
        priority: 100,
        clearColor: false
    });
    const stage = await Hilo3d.Stage.create({
        backend: backendFromUrl(),
        container: app,
        cameras: [worldCamera, uiCamera],
        width: innerWidth,
        height: innerHeight,
        pixelRatio: Math.min(devicePixelRatio || 1, 2),
        antialias: true,
        clearColor: new Hilo3d.Color(0.012, 0.025, 0.07)
    });

    new Hilo3d.AmbientLight({
        layer: WORLD_LAYER,
        color: new Hilo3d.Color(0.32, 0.5, 0.9),
        amount: 0.8
    }).addTo(stage);
    new Hilo3d.DirectionalLight({
        layer: WORLD_LAYER,
        color: new Hilo3d.Color(1, 0.86, 0.62),
        amount: 4.5,
        direction: new Hilo3d.Vector3(-1, -1.3, -0.7)
    }).addTo(stage);

    new Hilo3d.Mesh({
        layer: WORLD_LAYER,
        geometry: new Hilo3d.PlaneGeometry({ width: 20, height: 20 }),
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.035, 0.1, 0.16),
            roughness: 0.9
        }),
        rotationX: -90
    }).addTo(stage);

    const player = new Hilo3d.Mesh({
        layer: WORLD_LAYER,
        geometry: new Hilo3d.SphereGeometry({
            radius: 0.48,
            widthSegments: 28,
            heightSegments: 16
        }),
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.14, 0.82, 1),
            metallic: 0.4,
            roughness: 0.22,
            emission: new Hilo3d.Color(0.01, 0.1, 0.2)
        }),
        y: 0.5
    }).addTo(stage);

    const shardGeometry = new Hilo3d.BoxGeometry({ width: 0.5, height: 0.8, depth: 0.5 });
    const shardMaterial = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(1, 0.58, 0.16),
        metallic: 0.3,
        roughness: 0.2,
        emission: new Hilo3d.Color(0.28, 0.05, 0)
    });
    const shardPositions = [
        [-3.6, -2.4],
        [3.8, -2.8],
        [3.1, 3],
        [-3.2, 2.8]
    ] as const;
    const shards = shardPositions.map(([x, z]) =>
        new Hilo3d.Mesh({
            layer: WORLD_LAYER,
            geometry: shardGeometry,
            material: shardMaterial,
            x,
            y: 0.55,
            z,
            useHandCursor: true
        }).addTo(stage)
    );

    const title = new Hilo3d.Text2D({
        text: 'SHARD SEEKER',
        style: {
            font: '800 28px system-ui, sans-serif',
            fillStyle: '#ffffff',
            strokeStyle: '#071022',
            strokeWidth: 6,
            padding: 8,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage);
    const scoreLabel = new Hilo3d.Text2D({
        text: 'SHARDS 0 / 4',
        style: {
            font: '700 17px ui-monospace, monospace',
            fillStyle: '#ffd98a',
            strokeStyle: '#071022',
            strokeWidth: 5,
            padding: 7,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage);
    const resetButton = new Hilo3d.Text2D({
        text: 'WASD / ARROWS • TAP SHARDS • R TO RESET',
        style: {
            font: '700 12px system-ui, sans-serif',
            fillStyle: '#8eeaff',
            strokeStyle: '#071022',
            strokeWidth: 5,
            padding: 8,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5,
        anchorY: 0.5,
        useHandCursor: true
    }).addTo(stage);
    title.sortingLayer = 100;
    scoreLabel.sortingLayer = 100;
    resetButton.sortingLayer = 110;

    const keys = new Set<string>();
    const collected = new Set<Hilo3d.Mesh>();
    let state: GameState = 'playing';

    function collect(shard: Hilo3d.Mesh): void {
        if (state !== 'playing' || collected.has(shard)) return;
        collected.add(shard);
        shard.visible = false;
        scoreLabel.setText(`SHARDS ${String(collected.size)} / ${String(shards.length)}`);
        if (collected.size === shards.length) {
            state = 'won';
            title.setText('CONSTELLATION COMPLETE');
            resetButton.setText('TAP HERE OR PRESS R TO PLAY AGAIN');
        }
    }

    function restart(): void {
        state = 'playing';
        collected.clear();
        for (const shard of shards) shard.visible = true;
        player.setPosition(0, 0.5, 0);
        title.setText('SHARD SEEKER');
        scoreLabel.setText(`SHARDS 0 / ${String(shards.length)}`);
        resetButton.setText('WASD / ARROWS • TAP SHARDS • R TO RESET');
    }

    for (const shard of shards) {
        shard.on('click', () => collect(shard));
    }
    resetButton.on('click', restart);
    stage.enableDOMEvent('click');

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

    const game: Hilo3d.Tickable = {
        tick(dtMilliseconds): void {
            const dt = Math.min(dtMilliseconds, 50) / 1000;
            for (let index = 0; index < shards.length; index += 1) {
                const shard = shards[index];
                if (!shard || !shard.visible) continue;
                shard.rotationY += dt * (70 + index * 12);
                shard.rotationX += dt * 35;
                if (Math.hypot(player.x - shard.x, player.z - shard.z) < 0.85) collect(shard);
            }

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
                player.x = Math.max(-8.5, Math.min(8.5, player.x + directionX * 4.8 * dt));
                player.z = Math.max(-8.5, Math.min(8.5, player.z + directionZ * 4.8 * dt));
                player.rotationZ -= directionX * dt * 140;
                player.rotationX += directionZ * dt * 140;
            }

            const blend = 1 - Math.exp(-7 * dt);
            worldCamera.x += (player.x - worldCamera.x) * blend;
            worldCamera.z += (player.z + 8 - worldCamera.z) * blend;
            worldCamera.lookAt(player);
        }
    };

    function resize(): void {
        const width = Math.max(1, innerWidth);
        const height = Math.max(1, innerHeight);
        stage.resize(width, height, Math.min(devicePixelRatio || 1, 2));
        worldCamera.aspect = width / height;
        uiCamera.resize(width, height);
        title.setPosition(width * 0.5, 18, 40);
        scoreLabel.setPosition(width * 0.5, 64, 40);
        resetButton.setPosition(width * 0.5, height - 34, 40);
    }
    window.addEventListener('resize', resize);
    resize();
    restart();

    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(game);
    ticker.addTick(stage);
    ticker.start();
    document.querySelector('#loading')?.remove();
    console.info(`Hilo3D hybrid starter uses ${stage.renderer.backend}`);

    let destroyed = false;
    function destroy(): void {
        if (destroyed) return;
        destroyed = true;
        ticker.stop();
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('resize', resize);
        stage.destroy();
    }
    window.addEventListener('beforeunload', destroy, { once: true });
}

void main().catch(reportStartupFailure);
