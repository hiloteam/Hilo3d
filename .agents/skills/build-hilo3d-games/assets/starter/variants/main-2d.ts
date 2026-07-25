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

    function createAtlas(): Hilo3d.Texture<HTMLCanvasElement> {
        const canvas = document.createElement('canvas');
        canvas.width = 192;
        canvas.height = 64;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D is required to create the starter atlas.');

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#66e1ff';
        context.beginPath();
        context.roundRect(10, 10, 44, 44, 12);
        context.fill();
        context.fillStyle = '#09213d';
        context.fillRect(23, 21, 6, 12);
        context.fillRect(37, 21, 6, 12);

        context.translate(96, 32);
        context.fillStyle = '#ffe07a';
        context.beginPath();
        for (let point = 0; point < 10; point += 1) {
            const radius = point % 2 === 0 ? 23 : 10;
            const angle = -Math.PI / 2 + (point * Math.PI) / 5;
            context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        context.closePath();
        context.fill();
        context.resetTransform();

        context.strokeStyle = '#ff7096';
        context.lineWidth = 7;
        context.beginPath();
        context.arc(160, 32, 18, 0, Math.PI * 2);
        context.stroke();

        return new Hilo3d.Texture({
            image: canvas,
            flipY: true,
            premultiplyAlpha: true,
            minFilter: Hilo3d.constants.webgl.LINEAR,
            magFilter: Hilo3d.constants.webgl.LINEAR,
            wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
            wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
            name: 'Starter2DAtlas'
        });
    }

    const camera = new Hilo3d.Camera2D({
        width: innerWidth,
        height: innerHeight
    });
    const stage = await Hilo3d.Stage.create({
        backend: backendFromUrl(),
        container: app,
        camera,
        width: innerWidth,
        height: innerHeight,
        pixelRatio: Math.min(devicePixelRatio || 1, 2),
        antialias: true,
        useInstanced: true,
        clearColor: new Hilo3d.Color(0.025, 0.055, 0.12)
    });

    const atlas = createAtlas();
    const playerFrame = new Hilo3d.SpriteFrame({
        texture: atlas,
        x: 0,
        y: 0,
        width: 64,
        height: 64
    });
    const starFrame = new Hilo3d.SpriteFrame({
        texture: atlas,
        x: 64,
        y: 0,
        width: 64,
        height: 64
    });
    const ringFrame = new Hilo3d.SpriteFrame({
        texture: atlas,
        x: 128,
        y: 0,
        width: 64,
        height: 64
    });

    const player = new Hilo3d.Sprite({
        frame: playerFrame,
        width: 56,
        height: 56,
        useHandCursor: true
    }).addTo(stage);

    const star = new Hilo3d.Sprite({
        frame: starFrame,
        width: 48,
        height: 48,
        useHandCursor: true
    }).addTo(stage);

    const exitRing = new Hilo3d.Sprite({
        frame: ringFrame,
        width: 72,
        height: 72,
        pointerEnabled: false,
        visible: false
    }).addTo(stage);

    const scoreLabel = new Hilo3d.Text2D({
        text: 'STARS 0 / 5',
        style: {
            font: '700 22px system-ui, sans-serif',
            fillStyle: '#ffffff',
            strokeStyle: '#071022',
            strokeWidth: 5,
            padding: 8,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage);

    const hintLabel = new Hilo3d.Text2D({
        text: 'WASD / ARROWS TO MOVE • TAP THE STAR • R TO RESTART',
        style: {
            font: '650 12px system-ui, sans-serif',
            fillStyle: '#9cecff',
            strokeStyle: '#071022',
            strokeWidth: 4,
            padding: 6,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage);

    const starPositions = [
        [0.2, 0.3],
        [0.78, 0.28],
        [0.72, 0.72],
        [0.28, 0.76],
        [0.5, 0.46]
    ] as const;
    const keys = new Set<string>();
    let state: GameState = 'playing';
    let score = 0;

    function placeStar(): void {
        const position = starPositions[score % starPositions.length];
        if (!position) throw new Error('Starter star positions are incomplete.');
        star.setPosition(stage.width * position[0], stage.height * position[1], 10);
    }

    function restart(): void {
        state = 'playing';
        score = 0;
        exitRing.visible = false;
        star.visible = true;
        player.setPosition(stage.width * 0.5, stage.height * 0.68, 20);
        scoreLabel.setText('STARS 0 / 5');
        hintLabel.setText('WASD / ARROWS TO MOVE • TAP THE STAR • R TO RESTART');
        placeStar();
    }

    function collectStar(): void {
        if (state !== 'playing') return;
        score += 1;
        scoreLabel.setText(`STARS ${String(score)} / 5`);
        if (score >= 5) {
            state = 'won';
            star.visible = false;
            exitRing.visible = true;
            exitRing.setPosition(player.x, player.y, 5);
            hintLabel.setText('YOU FOUND THE CONSTELLATION • PRESS R TO PLAY AGAIN');
            return;
        }
        placeStar();
    }

    function overlaps(left: Hilo3d.Sprite, right: Hilo3d.Sprite): boolean {
        return (
            Math.abs(left.x - right.x) * 2 < left.width + right.width &&
            Math.abs(left.y - right.y) * 2 < left.height + right.height
        );
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

    star.on('click', collectStar);
    player.on('click', () => {
        player.tint.set(0.75, 1, 1, 1);
    });
    stage.enableDOMEvent('click');

    const game: Hilo3d.Tickable = {
        tick(dtMilliseconds): void {
            const dt = Math.min(dtMilliseconds, 50) / 1000;
            star.rotationZ += dt * 90;
            exitRing.rotationZ -= dt * 70;
            if (state !== 'playing') return;

            let directionX =
                Number(keys.has('KeyD') || keys.has('ArrowRight')) -
                Number(keys.has('KeyA') || keys.has('ArrowLeft'));
            let directionY =
                Number(keys.has('KeyS') || keys.has('ArrowDown')) -
                Number(keys.has('KeyW') || keys.has('ArrowUp'));
            const length = Math.hypot(directionX, directionY);
            if (length > 0) {
                directionX /= length;
                directionY /= length;
            }

            const speed = 260;
            player.x = Math.max(28, Math.min(stage.width - 28, player.x + directionX * speed * dt));
            player.y = Math.max(
                86,
                Math.min(stage.height - 56, player.y + directionY * speed * dt)
            );
            player.rotationZ += directionX * dt * 70;
            if (overlaps(player, star)) collectStar();
        }
    };

    function resize(): void {
        const width = Math.max(1, innerWidth);
        const height = Math.max(1, innerHeight);
        stage.resize(width, height, Math.min(devicePixelRatio || 1, 2));
        camera.resize(width, height);
        scoreLabel.setPosition(width * 0.5, 18, 30);
        hintLabel.setPosition(width * 0.5, height - 36, 30);
        if (player.x === 0 && player.y === 0) restart();
        else {
            player.x = Math.min(player.x, width - 28);
            player.y = Math.min(player.y, height - 56);
            placeStar();
        }
    }

    window.addEventListener('resize', resize);
    resize();

    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(game);
    ticker.addTick(stage);
    ticker.start();
    document.querySelector('#loading')?.remove();
    console.info(`Hilo3D 2D starter uses ${stage.renderer.backend}`);

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
