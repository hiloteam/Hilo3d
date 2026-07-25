import * as Hilo3d from '../src/Hilo3d';
import { resolveExampleBackend } from './shared/backend';

const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 768;
const TILE_SIZE = 64;
const MAP_COLUMNS = WORLD_WIDTH / TILE_SIZE;
const MAP_ROWS = WORLD_HEIGHT / TILE_SIZE;
const WORLD_SORTING_LAYER = 10;
const CHARACTER_SPEED = 132;
const FRAME_DURATION = 120;

const WALKABLE_MAP = [
    '....................',
    '.........##.........',
    '..#########.........',
    '..#########.........',
    '...##..######.......',
    '####################',
    '####################',
    '.......######..##...',
    '.........#########..',
    '.........#########..',
    '.........##.........',
    '.........##.........'
] as const;

interface TilePoint {
    readonly column: number;
    readonly row: number;
}

interface TownObject {
    readonly frame: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

const AUTO_DESTINATIONS = [
    { column: 3, row: 2 },
    { column: 10, row: 1 },
    { column: 10, row: 6 },
    { column: 17, row: 8 },
    { column: 15, row: 6 },
    { column: 9, row: 11 },
    { column: 1, row: 6 },
    { column: 7, row: 4 }
] as const satisfies readonly TilePoint[];

const TOWN_OBJECTS = [
    { frame: 0, x: 164, y: 324, width: 200, height: 256 },
    { frame: 1, x: 424, y: 324, width: 200, height: 256 },
    { frame: 2, x: 738, y: 324, width: 200, height: 256 },
    { frame: 3, x: 1042, y: 324, width: 226, height: 258 },
    { frame: 0, x: 1190, y: 324, width: 200, height: 256 },
    { frame: 3, x: 790, y: 744, width: 216, height: 254 },
    { frame: 1, x: 1115, y: 744, width: 220, height: 258 },
    { frame: 4, x: 76, y: 374, width: 138, height: 184 },
    { frame: 4, x: 326, y: 246, width: 126, height: 170 },
    { frame: 5, x: 552, y: 384, width: 132, height: 184 },
    { frame: 4, x: 682, y: 442, width: 130, height: 176 },
    { frame: 5, x: 908, y: 385, width: 132, height: 184 },
    { frame: 4, x: 1210, y: 470, width: 138, height: 184 },
    { frame: 5, x: 875, y: 576, width: 132, height: 184 },
    { frame: 4, x: 1006, y: 608, width: 130, height: 176 },
    { frame: 5, x: 1242, y: 682, width: 128, height: 178 },
    { frame: 6, x: 628, y: 352, width: 104, height: 130 },
    { frame: 6, x: 1008, y: 574, width: 96, height: 120 },
    { frame: 7, x: 290, y: 445, width: 200, height: 256 },
    { frame: 7, x: 744, y: 502, width: 200, height: 256 },
    { frame: 7, x: 1146, y: 514, width: 200, height: 256 }
] as const satisfies readonly TownObject[];

function requireContainer(): HTMLElement {
    const container = document.querySelector<HTMLElement>('#container');
    if (!container) throw new Error('2D sorting town example requires #container.');
    return container;
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D sorting town example requires Canvas 2D.');
    return context;
}

function tileIndex(column: number, row: number): number {
    return row * MAP_COLUMNS + column;
}

function isWalkable(column: number, row: number): boolean {
    if (column < 0 || column >= MAP_COLUMNS || row < 0 || row >= MAP_ROWS) return false;
    return WALKABLE_MAP[row]?.[column] === '#';
}

function tileCenter(tile: TilePoint): readonly [number, number] {
    return [(tile.column + 0.5) * TILE_SIZE, (tile.row + 0.5) * TILE_SIZE];
}

function nearestWalkable(column: number, row: number): TilePoint {
    let bestColumn = 0;
    let bestRow = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let candidateRow = 0; candidateRow < MAP_ROWS; candidateRow += 1) {
        for (let candidateColumn = 0; candidateColumn < MAP_COLUMNS; candidateColumn += 1) {
            if (!isWalkable(candidateColumn, candidateRow)) continue;
            const dx = candidateColumn - column;
            const dy = candidateRow - row;
            const distance = dx * dx + dy * dy;
            if (distance >= bestDistance) continue;
            bestDistance = distance;
            bestColumn = candidateColumn;
            bestRow = candidateRow;
        }
    }
    return { column: bestColumn, row: bestRow };
}

