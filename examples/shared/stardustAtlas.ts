import * as Hilo3d from '../../src/Hilo3d';

/** An actual transparent bitmap atlas designed for small, densely layered sprites. */
export function createStardustAtlas(): Hilo3d.Texture<HTMLCanvasElement> {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Stardust requires Canvas 2D.');
    for (let index = 0; index < 16; index++) {
        const x = (index % 4) * 64 + 32;
        const y = Math.floor(index / 4) * 64 + 32;
        context.save();
        context.translate(x, y);
        if (index >= 12) context.rotate(((index % 4) * Math.PI) / 4);
        const radius = 24;
        const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius);
        glow.addColorStop(0, 'rgba(255,255,255,1)');
        glow.addColorStop(0.12, 'rgba(255,255,255,.92)');
        glow.addColorStop(0.3, 'rgba(255,255,255,.3)');
        glow.addColorStop(0.6, 'rgba(255,255,255,.06)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = glow;
        if (index >= 8 && index < 12) context.scale(1, 0.45);
        context.fillRect(-radius, -radius, radius * 2, radius * 2);
        if (index >= 4 && index < 8) {
            context.fillStyle = 'rgba(255,255,255,.9)';
            context.beginPath();
            for (let point = 0; point < 8; point++) {
                const angle = (point * Math.PI) / 4;
                const length = point % 2 === 0 ? 15 + (index % 4) * 2 : 2;
                const px = Math.cos(angle) * length;
                const py = Math.sin(angle) * length;
                if (point === 0) context.moveTo(px, py);
                else context.lineTo(px, py);
            }
            context.closePath();
            context.fill();
        }
        if (index >= 12) {
            const trail = context.createLinearGradient(-24, 0, 24, 0);
            trail.addColorStop(0, 'rgba(255,255,255,0)');
            trail.addColorStop(0.5, 'rgba(255,255,255,.8)');
            trail.addColorStop(1, 'rgba(255,255,255,0)');
            context.fillStyle = trail;
            context.fillRect(-24, -1, 48, 2);
        }
        context.restore();
    }
    return new Hilo3d.Texture({
        image: canvas,
        flipY: true,
        premultiplyAlpha: false,
        internalFormat: Hilo3d.constants.SRGB8_ALPHA8,
        minFilter: Hilo3d.constants.webgl.LINEAR,
        magFilter: Hilo3d.constants.webgl.LINEAR,
        name: 'Stardust:light-motes-atlas'
    });
}
