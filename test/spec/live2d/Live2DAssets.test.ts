import { describe, expect, it, vi } from 'vitest';
import { Texture } from 'hilo3d';
import { loadLive2DAssets } from '../../../addon-live2d/src/Live2DAssets';

const modelUrl = 'https://live2d.test/characters/yui/model.model3.json';

function at<T>(values: ArrayLike<T>, index: number): T {
    const value = values[index];
    if (value === undefined) throw new Error(`Missing Live2D value at index ${String(index)}`);
    return value;
}

function manifest(textures: string[] = ['texture.png']) {
    return {
        Version: 3,
        FileReferences: {
            Moc: 'model.moc3',
            Textures: textures,
            Physics: 'model.physics3.json',
            Pose: 'model.pose3.json',
            DisplayInfo: 'model.cdi3.json',
            Motions: {
                Idle: [{ File: 'motions/idle.motion3.json', FadeInTime: 0.3, Sound: 'idle.wav' }]
            },
            Expressions: [{ Name: 'smile', File: 'smile.exp3.json' }]
        },
        Layout: { Width: 2 },
        Groups: [{ Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen'] }],
        HitAreas: [{ Id: 'head', Name: 'Head' }]
    };
}

async function png(): Promise<Blob> {
    const canvas = new OffscreenCanvas(2, 2);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas 2D unavailable');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 2, 1);
    context.fillStyle = '#0000ff';
    context.fillRect(0, 1, 2, 1);
    return canvas.convertToBlob({ type: 'image/png' });
}

function requests(settings: unknown, image: Blob, onTexture?: (url: string) => void) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === modelUrl) return Promise.resolve(Response.json(settings));
        if (url.endsWith('/model.moc3'))
            return Promise.resolve(new Response(new Uint8Array([77, 79, 67, 51])));
        onTexture?.(url);
        if (url.endsWith('/texture.png')) return Promise.resolve(new Response(image));
        return Promise.resolve(new Response('not found', { status: 404 }));
    });
}