function findPath(start: TilePoint, goal: TilePoint): TilePoint[] {
    const cellCount = MAP_COLUMNS * MAP_ROWS;
    const startIndex = tileIndex(start.column, start.row);
    const goalIndex = tileIndex(goal.column, goal.row);
    const scores = new Float64Array(cellCount);
    scores.fill(Number.POSITIVE_INFINITY);
    scores[startIndex] = 0;
    const previous = new Int32Array(cellCount);
    previous.fill(-1);
    const closed = new Uint8Array(cellCount);
    const open = [startIndex];
    const directions = [-1, 0, 1, 0, -1] as const;

    while (open.length > 0) {
        let bestOpenIndex = 0;
        let current = open[0];
        if (current === undefined) break;
        let currentColumn = current % MAP_COLUMNS;
        let currentRow = Math.floor(current / MAP_COLUMNS);
        let bestEstimate =
            (scores[current] ?? Number.POSITIVE_INFINITY) +
            Math.abs(goal.column - currentColumn) +
            Math.abs(goal.row - currentRow);
        for (let index = 1; index < open.length; index += 1) {
            const candidate = open[index];
            if (candidate === undefined) continue;
            const candidateColumn = candidate % MAP_COLUMNS;
            const candidateRow = Math.floor(candidate / MAP_COLUMNS);
            const estimate =
                (scores[candidate] ?? Number.POSITIVE_INFINITY) +
                Math.abs(goal.column - candidateColumn) +
                Math.abs(goal.row - candidateRow);
            if (estimate >= bestEstimate) continue;
            bestOpenIndex = index;
            current = candidate;
            currentColumn = candidateColumn;
            currentRow = candidateRow;
            bestEstimate = estimate;
        }
        open.splice(bestOpenIndex, 1);
        if (current === goalIndex) break;
        closed[current] = 1;

        for (let directionIndex = 0; directionIndex < 4; directionIndex += 1) {
            const nextColumn = currentColumn + (directions[directionIndex] ?? 0);
            const nextRow = currentRow + (directions[directionIndex + 1] ?? 0);
            if (!isWalkable(nextColumn, nextRow)) continue;
            const next = tileIndex(nextColumn, nextRow);
            if (closed[next] === 1) continue;
            const tentativeScore = (scores[current] ?? Number.POSITIVE_INFINITY) + 1;
            if (tentativeScore >= (scores[next] ?? Number.POSITIVE_INFINITY)) continue;
            scores[next] = tentativeScore;
            previous[next] = current;
            if (!open.includes(next)) open.push(next);
        }
    }

    if (startIndex !== goalIndex && (previous[goalIndex] ?? -1) < 0) return [];
    const reversePath: TilePoint[] = [];
    for (let current = goalIndex; current >= 0; current = previous[current] ?? -1) {
        reversePath.push({
            column: current % MAP_COLUMNS,
            row: Math.floor(current / MAP_COLUMNS)
        });
        if (current === startIndex) break;
    }
    reversePath.reverse();
    return reversePath;
}

function createLoadingGroundTexture(): Hilo3d.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const context = requireContext(canvas);
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#78a85b';
    context.fillRect(0, 0, 4, 4);

    return new Hilo3d.Texture({
        image: canvas,
        flipY: true,
        premultiplyAlpha: false,
        minFilter: Hilo3d.constants.webgl.NEAREST,
        magFilter: Hilo3d.constants.webgl.NEAREST,
        wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        name: 'SortingTown:loading-ground'
    });
}

