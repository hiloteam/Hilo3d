import * as Hilo3d from '../src/Hilo3d';
import { createStudio, createStudioScene, createStudioAtlas } from './shared/studio2d';

const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 768;
const TILE_SIZE = 32;
const ROAD_TILE_SIZE = 64;
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
    { column: 3, row: 11 },
    { column: 13, row: 11 },
    { column: 24, row: 11 },
    { column: 32, row: 9 },
    { column: 36, row: 17 },
    { column: 25, row: 17 },
    { column: 19, row: 22 },
    { column: 9, row: 18 }
] as const satisfies readonly TilePoint[];

// Every object rectangle is tightly authored around visible pixels. Its bottom is the ground contact.
const OBJECT_RECTS = [
    [29, 61, 151, 189],
    [25, 61, 153, 188],
    [17, 79, 151, 168],
    [7, 58, 155, 196],
    [35, 26, 142, 154],
    [39, 6, 111, 174],
    [13, 44, 140, 126],
    [15, 70, 123, 112]
] as const;
const TOWN_OBJECTS = [
    // North market: three distinct entrances face the broad east-west street.
    { frame: 0, x: 112, y: 306, width: 168, height: 210 },
    { frame: 1, x: 428, y: 306, width: 180, height: 221 },
    { frame: 3, x: 770, y: 306, width: 174, height: 220 },
    // South-east block: doors open onto the lower loop, roofs can occlude the street behind.
    { frame: 2, x: 812, y: 502, width: 170, height: 189 },
    { frame: 0, x: 1166, y: 502, width: 164, height: 205 },
    // Maple Green: two flowerbeds mark the entry; the central lawn stays open.
    { frame: 7, x: 195, y: 493, width: 96, height: 87 },
    { frame: 7, x: 438, y: 493, width: 96, height: 87 },
    { frame: 6, x: 334, y: 496, width: 66, height: 59 },
    { frame: 4, x: 68, y: 546, width: 112, height: 122 },
    { frame: 4, x: 510, y: 604, width: 108, height: 117 },
    { frame: 5, x: 73, y: 735, width: 86, height: 135 },
    { frame: 4, x: 206, y: 736, width: 111, height: 120 },
    { frame: 5, x: 435, y: 739, width: 88, height: 138 },
    // Northern greenery and lake shore, clear of entrances and the central avenue.
    { frame: 4, x: 65, y: 118, width: 98, height: 106 },
    { frame: 5, x: 469, y: 122, width: 64, height: 100 },
    { frame: 4, x: 731, y: 105, width: 86, height: 93 },
    { frame: 4, x: 936, y: 293, width: 97, height: 105 },
    { frame: 5, x: 1230, y: 292, width: 79, height: 124 },
    { frame: 6, x: 1072, y: 293, width: 65, height: 59 },
    // The southern lane has a planted edge, with no ornaments in the carriageway.
    { frame: 7, x: 975, y: 671, width: 91, height: 83 },
    { frame: 4, x: 760, y: 744, width: 111, height: 120 },
    { frame: 5, x: 1146, y: 741, width: 84, height: 132 },
    { frame: 4, x: 1216, y: 648, width: 100, height: 108 }
] as const satisfies readonly TownObject[];
const SORTING_DEMO_PROP = TOWN_OBJECTS[5];

interface Footprint {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}
const FOOTPRINTS: readonly Footprint[] = TOWN_OBJECTS.map(object => {
    const width =
        object.frame < 4
            ? object.width * 0.84
            : object.frame < 6
              ? 28
              : object.frame === 6
                ? object.width * 0.8
                : object.width * 0.82;
    const depth = object.frame < 4 ? 48 : object.frame < 6 ? 20 : object.frame === 6 ? 14 : 30;
    return {
        left: object.x - width / 2,
        right: object.x + width / 2,
        top: object.y - depth,
        bottom: object.y
    };
});

