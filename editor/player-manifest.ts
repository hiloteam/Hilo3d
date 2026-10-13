import type { ProjectDocument } from './project';

/** Static deployment settings. IDs are checked against the same project the Player loads. */
export interface PlayerManifest {
    format: 'hilo3d-player';
    version: 1;
    engineVersion: string;
    title: string;
    startSceneId: string;
    cameras: Record<string, string>;
    clips: Record<string, string>;
    showControls: boolean;
}

export function createPlayerManifest(
    project: ProjectDocument,
    engineVersion: string
): PlayerManifest {
    const cameras: Record<string, string> = {};
    const clips: Record<string, string> = {};
    for (const [id, scene] of Object.entries(project.scenes)) {
        const camera = Object.entries(scene.nodes).find(
            ([, node]) => node.type === 'camera' && node.visible
        );
        if (camera) cameras[id] = camera[0];
        const clip = Object.values(project.clips).find(value => value.sceneId === id);
        if (clip) clips[id] = clip.id;
    }
    return {
        format: 'hilo3d-player',
        version: 1,
        engineVersion,
        title: project.name,
        startSceneId: project.activeSceneId,
        cameras,
        clips,
        showControls: true
    };
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid Player settings');
    return value as Record<string, unknown>;
}

export function validatePlayerManifest(value: unknown, project: ProjectDocument): PlayerManifest {
    const input = record(value);
    const keys = [
        'format',
        'version',
        'engineVersion',
        'title',
        'startSceneId',
        'cameras',
        'clips',
        'showControls'
    ];
    if (
        Object.keys(input).some(key => !keys.includes(key)) ||
        input['format'] !== 'hilo3d-player' ||
        input['version'] !== 1
    )
        throw new Error('Unsupported Player manifest');
    const title = input['title'];
    const engineVersion = input['engineVersion'];
    const startSceneId = input['startSceneId'];
    if (typeof title !== 'string' || !title.trim() || title.length > 120)
        throw new Error('Player title must contain 1–120 characters');
    if (typeof engineVersion !== 'string' || !engineVersion || engineVersion.length > 64)
        throw new Error('Player engine version is missing');
    if (typeof startSceneId !== 'string' || !Object.hasOwn(project.scenes, startSceneId))
        throw new Error('Player start scene is missing');
    if (typeof input['showControls'] !== 'boolean')
        throw new Error('Player controls setting must be boolean');
    const cameras: Record<string, string> = {};
    const clips: Record<string, string> = {};
    for (const [sceneId, cameraId] of Object.entries(record(input['cameras']))) {
        const scene = Object.hasOwn(project.scenes, sceneId) ? project.scenes[sceneId] : undefined;
        if (
            !scene ||
            typeof cameraId !== 'string' ||
            !Object.hasOwn(scene.nodes, cameraId) ||
            scene.nodes[cameraId]?.type !== 'camera'
        )
            throw new Error(`Player camera for ${sceneId} is missing`);
        cameras[sceneId] = cameraId;
    }
    for (const [sceneId, clipId] of Object.entries(record(input['clips']))) {
        if (
            !Object.hasOwn(project.scenes, sceneId) ||
            typeof clipId !== 'string' ||
            !Object.hasOwn(project.clips, clipId) ||
            project.clips[clipId]?.sceneId !== sceneId
        )
            throw new Error(`Player animation for ${sceneId} is missing`);
        clips[sceneId] = clipId;
    }
    return {
        format: 'hilo3d-player',
        version: 1,
        engineVersion,
        title,
        startSceneId,
        cameras,
        clips,
        showControls: input['showControls']
    };
}