function createMarkerTexture(): Hilo3d.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = requireContext(canvas);
    context.imageSmoothingEnabled = false;
    context.strokeStyle = '#fff2a8';
    context.lineWidth = 7;
    context.beginPath();
    context.ellipse(32, 38, 22, 11, 0, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = '#8a522d';
    context.lineWidth = 3;
    context.beginPath();
    context.ellipse(32, 38, 22, 11, 0, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#fff2a8';
    context.fillRect(29, 8, 6, 19);
    context.fillRect(23, 14, 18, 6);
    return new Hilo3d.Texture({
        image: canvas,
        flipY: true,
        premultiplyAlpha: true,
        minFilter: Hilo3d.constants.webgl.NEAREST,
        magFilter: Hilo3d.constants.webgl.NEAREST,
        wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        name: 'SortingTown:destination'
    });
}

async function loadPixelTexture(
    url: URL,
    name: string,
    premultiplyAlpha = true
): Promise<Hilo3d.Texture> {
    const image = await new Hilo3d.BasicLoader().loadImg(url.href);
    return new Hilo3d.Texture({
        image,
        flipY: true,
        premultiplyAlpha,
        minFilter: Hilo3d.constants.webgl.NEAREST,
        magFilter: Hilo3d.constants.webgl.NEAREST,
        wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        name
    });
}

function createGridFrames(
    texture: Hilo3d.Texture,
    columns: number,
    rows: number
): Hilo3d.SpriteFrame[] {
    const width = texture.origWidth / columns;
    const height = texture.origHeight / rows;
    const frames: Hilo3d.SpriteFrame[] = [];
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            frames.push(
                new Hilo3d.SpriteFrame({
                    texture,
                    x: column * width,
                    y: row * height,
                    width,
                    height
                })
            );
        }
    }
    return frames;
}

const camera = new Hilo3d.Camera2D({
    width: innerWidth,
    height: innerHeight,
    priority: 0,
    clearColor: true
});
const stage = await Hilo3d.Stage.create({
    backend: resolveExampleBackend(),
    container: requireContainer(),
    cameras: [camera],
    width: innerWidth,
    height: innerHeight,
    pixelRatio: Math.min(devicePixelRatio || 1, 2),
    antialias: false,
    alpha: false,
    useInstanced: true,
    clearColor: new Hilo3d.Color(0.04, 0.09, 0.08)
});
const world = new Hilo3d.Node({ name: 'SortingTownWorld' }).addTo(stage);
let worldScale = 1;

const loadingGround = new Hilo3d.Sprite({
    texture: createLoadingGroundTexture(),
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    anchorX: 0,
    anchorY: 0,
    sortingLayer: -100,
    pointerEnabled: false,
    autoPlay: false
}).addTo(world);

// Present the inexpensive tile map immediately while the authored atlases load. This keeps the
// cold WebGPU path responsive without introducing a backend-specific loading route.
const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();

const [groundTexture, objectTexture, courierTexture] = await Promise.all([
    loadPixelTexture(
        new URL('./image/2d/sorting-town-ground.png', import.meta.url),
        'SortingTown:ground',
        false
    ),
    loadPixelTexture(
        new URL('./image/2d/sorting-town-objects.png', import.meta.url),
        'SortingTown:objects'
    ),
    loadPixelTexture(
        new URL('./image/2d/sorting-town-courier.png', import.meta.url),
        'SortingTown:courier'
    )
]);
loadingGround.removeFromParent();
new Hilo3d.Sprite({
    texture: groundTexture,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    anchorX: 0,
    anchorY: 0,
    sortingLayer: -100,
    pointerEnabled: false,
    autoPlay: false
}).addTo(world);
const objectFrames = createGridFrames(objectTexture, 4, 2);
const courierFrames = createGridFrames(courierTexture, 4, 4);

