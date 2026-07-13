import Animation from '../../../src/animation/Animation';
import AnimationStates from '../../../src/animation/AnimationStates';
import BasicLoader, { type LoaderRequest } from '../../../src/loader/BasicLoader';
import Loader from '../../../src/loader/Loader';

interface SMDNodeFrames {
    readonly translation: number[][];
    readonly rotation: number[][];
}

export interface SMDAnimationData {
    readonly keyTimes: number[];
    readonly nodes: Readonly<Record<string, SMDNodeFrames>>;
}

type SMDSection = 'nodes' | 'skeleton' | null;

function requireFiniteNumbers(parts: readonly string[], lineNumber: number): number[] {
    const values = parts.map(Number);
    if (values.some(value => !Number.isFinite(value))) {
        throw new SyntaxError(`SMD line ${String(lineNumber)} contains an invalid number.`);
    }
    return values;
}

/** Strict Source SMD animation loader registered for `.smd` resources. */
class SMDLoader {
    private readonly transport = new BasicLoader();

    async load(params: LoaderRequest): Promise<Animation> {
        if (!params.src) throw new TypeError('SMDLoader requires a source URL.');
        const content = await this.transport.loadRes(params.src, BasicLoader.TYPE_TEXT);
        if (typeof content !== 'string') {
            throw new TypeError(`SMD resource ${params.src} did not resolve to text.`);
        }
        const data = this.parse(content);
        const animStatesList: AnimationStates[] = [];
        for (const [nodeName, frames] of Object.entries(data.nodes)) {
            animStatesList.push(
                new AnimationStates({
                    nodeName,
                    keyTime: data.keyTimes,
                    states: frames.translation,
                    type: AnimationStates.StateType.TRANSLATION
                }),
                new AnimationStates({
                    nodeName,
                    keyTime: data.keyTimes,
                    states: frames.rotation,
                    type: AnimationStates.StateType.ROTATION
                })
            );
        }
        return new Animation({ animStatesList });
    }

    parse(content: string): SMDAnimationData {
        const nodeNames = new Map<string, string>();
        const nodes: Record<string, SMDNodeFrames> = {};
        const keyTimes: number[] = [];
        let section: SMDSection = null;

        content.split(/\r?\n/u).forEach((rawLine, index) => {
            const lineNumber = index + 1;
            const line = rawLine.trim();
            if (!line || line.startsWith('version ')) return;
            if (line === 'nodes' || line === 'skeleton') {
                section = line;
                return;
            }
            if (line === 'end') {
                section = null;
                return;
            }

            if (section === 'nodes') {
                const match = /^(\d+)\s+"([^"]+)"\s+-?\d+$/u.exec(line);
                if (!match?.[1] || !match[2]) {
                    throw new SyntaxError(
                        `Invalid SMD node declaration on line ${String(lineNumber)}.`
                    );
                }
                nodeNames.set(match[1], match[2]);
                return;
            }
            if (section !== 'skeleton') return;

            if (line.startsWith('time ')) {
                const frame = Number(line.slice(5));
                if (!Number.isFinite(frame)) {
                    throw new SyntaxError(`Invalid SMD frame on line ${String(lineNumber)}.`);
                }
                keyTimes.push(frame / 30);
                return;
            }

            const parts = line.split(/\s+/u);
            const nodeId = parts.shift();
            const nodeName = nodeId ? nodeNames.get(nodeId) : undefined;
            if (!nodeName) {
                throw new SyntaxError(`Unknown SMD node on line ${String(lineNumber)}.`);
            }
            const values = requireFiniteNumbers(parts, lineNumber);
            if (values.length !== 6) {
                throw new SyntaxError(
                    `SMD transform on line ${String(lineNumber)} requires 6 values.`
                );
            }
            const frames = (nodes[nodeName] ??= { translation: [], rotation: [] });
            frames.translation.push(values.slice(0, 3));
            frames.rotation.push(values.slice(3, 6));
        });

        if (keyTimes.length === 0) throw new SyntaxError('SMD animation has no frames.');
        for (const [nodeName, frames] of Object.entries(nodes)) {
            if (
                frames.translation.length !== keyTimes.length ||
                frames.rotation.length !== keyTimes.length
            ) {
                throw new SyntaxError(`SMD node ${nodeName} does not define every frame.`);
            }
        }
        return { keyTimes, nodes };
    }
}

Loader.addLoader('smd', SMDLoader);

export default SMDLoader;