describe('Live2D asset loading and ownership', () => {
    it('versions manifest and every relative or absolute resource using the redirected base', async () => {
        const image = await png();
        const input = 'https://origin.test/model.model3.json?auth=secret&hilo_v=old#entry';
        const redirected = 'https://redirect.test/pack/v6/model.model3.json?redirect_key=r#final';
        const settings = {
            Version: 3,
            FileReferences: {
                Moc: '../model.moc3?format=3#mesh',
                Textures: [
                    'texture.png?quality=high#art',
                    'https://cdn.test/art.png?size=2&hilo_v=old#absolute'
                ],
                Motions: {
                    Idle: [
                        {
                            File: '../idle.motion3.json?motion=idle#curve',
                            Sound: 'https://audio.test/idle.wav?locale=zh#sound'
                        }
                    ]
                },
                Expressions: [{ Name: 'smile', File: 'smile.exp3.json?face=smile#expression' }],
                Physics: 'physics.json?wind=1#rig',
                Pose: 'https://cdn.test/pose.json?pose=default#pose',
                DisplayInfo: '../display.json?lang=en#names'
            }
        };
        const fetch = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation((request: RequestInfo | URL) => {
                const url = new URL(request instanceof Request ? request.url : String(request));
                if (url.hostname === 'origin.test') {
                    const response = Response.json(settings);
                    Object.defineProperty(response, 'url', { value: redirected });
                    return Promise.resolve(response);
                }
                return Promise.resolve(
                    new Response(url.pathname.endsWith('.moc3') ? new Uint8Array([1]) : image)
                );
            });
        const assets = await loadLive2DAssets(input, { assetVersion: 'body v6/blue' });
        const query = '&hilo_v=body+v6%2Fblue';
        try {
            expect(
                fetch.mock.calls.map(call =>
                    call[0] instanceof Request ? call[0].url : String(call[0])
                )
            ).toEqual([
                'https://origin.test/model.model3.json?auth=secret&hilo_v=body+v6%2Fblue#entry',
                `https://redirect.test/pack/model.moc3?format=3${query}#mesh`,
                `https://redirect.test/pack/v6/texture.png?quality=high${query}#art`,
                `https://cdn.test/art.png?size=2${query}#absolute`
            ]);
            expect(assets.settings.modelUrl).toBe(
                `https://redirect.test/pack/v6/model.model3.json?redirect_key=r${query}#final`
            );
            expect(assets.settings.motions['Idle']).toEqual([
                {
                    url: `https://redirect.test/pack/idle.motion3.json?motion=idle${query}#curve`,
                    soundUrl: `https://audio.test/idle.wav?locale=zh${query}#sound`
                }
            ]);
            expect(assets.settings.expressions).toEqual([
                {
                    name: 'smile',
                    url: `https://redirect.test/pack/v6/smile.exp3.json?face=smile${query}#expression`
                }
            ]);
            expect(assets.settings.physicsUrl).toBe(
                `https://redirect.test/pack/v6/physics.json?wind=1${query}#rig`
            );
            expect(assets.settings.poseUrl).toBe(
                `https://cdn.test/pose.json?pose=default${query}#pose`
            );
            expect(assets.settings.displayInfoUrl).toBe(
                `https://redirect.test/pack/display.json?lang=en${query}#names`
            );
            expect(JSON.parse(new TextDecoder().decode(assets.model3))).toEqual(settings);
        } finally {
            assets.destroy();
        }
    });

    it('leaves URL queries and hashes unchanged without assetVersion and does not copy parent tokens', async () => {
        const image = await png();
        const input = `${modelUrl}?auth=secret#manifest`;
        const fetch = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation((request: RequestInfo | URL) => {
                const url = request instanceof Request ? request.url : String(request);
                if (url === input)
                    return Promise.resolve(
                        Response.json({
                            Version: 3,
                            FileReferences: {
                                Moc: 'model.moc3?quality=full#mesh',
                                Textures: [
                                    'https://cdn.test/texture.png?own=token&hilo_v=authored#image'
                                ]
                            }
                        })
                    );
                return Promise.resolve(
                    new Response(
                        new URL(url).pathname.endsWith('.moc3') ? new Uint8Array([1]) : image
                    )
                );
            });
        const assets = await loadLive2DAssets(input);
        try {
            expect(assets.settings.modelUrl).toBe(input);
            expect(assets.settings.mocUrl).toBe(
                'https://live2d.test/characters/yui/model.moc3?quality=full#mesh'
            );
            expect(assets.settings.textureUrls).toEqual([
                'https://cdn.test/texture.png?own=token&hilo_v=authored#image'
            ]);
            expect(
                fetch.mock.calls.map(call =>
                    call[0] instanceof Request ? call[0].url : String(call[0])
                )
            ).toEqual([input, assets.settings.mocUrl, at(assets.settings.textureUrls, 0)]);
        } finally {
            assets.destroy();
        }
    });

    it('rejects empty or non-string asset versions before requesting resources', async () => {
        const fetch = requests(manifest(), await png());
        for (const assetVersion of ['', '   ', 5 as unknown as string]) {
            await expect(loadLive2DAssets(modelUrl, { assetVersion })).rejects.toThrow(
                'assetVersion must be a non-empty string'
            );
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it('loads original bytes and straight-alpha textures while preserving Framework metadata', async () => {
        const fetch = requests(manifest(), await png());
        const assets = await loadLive2DAssets(modelUrl);
        expect(new Uint8Array(assets.moc)).toEqual(new Uint8Array([77, 79, 67, 51]));
        expect(JSON.parse(new TextDecoder().decode(assets.model3))).toEqual(manifest());
        expect(assets.settings).toMatchObject({
            version: 3,
            mocUrl: 'https://live2d.test/characters/yui/model.moc3',
            physicsUrl: 'https://live2d.test/characters/yui/model.physics3.json',
            poseUrl: 'https://live2d.test/characters/yui/model.pose3.json',
            layout: { Width: 2 },
            hitAreas: [{ id: 'head', name: 'Head' }],
            groups: [{ target: 'Parameter', name: 'EyeBlink', ids: ['ParamEyeLOpen'] }],
            expressions: [
                { name: 'smile', url: 'https://live2d.test/characters/yui/smile.exp3.json' }
            ]
        });
        expect(assets.settings.motions['Idle']).toEqual([
            {
                url: 'https://live2d.test/characters/yui/motions/idle.motion3.json',
                fadeInTime: 0.3,
                soundUrl: 'https://live2d.test/characters/yui/idle.wav'
            }
        ]);
        expect(fetch).toHaveBeenCalledTimes(3);
        const texture = at(assets.textures, 0);
        expect(texture).toMatchObject({
            width: 2,
            height: 2,
            flipY: false,
            premultiplyAlpha: false,
            isImageCanRelease: false
        });
        expect(texture.image).toBeInstanceOf(ImageBitmap);
        const image = texture.image as ImageBitmap;
        const canvas = new OffscreenCanvas(2, 2);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('Canvas 2D unavailable');
        context.drawImage(image, 0, 0);
        expect(Array.from(context.getImageData(0, 0, 1, 2).data)).toEqual([
            255, 0, 0, 255, 0, 0, 255, 255
        ]);
        const destroyed = vi.fn();
        texture.on('destroy', destroyed);
        assets.destroy();
        assets.destroy();
        expect(destroyed).toHaveBeenCalledTimes(1);
        expect(image.width).toBe(0);
    });

    it('rejects malformed metadata before fetching moc or image data', async () => {
        const fetch = requests(
            { Version: 3, FileReferences: { Moc: 'model.moc3', Textures: [2] } },
            await png()
        );
        await expect(loadLive2DAssets(modelUrl)).rejects.toThrow(
            'texture must be a non-empty string'
        );
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('rejects unsupported manifest versions', async () => {
        requests({ ...manifest(), Version: 4 }, await png());
        await expect(loadLive2DAssets(modelUrl)).rejects.toThrow('Version must be 3');
    });

    it('destroys partial textures when a later asset request fails', async () => {
        requests(manifest(['texture.png', 'missing.png']), await png());
        const destroyed = vi.spyOn(Texture.prototype, 'destroy');
        await expect(loadLive2DAssets(modelUrl)).rejects.toThrow('asset request failed (404)');
        expect(destroyed).toHaveBeenCalledTimes(1);
        const texture = at(destroyed.mock.contexts, 0);
        if (!(texture instanceof Texture)) throw new Error('Texture destruction missing');
        const image: unknown = texture.image;
        expect(image).toBeInstanceOf(ImageBitmap);
        expect((image as ImageBitmap).width).toBe(0);
    });

    it('honors pre-abort without requesting any asset', async () => {
        const fetch = requests(manifest(), await png());
        const controller = new AbortController();
        controller.abort();
        await expect(
            loadLive2DAssets(modelUrl, { signal: controller.signal })
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('cleans up loaded textures when cancelled during a later request', async () => {
        const controller = new AbortController();
        requests(manifest(['texture.png', 'second.png']), await png(), url => {
            if (url.endsWith('/second.png')) controller.abort();
        });
        const destroyed = vi.spyOn(Texture.prototype, 'destroy');
        await expect(loadLive2DAssets(modelUrl, { signal: controller.signal })).rejects.toThrow();
        expect(destroyed).toHaveBeenCalledTimes(1);
        const texture = at(destroyed.mock.contexts, 0);
        if (!(texture instanceof Texture)) throw new Error('Texture destruction missing');
        expect((texture.image as ImageBitmap).width).toBe(0);
    });

    it('closes every image even when a texture destruction listener throws', async () => {
        requests(manifest(['texture.png', 'texture.png']), await png());
        const assets = await loadLive2DAssets(modelUrl);
        const images = assets.textures.map(texture => texture.image as ImageBitmap);
        at(assets.textures, 0).on('destroy', () => {
            throw new Error('application cleanup failed');
        });
        expect(() => {
            assets.destroy();
        }).toThrow('Live2D texture cleanup failed');
        expect(images.map(image => image.width)).toEqual([0, 0]);
        expect(() => {
            assets.destroy();
        }).not.toThrow();
    });
});