/** Conservative tile/footprint overlap prevents movement segments from crossing physical bases. */
function createWalkableMask(): Uint8Array {
    const mask = new Uint8Array(MAP_COLUMNS * MAP_ROWS);
    for (let row = 0; row < MAP_ROWS; row++) {
        for (let column = 0; column < MAP_COLUMNS; column++) {
            const left = column * TILE_SIZE;
            const top = row * TILE_SIZE;
            const obstructed = FOOTPRINTS.some(
                footprint =>
                    left < footprint.right + 8 &&
                    left + TILE_SIZE > footprint.left - 8 &&
                    top < footprint.bottom + 8 &&
                    top + TILE_SIZE > footprint.top - 8
            );
            // Grass is traversable; the lake and a narrow map boundary remain excluded.
            const closestLakeX = Math.max(left, Math.min(left + TILE_SIZE, 1005));
            const closestLakeY = Math.max(top, Math.min(top + TILE_SIZE, 118));
            const lake =
                ((closestLakeX - 1005) / 209) ** 2 + ((closestLakeY - 118) / 132) ** 2 <= 1;
            const insideMap =
                column > 0 && row > 0 && column < MAP_COLUMNS - 1 && row < MAP_ROWS - 1;
            if (insideMap && !lake && !obstructed) mask[row * MAP_COLUMNS + column] = 1;
        }
    }
    // Route endpoints must belong to the connected road network around the central plaza.
    const start = 12 * MAP_COLUMNS + 19;
    const queue = [start];
    if (!mask[start]) throw new Error('Town plaza must remain walkable.');
    const reachable = new Uint8Array(mask.length);
    reachable[start] = 1;
    for (const cell of queue) {
        const column = cell % MAP_COLUMNS;
        const row = Math.floor(cell / MAP_COLUMNS);
        for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1]
        ] as const) {
            const nextColumn = column + dx;
            const nextRow = row + dy;
            if (nextColumn < 0 || nextRow < 0 || nextColumn >= MAP_COLUMNS || nextRow >= MAP_ROWS)
                continue;
            const next = nextRow * MAP_COLUMNS + nextColumn;
            if (mask[next] && !reachable[next]) {
                reachable[next] = 1;
                queue.push(next);
            }
        }
    }
    return reachable;
}
const WALKABLE_CELLS = createWalkableMask();
function roadCost(column: number, row: number): number {
    const roadColumn = Math.floor((column * TILE_SIZE) / ROAD_TILE_SIZE);
    const roadRow = Math.floor((row * TILE_SIZE) / ROAD_TILE_SIZE);
    return WALKABLE_MAP[roadRow]?.[roadColumn] === '#' ? 1 : 1.8;
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
    return WALKABLE_CELLS[row * MAP_COLUMNS + column] === 1;
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
            const tentativeScore =
                (scores[current] ?? Number.POSITIVE_INFINITY) + roadCost(nextColumn, nextRow);
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
    premultiplyAlpha = false
): Promise<Hilo3d.Texture> {
    const image = await new Hilo3d.BasicLoader().loadImg(url.href);
    return new Hilo3d.Texture({
        image,
        internalFormat: Hilo3d.constants.SRGB8_ALPHA8,
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

const studio = createStudio(5);
const scene = await createStudioScene(studio);
const { stage, ticker } = scene;
const world = new Hilo3d.Node({ name: 'SortingTownWorld' }).addTo(stage);
let worldScale = 1;

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
        new URL('./image/2d/sorting-town-yui.png', import.meta.url),
        'SortingTown:YuiHirasawa'
    )
]);
const ground = new Hilo3d.Sprite({
    texture: groundTexture,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    anchorX: 0,
    anchorY: 0,
    sortingLayer: -100,
    pointerEnabled: false,
    autoPlay: false
}).addTo(world);
const objectFrames = OBJECT_RECTS.map(
    ([x, y, width, height], index) =>
        new Hilo3d.SpriteFrame({
            texture: objectTexture,
            x: (index % 4) * 192 + x,
            y: Math.floor(index / 4) * 256 + y,
            width,
            height
        })
);
const courierFrames = createGridFrames(courierTexture, 4, 4);
// Per-frame visible sole positions, including half-pixel grid origins of the 1254 px sheet.
// Sprite position always remains the ground contact; artwork padding never enters Y sorting.
const COURIER_SOLES = [
    304, 300, 304, 300, 300.5, 297.5, 300.5, 297.5, 301, 297, 300, 300, 283.5, 283.5, 280.5, 283.5
] as const;

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

const townSprites: Hilo3d.Sprite[] = [];
for (const object of TOWN_OBJECTS) {
    const frame = objectFrames[object.frame];
    if (!frame) {
        throw new Error(`Sorting town object frame ${String(object.frame)} is missing.`);
    }
    townSprites.push(
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
        }).addTo(world)
    );
}