const destinationMarker = new Hilo3d.Sprite({
    texture: createMarkerTexture(),
    width: 54,
    height: 54,
    anchorX: 0.5,
    anchorY: 0.72,
    sortingLayer: WORLD_SORTING_LAYER,
    zIndex: 0,
    pointerEnabled: false,
    autoPlay: false
}).addTo(world);

for (const object of TOWN_OBJECTS) {
    const frame = objectFrames[object.frame];
    if (!frame) {
        throw new Error(`Sorting town object frame ${String(object.frame)} is missing.`);
    }
    new Hilo3d.Sprite({
        frame,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        anchorX: 0.5,
        anchorY: 1,
        sortingLayer: WORLD_SORTING_LAYER,
        zIndex: object.y,
        pointerEnabled: false,
        autoPlay: false
    }).addTo(world);
}

const startTile: TilePoint = { column: 1, row: 5 };
const [startX, startY] = tileCenter(startTile);
const courier = new Hilo3d.Sprite({
    frames: courierFrames,
    x: startX,
    y: startY,
    width: 76,
    height: 96,
    anchorX: 0.5,
    anchorY: 1,
    sortingLayer: WORLD_SORTING_LAYER,
    zIndex: startY,
    pointerEnabled: false,
    autoPlay: false
}).addTo(world);

const title = new Hilo3d.Text2D({
    text: 'MAPLE POST TOWN',
    style: {
        font: '800 27px ui-monospace, monospace',
        fillStyle: '#fff1bb',
        strokeStyle: '#2c4638',
        strokeWidth: 6,
        padding: 9,
        resolution: 2,
        textAlign: 'center'
    },
    anchorX: 0.5,
    anchorY: 0,
    sortingLayer: 100
}).addTo(stage);
const status = new Hilo3d.Text2D({
    text: 'A* DELIVERY ROUTE  •  CLICK A ROAD TILE',
    style: {
        font: '700 12px ui-monospace, monospace',
        fillStyle: '#f8e3a3',
        strokeStyle: '#263e33',
        strokeWidth: 5,
        padding: 7,
        resolution: 2,
        textAlign: 'center'
    },
    anchorX: 0.5,
    anchorY: 1,
    sortingLayer: 100
}).addTo(stage);
const backendLabel = new Hilo3d.Text2D({
    text: `${stage.renderer.backend.toUpperCase()}  •  FOOT-Y ZINDEX  •  STABLE ATLAS BATCHES`,
    style: {
        font: '700 10px ui-monospace, monospace',
        fillStyle: '#b9ebd1',
        strokeStyle: '#263e33',
        strokeWidth: 4,
        padding: 5,
        resolution: 2,
        textAlign: 'center'
    },
    anchorX: 0.5,
    anchorY: 1,
    sortingLayer: 100
}).addTo(stage);

let route: readonly TilePoint[] = [];
let routeIndex = 1;
let currentDirectionRow = 0;
let walkFrame = 0;
let frameElapsed = 0;
let waitRemaining = 0;
let nextAutoDestination = 0;

function setCourierFrame(row: number, frame: number): void {
    const frameIndex = row * 4 + frame;
    if (courier.currentFrame !== frameIndex) courier.gotoFrame(frameIndex);
}

function planRoute(destination: TilePoint, clicked: boolean): void {
    const currentTile = nearestWalkable(
        Math.floor(courier.x / TILE_SIZE),
        Math.floor(courier.y / TILE_SIZE)
    );
    route = findPath(currentTile, destination);
    routeIndex = 1;
    waitRemaining = 0;
    const [targetX, targetY] = tileCenter(destination);
    destinationMarker.setPosition(targetX, targetY, 0);
    destinationMarker.zIndex = targetY - 1;
    destinationMarker.visible = route.length > 1;
    status.setText(
        clicked
            ? `PLAYER ROUTE  •  ${String(Math.max(0, route.length - 1))} A* STEPS`
            : `AUTO DELIVERY  •  ${String(Math.max(0, route.length - 1))} A* STEPS`
    );
}

