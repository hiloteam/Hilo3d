import { SRP_PROTOCOL } from './contract';
import { summarizeSRPSamples } from './statistics';

const metrics = [
    'cpuMs',
    'recordMs',
    'compileMs',
    'prepareMs',
    'executeMs',
    'fenceMs',
    'logicalBytes',
    'peakLiveBytes',
    'physicalBytes',
    'draws',
    'commands',
    'passes'
] as const;
type Metric = (typeof metrics)[number] | 'allocationBytes';
interface Capture {
    readonly commit: string;
    readonly protocolSha256: string;
    readonly backend: string;
    readonly workload: string;
    readonly environment: string;
    readonly rounds: readonly {
        readonly pixels: string;
        readonly environment: string;
        readonly values: Readonly<Record<Metric, number>>;
    }[];
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Malformed SRP capture');
    return value as Record<string, unknown>;
}
function array(value: unknown, length: number): unknown[] {
    if (!Array.isArray(value) || value.length !== length) throw new Error('Incomplete SRP capture');
    return value;
}
function string(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error('Missing SRP identity');
    return value;
}
function number(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        throw new Error('Invalid SRP metric');
    return value;
}
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(record(value)).sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
    }
    return value === undefined ? 'undefined' : JSON.stringify(value);
}

function capture(captureValue: unknown, diagnostic: boolean): Capture {
    const data = record(captureValue);
    if (data['schemaVersion'] !== 1 || canonical(data['protocol']) !== canonical(SRP_PROTOCOL))
        throw new Error('SRP protocol mismatch');
    if (!diagnostic && (data['dirty'] !== false || data['evidence'] !== 'unreviewed-candidate'))
        throw new Error('Cross-commit comparison requires clean audited candidates');
    const commit = string(data['commit']);
    const protocolSha256 = string(data['protocolSha256']);
    if (
        !/^[a-f0-9]{40}$/u.test(commit) ||
        !/^[a-f0-9]{64}$/u.test(protocolSha256) ||
        !/^[a-f0-9]{64}$/u.test(string(data['sourceSha256']))
    )
        throw new Error('Invalid SRP source identity');
    const rounds = array(data['rounds'], SRP_PROTOCOL.rounds).map(roundValue => {
        const round = record(roundValue);
        const samples = array(round['samples'], SRP_PROTOCOL.sampleFrames).map(record);
        const values = {} as Record<Metric, number>;
        for (const metric of metrics)
            values[metric] = summarizeSRPSamples(
                samples.map(sample => number(sample[metric]))
            ).median;
        if (samples.some(sample => sample['submissions'] !== 1 || number(sample['draws']) < 1))
            throw new Error('SRP capture has incomplete rendering');
        const allocations = array(round['allocations'], SRP_PROTOCOL.allocationFrames).map(value =>
            number(record(value)['bytes'])
        );
        values.allocationBytes = summarizeSRPSamples(allocations).median;
        const pixels = record(round['pixels']);
        if (number(pixels['range']) < 16) throw new Error('SRP capture has uniform pixels');
        return {
            pixels: string(pixels['sha256']),
            environment: canonical({
                browser: round['browser'],
                gpuIdentity: round['gpuIdentity']
            }),
            values
        };
    });
    const firstRound = rounds[0];
    if (firstRound === undefined) throw new Error('Missing SRP rounds');
    if (
        rounds.some(
            round =>
                round.pixels !== firstRound.pixels || round.environment !== firstRound.environment
        )
    )
        throw new Error('SRP rounds changed pixels or device identity');
    if (!diagnostic)
        for (const metric of ['cpuMs', 'compileMs'] as const) {
            const medians = rounds.map(round => round.values[metric]);
            if (Math.max(...medians) > Math.min(...medians) * 1.3)
                throw new Error(
                    'SRP candidate failed round repeatability; retain it and recapture under quiet conditions'
                );
        }
    return {
        commit,
        protocolSha256,
        backend: string(data['backend']),
        workload: string(data['workload']),
        environment: canonical(data['environment']),
        rounds
    };
}

/** Strict cross-commit comparison; local diagnostics remain explicitly non-evidence. */
export function compareSRPCaptures(
    beforeValue: unknown,
    afterValue: unknown,
    diagnostic = false
): Readonly<Record<Metric, { before: number; after: number; changePercent: number | null }>> {
    const before = capture(beforeValue, diagnostic);
    const after = capture(afterValue, diagnostic);
    if (
        (!diagnostic && before.commit === after.commit) ||
        before.protocolSha256 !== after.protocolSha256 ||
        before.backend !== after.backend ||
        before.workload !== after.workload ||
        before.environment !== after.environment ||
        before.rounds[0]?.environment !== after.rounds[0]?.environment
    )
        throw new Error('SRP captures are not comparable: source/protocol/workload/rig differs');
    if (before.rounds[0]?.pixels !== after.rounds[0]?.pixels)
        throw new Error('SRP output pixels differ');
    const result = {} as Record<
        Metric,
        { before: number; after: number; changePercent: number | null }
    >;
    for (const metric of [...metrics, 'allocationBytes' as const]) {
        const a = summarizeSRPSamples(before.rounds.map(round => round.values[metric])).median;
        const b = summarizeSRPSamples(after.rounds.map(round => round.values[metric])).median;
        result[metric] = { before: a, after: b, changePercent: a === 0 ? null : (b / a - 1) * 100 };
    }
    return Object.freeze(result);
}