const startTile: TilePoint = nearestWalkable(19, 12);
const [startX, startY] = tileCenter(startTile);
const courier = new Hilo3d.Sprite({
    frames: courierFrames,
    x: startX,
    y: startY,
    width: 92,
    height: 108,
    anchorX: 0.5,
    anchorY: COURIER_SOLES[0] / (courierTexture.origHeight / 4),
    sortingLayer: WORLD_SORTING_LAYER,
    zIndex: startY,
    pointerEnabled: false,
    autoPlay: false
}).addTo(world);

const status = {
    setText(text: string): void {
        studio.status.textContent = text;
    }
};
const uiAtlas = createStudioAtlas();
const pathDots = Array.from({ length: 80 }, () =>
    new Hilo3d.Sprite({
        frame: uiAtlas.frames.up,
        width: 10,
        height: 10,
        visible: false,
        sortingLayer: 0,
        pointerEnabled: false,
        tint: new Hilo3d.Color(1, 0.85, 0.5, 0.8)
    }).addTo(world)
);
const footprintCanvas = document.createElement('canvas');
footprintCanvas.width = footprintCanvas.height = 32;
const footprintContext = requireContext(footprintCanvas);
footprintContext.fillStyle = 'rgba(85,230,190,.16)';
footprintContext.fillRect(0, 0, 32, 32);
footprintContext.strokeStyle = '#7bffd5';
footprintContext.lineWidth = 2;
footprintContext.strokeRect(1, 1, 30, 30);
const footprintTexture = new Hilo3d.Texture({
    image: footprintCanvas,
    flipY: true,
    premultiplyAlpha: false
});
const footprintGuides = new Hilo3d.Node({ visible: false }).addTo(world);
for (const footprint of FOOTPRINTS) {
    new Hilo3d.Sprite({
        texture: footprintTexture,
        anchorX: 0,
        anchorY: 1,
        x: footprint.left,
        y: footprint.bottom,
        width: footprint.right - footprint.left,
        height: footprint.bottom - footprint.top,
        sortingLayer: 50,
        pointerEnabled: false
    }).addTo(footprintGuides);
}
let automatic = true;
let sorting = true;
let showRoute = true;
let speed = 1;
let pose = '自由寻路';
studio.section(
    'AN AFTERNOON DELIVERY',
    '沿主街逛商店，或走入西南花园。点击空地规划路径，道路具有更低通行成本。'
);
studio.toggle('自动巡游', automatic, value => {
    automatic = value;
});
studio.toggle('启用脚底 Y 排序', sorting, value => {
    sorting = value;
    townSprites.forEach(sprite => {
        sprite.zIndex = value ? sprite.y : 0;
    });
    courier.zIndex = value ? courier.y : 1000;
    document.body.dataset['sorting'] = String(value);
});
studio.toggle('显示实体底座', false, value => {
    footprintGuides.visible = value;
});
studio.toggle('显示路径', showRoute, value => {
    showRoute = value;
    updatePathDots();
});
studio.range(
    '行走速度',
    0.5,
    2,
    1,
    0.1,
    value => {
        speed = value;
    },
    '×'
);
studio.select('时光色调', ['Afternoon', 'Golden hour', 'Blue hour'], 'Afternoon', value => {
    const tint =
        value === 'Golden hour'
            ? [1, 0.83, 0.59]
            : value === 'Blue hour'
              ? [0.52, 0.7, 0.92]
              : [1, 1, 1];
    for (const sprite of [ground, ...townSprites, courier])
        sprite.tint.set(tint[0] ?? 1, tint[1] ?? 1, tint[2] ?? 1, 1);
});
studio.section(
    'A WORLD IN LAYERS',
    '关闭排序作对照：角色会一直盖在建筑和树木上。图集动画随行走方向切换。'
);
studio.select('角色位置对照', ['自由寻路', '花坛后方', '花坛前方'], pose, value => {
    pose = value;
    route = [];
    routeIndex = 0;
    destinationMarker.visible = false;
    updatePathDots();
    if (value !== '自由寻路') {
        courier.setPosition(
            SORTING_DEMO_PROP.x,
            value === '花坛后方' ? SORTING_DEMO_PROP.y - 40 : SORTING_DEMO_PROP.y + 30,
            0
        );
        courier.zIndex = sorting ? courier.y : 1000;
        setCourierFrame(0, 0);
    } else {
        const tile = nearestWalkable(
            Math.floor(courier.x / TILE_SIZE),
            Math.floor(courier.y / TILE_SIZE)
        );
        const [x, y] = tileCenter(tile);
        courier.setPosition(x, y, 0);
    }
    document.body.dataset['townPose'] = value;
    status.setText(
        value === '自由寻路'
            ? '点击道路或草地规划路径，或开启自动巡游。'
            : `${value} · 对照角色脚底与花坛底座`
    );
});
const yMetric = studio.metric('角色脚底 Y', '416');
const stepsMetric = studio.metric('剩余路径节点', '0');
studio.metric('角色', '平泽唯 / Yui Hirasawa');
studio.metric('行走图集', '4 directions × 4 frames');
document.body.dataset['townCharacter'] = 'yui-hirasawa';
studio.metric('场景对象', String(TOWN_OBJECTS.length));
studio.metric('寻路约束', '32 px 网格 / 草地可通行');
document.body.dataset['townPose'] = pose;
document.body.dataset['sorting'] = 'true';
let route: readonly TilePoint[] = [];
let routeIndex = 1;
let currentDirectionRow = 0;
let walkFrame = 0;
let frameElapsed = 0;
let waitRemaining = 0;
let nextAutoDestination = 0;

