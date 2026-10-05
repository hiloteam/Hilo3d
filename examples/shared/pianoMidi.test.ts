import { describe, expect, it } from 'vitest';
import { parsePianoMidi } from './pianoMidi';

function variable(value: number): number[] {
    const bytes = [value & 127];
    for (
        let remaining = Math.floor(value / 128);
        remaining > 0;
        remaining = Math.floor(remaining / 128)
    )
        bytes.unshift((remaining & 127) | 128);
    return bytes;
}

function midi(tracks: readonly number[][], division = 480): ArrayBuffer {
    const result = [
        77,
        84,
        104,
        100,
        0,
        0,
        0,
        6,
        0,
        tracks.length > 1 ? 1 : 0,
        0,
        tracks.length,
        division >> 8,
        division & 255
    ];
    for (const track of tracks) {
        const bytes = [...track, 0, 0xff, 0x2f, 0];
        result.push(77, 84, 114, 107, 0, 0, bytes.length >> 8, bytes.length & 255, ...bytes);
    }
    return new Uint8Array(result).buffer;
}

const event = (delta: number, ...bytes: number[]): number[] => [...variable(delta), ...bytes];

describe('local piano MIDI arrangements', () => {
    it('merges a format 1 conductor tempo map and sustain into note durations', () => {
        const score = parsePianoMidi(
            midi([
                [
                    ...event(0, 0xff, 0x51, 3, 7, 0xa1, 0x20),
                    ...event(480, 0xff, 0x51, 3, 15, 0x42, 0x40)
                ],
                [
                    ...event(0, 0x90, 60, 100),
                    ...event(240, 0xb0, 64, 127),
                    ...event(240, 0x80, 60, 0),
                    ...event(240, 0xb0, 64, 0)
                ]
            ])
        );
        expect(score.notes).toEqual([{ midi: 60, velocity: 100 / 127, when: 0, duration: 1 }]);
        expect(score.duration).toBe(1);
    });

    it('decodes running status, zero-velocity releases and simultaneous overlapping keys', () => {
        const score = parsePianoMidi(
            midi([
                [
                    ...event(480, 0x90, 60, 110),
                    ...event(120, 60, 70),
                    ...event(120, 60, 0),
                    ...event(120, 60, 0)
                ]
            ])
        );
        expect(score.notes).toEqual([
            { midi: 60, velocity: 110 / 127, when: 0, duration: 0.25 },
            { midi: 60, velocity: 70 / 127, when: 0.125, duration: 0.25 }
        ]);
        expect(score.duration).toBe(0.375);
    });

    it('keeps channel sustain separate, ignores percussion, and closes missing releases at track end', () => {
        const score = parsePianoMidi(
            midi([
                [
                    ...event(0, 0xb0, 64, 127),
                    ...event(0, 0x90, 21, 127),
                    ...event(0, 0x91, 108, 80),
                    ...event(0, 0x99, 60, 127),
                    ...event(240, 0x81, 108, 0),
                    ...event(240, 0x80, 21, 0),
                    ...event(240, 0xff, 1, 0)
                ]
            ])
        );
        expect(score.notes).toEqual([
            { midi: 21, velocity: 1, when: 0, duration: 0.75 },
            { midi: 108, velocity: 80 / 127, when: 0, duration: 0.25 }
        ]);
    });

    it('rejects unsupported clock formats and malformed event boundaries', () => {
        expect(() => parsePianoMidi(midi([event(0, 0x90, 60, 80)], 0xe728))).toThrow(/PPQN/u);
        expect(() => parsePianoMidi(midi([[0, 60, 80]]))).toThrow(/running status/u);
        const truncated = new Uint8Array(midi([event(0, 0x90, 60, 80)])).slice(0, -1).buffer;
        expect(() => parsePianoMidi(truncated)).toThrow(/truncated/u);
        expect(() => parsePianoMidi(midi([[0, 0xff, 0x51, 3, 0, 0, 0]]))).toThrow(/positive/u);
        expect(() => parsePianoMidi(midi([[0x81, 0x80, 0x80, 0x80, 0]]))).toThrow(
            /variable-length/u
        );
    });

    it('bounds file size and note count before allocating a playable score', () => {
        expect(() => parsePianoMidi(new ArrayBuffer(2 * 1024 * 1024 + 1))).toThrow(/2 MiB/u);
        const track: number[] = [];
        for (let index = 0; index < 4097; index++) track.push(...event(0, 0x90, 60, 80));
        expect(() => parsePianoMidi(midi([track]))).toThrow(/4,096/u);
        expect(() => parsePianoMidi(midi([event(0, 0x99, 60, 80)]))).toThrow(/no playable/u);
    });
});