const courierController = {
    tick(deltaTime: number): void {
        const safeDelta = Math.min(Math.max(deltaTime, 0), 50);
        if (routeIndex >= route.length) {
            if (route.length > 0) {
                route = [];
                destinationMarker.visible = false;
                waitRemaining = 650;
                walkFrame = 0;
                setCourierFrame(currentDirectionRow, walkFrame);
                status.setText('DELIVERY COMPLETE  •  CHOOSING NEXT STOP');
            } else if (waitRemaining > 0) {
                waitRemaining -= safeDelta;
            } else {
                const destination =
                    AUTO_DESTINATIONS[nextAutoDestination % AUTO_DESTINATIONS.length];
                nextAutoDestination += 1;
                if (destination) planRoute(destination, false);
            }
            return;
        }

        let remainingDistance = (CHARACTER_SPEED * safeDelta) / 1000;
        while (remainingDistance > 0 && routeIndex < route.length) {
            const target = route[routeIndex];
            if (!target) break;
            const [targetX, targetY] = tileCenter(target);
            const dx = targetX - courier.x;
            const dy = targetY - courier.y;
            const distance = Math.hypot(dx, dy);
            if (Math.abs(dx) >= Math.abs(dy)) currentDirectionRow = dx < 0 ? 2 : 1;
            else currentDirectionRow = dy < 0 ? 3 : 0;
            if (distance <= remainingDistance || distance < 0.001) {
                courier.x = targetX;
                courier.y = targetY;
                remainingDistance -= distance;
                routeIndex += 1;
            } else {
                courier.x += (dx / distance) * remainingDistance;
                courier.y += (dy / distance) * remainingDistance;
                remainingDistance = 0;
            }
        }
        courier.zIndex = Math.round(courier.y);
        frameElapsed += safeDelta;
        if (frameElapsed >= FRAME_DURATION) {
            frameElapsed %= FRAME_DURATION;
            walkFrame = (walkFrame + 1) % 4;
        }
        setCourierFrame(currentDirectionRow, walkFrame);
    }
};

stage.on('click', event => {
    const pointer = event as Hilo3d.StagePointerEvent;
    const localX = (pointer.stageX - world.x) / worldScale;
    const localY = (pointer.stageY - world.y) / worldScale;
    const destination = nearestWalkable(
        Math.floor(localX / TILE_SIZE),
        Math.floor(localY / TILE_SIZE)
    );
    planRoute(destination, true);
});
stage.enableDOMEvent('click');

function resize(): void {
    const width = innerWidth;
    const height = innerHeight;
    stage.resize(width, height);
    camera.resize(width, height);
    worldScale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    world.setScale(worldScale);
    world.setPosition(
        Math.round((width - WORLD_WIDTH * worldScale) * 0.5),
        Math.round((height - WORLD_HEIGHT * worldScale) * 0.5),
        0
    );
    title.setScale(Math.min(1, width / 600));
    title.setPosition(width * 0.5, 18, 0);
    status.setScale(Math.min(1, width / 650));
    status.setPosition(width * 0.5, height - 14, 0);
    backendLabel.setScale(Math.min(1, width / 650));
    backendLabel.setPosition(width * 0.5, height - 48, 0);
}
window.addEventListener('resize', resize);
resize();

ticker.removeTick(stage);
ticker.addTick(courierController);
ticker.addTick(stage);
planRoute(AUTO_DESTINATIONS[0], false);
nextAutoDestination = 1;
document.querySelector<HTMLElement>('#loading')?.remove();
document.body.dataset['exampleReady'] = 'true';
console.info(`2D sorting town uses ${stage.renderer.backend}`);