function updatePathDots(): void {
    pathDots.forEach((dot, index) => {
        const tile = route[index + routeIndex];
        dot.visible = showRoute && tile !== undefined;
        if (tile) {
            const [x, y] = tileCenter(tile);
            dot.setPosition(x, y, 0);
        }
    });
}

function setCourierFrame(row: number, frame: number): void {
    const frameIndex = row * 4 + frame;
    if (courier.currentFrame !== frameIndex) courier.gotoFrame(frameIndex);
    const sole = COURIER_SOLES[frameIndex];
    if (sole !== undefined) courier.anchorY = sole / (courierTexture.origHeight / 4);
}

function planRoute(destination: TilePoint, clicked: boolean): void {
    const currentTile = nearestWalkable(
        Math.floor(courier.x / TILE_SIZE),
        Math.floor(courier.y / TILE_SIZE)
    );
    route = findPath(currentTile, destination);
    routeIndex = 1;
    waitRemaining = 0;
    updatePathDots();
    document.body.dataset['routeMode'] = clicked ? 'player' : 'auto';
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
        const safeDelta = Math.min(Math.max(deltaTime, 0), 50) * speed;
        yMetric.value = String(Math.round(courier.y));
        stepsMetric.value = String(Math.max(0, route.length - routeIndex));
        updatePathDots();
        if (pose !== '自由寻路') return;
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
            } else if (automatic) {
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
            // Map movement to the authored top-left atlas row contract.
            if (Math.abs(dx) >= Math.abs(dy)) currentDirectionRow = dx < 0 ? 1 : 2;
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
        courier.zIndex = sorting ? Math.round(courier.y) : 1000;
        frameElapsed += safeDelta;
        if (frameElapsed >= FRAME_DURATION) {
            frameElapsed %= FRAME_DURATION;
            walkFrame = (walkFrame + 1) % 4;
        }
        setCourierFrame(currentDirectionRow, walkFrame);
    }
};

stage.on('click', event => {
    if (pose !== '自由寻路') return;
    const pointer = event as Hilo3d.StagePointerEvent;
    const localX = (pointer.stageX - world.x) / worldScale;
    const localY = (pointer.stageY - world.y) / worldScale;
    if (localX < 0 || localY < 0 || localX > WORLD_WIDTH || localY > WORLD_HEIGHT) return;
    const destination = nearestWalkable(
        Math.floor(localX / TILE_SIZE),
        Math.floor(localY / TILE_SIZE)
    );
    planRoute(destination, true);
});
stage.enableDOMEvent('click');

scene.addLayout((width, height) => {
    worldScale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    world.setScale(worldScale);
    world.setPosition(
        Math.round((width - WORLD_WIDTH * worldScale) * 0.5),
        Math.round((height - WORLD_HEIGHT * worldScale) * 0.5),
        0
    );
});

ticker.addTick(courierController);
planRoute(AUTO_DESTINATIONS[0], false);
nextAutoDestination = 1;
scene.start();
