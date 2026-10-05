import { describe, expect, it } from 'vitest';
import type { PianoScore, PianoScoreNote } from '../shared/pianoMidi';
import { compilePianoNotation, createCallOfSilenceScore } from './callOfSilence';
import { CALL_OF_SILENCE_NOTATION, type PianoMeasure } from './callOfSilence.notes';

const BEAT_SECONDS = 60 / 84;

/** The first printed bar is a two-beat pickup; all subsequent bars have four beats. */
function absoluteBeat(measure: number, beat = 0): number {
    return (measure === 1 ? 0 : 2 + (measure - 2) * 4) + beat;
}

function noteAt(score: PianoScore, midi: number, beat: number): PianoScoreNote {
    const note = score.notes.find(
        candidate =>
            candidate.midi === midi && Math.abs(candidate.when / BEAT_SECONDS - beat) < 1e-8
    );
    if (!note) throw new Error(`Missing MIDI ${String(midi)} at beat ${String(beat)}.`);
    return note;
}

describe('Call of Silence piano transcription', () => {
    it('accounts for all written noteheads and pairs every tie by hand, pitch and beat', () => {
        expect(CALL_OF_SILENCE_NOTATION).toHaveLength(69);
        expect(
            CALL_OF_SILENCE_NOTATION.reduce((count, measure) => count + measure.notes.length, 0)
        ).toBe(766);
        const pending = new Map<string, number>();
        let onset = 0;
        let continuations = 0;
        for (const [index, measure] of CALL_OF_SILENCE_NOTATION.entries()) {
            expect(measure.number).toBe(index + 1);
            for (const [beat, duration, pitch, hand, articulation] of measure.notes) {
                const key = `${hand}:${pitch}`;
                if (articulation === 'in' || articulation === 'through') {
                    expect(pending.get(key), `measure ${String(measure.number)} tie ${key}`).toBe(
                        onset + beat
                    );
                    pending.delete(key);
                    continuations++;
                }
                if (articulation === 'out' || articulation === 'through') {
                    expect(pending.has(key), `duplicate outgoing tie ${key}`).toBe(false);
                    pending.set(key, onset + beat + duration);
                }
            }
            onset += measure.beats;
        }
        expect(onset).toBe(274);
        expect(continuations).toBe(77);
        expect(pending.size).toBe(0);
    });

    it('retains the pickup, full arrangement and ordered playable note boundaries', () => {
        const score = createCallOfSilenceScore();
        expect(score.notes).toHaveLength(689);
        expect(score.notes.slice(0, 2).map(note => note.midi)).toEqual([69, 72]);
        expect(noteAt(score, 69, 0).duration).toBeCloseTo(BEAT_SECONDS, 10);
        expect(noteAt(score, 72, 1).duration).toBeCloseTo(BEAT_SECONDS, 10);
        expect(score.duration).toBeCloseTo(274 * BEAT_SECONDS, 10);
        let previousOnset = -1;
        let finalRelease = 0;
        for (const note of score.notes) {
            expect(note.when).toBeGreaterThanOrEqual(previousOnset);
            expect(note.when).toBeGreaterThanOrEqual(0);
            expect(note.duration).toBeGreaterThan(0);
            expect(note.velocity).toBeGreaterThan(0);
            expect(note.velocity).toBeLessThanOrEqual(1);
            expect(note.midi).toBeGreaterThanOrEqual(21);
            expect(note.midi).toBeLessThanOrEqual(108);
            expect(note.when + note.duration).toBeLessThanOrEqual(score.duration + 1e-8);
            previousOnset = note.when;
            finalRelease = Math.max(finalRelease, note.when + note.duration);
        }
        expect(finalRelease).toBeCloseTo(score.duration, 10);
    });

    it('applies the localized bass octave marks without losing the low-register notes', () => {
        const score = createCallOfSilenceScore();
        expect(noteAt(score, 33, absoluteBeat(9)).duration).toBeCloseTo(4 * BEAT_SECONDS, 10);
        for (const midi of [33, 45]) {
            expect(noteAt(score, midi, absoluteBeat(18)).duration).toBeCloseTo(
                4 * BEAT_SECONDS,
                10
            );
        }
        const measure18 = score.notes.filter(
            note => Math.abs(note.when / BEAT_SECONDS - absoluteBeat(18)) < 1e-8
        );
        expect(measure18.map(note => note.midi).sort((left, right) => left - right)).toEqual([
            33, 45
        ]);
    });

    it('sustains the page-break E4/G4 ties with one attack across measures 31 and 32', () => {
        const score = createCallOfSilenceScore();
        const start = absoluteBeat(31, 3.5);
        const continuation = absoluteBeat(32);
        for (const midi of [64, 67]) {
            expect(noteAt(score, midi, start).duration).toBeCloseTo(4.5 * BEAT_SECONDS, 10);
            expect(
                score.notes.filter(
                    note =>
                        note.midi === midi &&
                        note.when / BEAT_SECONDS >= start - 1e-8 &&
                        note.when / BEAT_SECONDS < continuation + 4 - 1e-8
                )
            ).toHaveLength(1);
        }
    });

    it('holds the final D5/E5/B5 triad through both barlines without retriggering it', () => {
        const score = createCallOfSilenceScore();
        const start = absoluteBeat(67, 3.5);
        for (const midi of [74, 76, 83]) {
            const ending = noteAt(score, midi, start);
            expect(ending.duration).toBeCloseTo(8.5 * BEAT_SECONDS, 10);
            expect(ending.when + ending.duration).toBeCloseTo(score.duration, 10);
            expect(
                score.notes.filter(
                    note => note.midi === midi && note.when / BEAT_SECONDS >= start - 1e-8
                )
            ).toHaveLength(1);
        }
    });

    it('rolls only the four marked chords upward while preserving their notated release', () => {
        const score = createCallOfSilenceScore();
        const chords = [
            { measure: 22, beat: 2, length: 2, pitches: [81, 84, 88, 93] },
            { measure: 26, beat: 2, length: 2, pitches: [84, 88, 93, 96] },
            { measure: 36, beat: 2, length: 2, pitches: [81, 84, 88, 93] },
            { measure: 69, beat: 0, length: 4, pitches: [57, 60, 64, 69] }
        ];
        for (const chord of chords) {
            const onset = absoluteBeat(chord.measure, chord.beat) * BEAT_SECONDS;
            const release = onset + chord.length * BEAT_SECONDS;
            let previousOnset = onset - 1e-8;
            for (const midi of chord.pitches) {
                const note = score.notes.find(
                    candidate =>
                        candidate.midi === midi &&
                        candidate.when >= onset - 1e-8 &&
                        candidate.when < onset + BEAT_SECONDS * 0.5
                );
                expect(
                    note,
                    `measure ${String(chord.measure)} rolled MIDI ${String(midi)}`
                ).toBeDefined();
                if (!note) throw new Error('The rolled chord is missing a note.');
                expect(note.when).toBeGreaterThan(previousOnset);
                expect(note.when + note.duration).toBeCloseTo(release, 10);
                previousOnset = note.when;
            }
        }
        // The following ordinary octave still starts together.
        expect(noteAt(score, 64, absoluteBeat(37, 2)).when).toBe(
            noteAt(score, 76, absoluteBeat(37, 2)).when
        );
    });

    it('places the D5 grace before the E4/E5 octave at measure 45 beat 2', () => {
        const score = createCallOfSilenceScore();
        const beat = absoluteBeat(45, 2);
        const onset = beat * BEAT_SECONDS;
        const grace = score.notes.filter(
            note => note.midi === 74 && note.when > onset - BEAT_SECONDS * 0.5 && note.when < onset
        );
        expect(grace).toHaveLength(1);
        const note = grace[0];
        if (!note) throw new Error('The measure 45 grace note is missing.');
        expect(note.duration).toBeGreaterThan(0);
        expect(note.when + note.duration).toBeLessThanOrEqual(onset + 1e-8);
        expect(noteAt(score, 64, beat).when).toBe(noteAt(score, 76, beat).when);
    });

    it('scales the musical timeline with tempo and rejects an unusable tempo', () => {
        const faster = createCallOfSilenceScore(120);
        expect(faster.duration).toBeCloseTo(274 * 0.5, 10);
        expect(faster.notes[1]?.when).toBeCloseTo(0.5, 10);
        for (const bpm of [0, -84, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => createCallOfSilenceScore(bpm)).toThrow();
        }
    });

    it('keeps rolled notes playable at extreme tempo without extending the score', () => {
        const fastBeat = 60 / 6000;
        const score = createCallOfSilenceScore(6000);
        expect(score.duration).toBeCloseTo(274 * fastBeat, 10);
        expect(score.notes).toHaveLength(689);
        for (const note of score.notes) {
            expect(Number.isFinite(note.when)).toBe(true);
            expect(Number.isFinite(note.duration)).toBe(true);
            expect(note.duration).toBeGreaterThan(0);
            expect(note.when + note.duration).toBeLessThanOrEqual(score.duration + 1e-8);
        }
        const finalChord = score.notes.filter(
            note => note.when >= absoluteBeat(69) * fastBeat - 1e-8
        );
        expect(finalChord.map(note => note.midi)).toEqual([57, 60, 64, 69]);
        let previousOnset = -1;
        for (const note of finalChord) {
            expect(note.when).toBeGreaterThan(previousOnset);
            expect(note.when + note.duration).toBeCloseTo(score.duration, 10);
            previousOnset = note.when;
        }
    });

    it('rejects an opening grace note that has no time before its principal note', () => {
        expect(() =>
            compilePianoNotation(
                [
                    {
                        number: 1,
                        beats: 1,
                        notes: [
                            [0, 0, 'D5', 'R', 'grace'],
                            [0, 1, 'E5', 'R']
                        ]
                    }
                ],
                84
            )
        ).toThrow(/grace/iu);
    });

    it('rejects orphaned ties, skipped continuations and ties to the wrong hand', () => {
        const invalid: readonly (readonly PianoMeasure[])[] = [
            [{ number: 1, beats: 4, notes: [[0, 4, 'C4', 'R', 'in']] }],
            [{ number: 1, beats: 4, notes: [[0, 4, 'C4', 'R', 'out']] }],
            [
                { number: 1, beats: 4, notes: [[0, 4, 'C4', 'R', 'out']] },
                { number: 2, beats: 4, notes: [[1, 3, 'C4', 'R', 'in']] }
            ],
            [
                { number: 1, beats: 4, notes: [[0, 4, 'C4', 'R', 'out']] },
                { number: 2, beats: 4, notes: [[0, 4, 'C4', 'R']] }
            ],
            [
                { number: 1, beats: 4, notes: [[0, 4, 'C4', 'L', 'out']] },
                { number: 2, beats: 4, notes: [[0, 4, 'C4', 'R', 'in']] }
            ]
        ];
        for (const measures of invalid) {
            expect(() => compilePianoNotation(measures, 84)).toThrow(/tie/iu);
        }
    });

    it('keeps overlapping unison attacks in separate hands while merging the intended tie', () => {
        const score = compilePianoNotation(
            [
                {
                    number: 1,
                    beats: 1,
                    notes: [
                        [0, 1, 'E4', 'L', 'out'],
                        [0, 0.5, 'E4', 'R']
                    ]
                },
                { number: 2, beats: 1, notes: [[0, 1, 'E4', 'L', 'in']] }
            ],
            60
        );
        expect(score.notes).toHaveLength(2);
        expect(score.notes.map(note => note.midi)).toEqual([64, 64]);
        expect(score.notes.map(note => note.when)).toEqual([0, 0]);
        expect(score.notes.map(note => note.duration).sort((left, right) => left - right)).toEqual([
            0.5, 2
        ]);
    });

    it('rejects notes outside the measure or piano and an invalid measure sequence', () => {
        const invalid: readonly (readonly PianoMeasure[])[] = [
            [{ number: 2, beats: 4, notes: [] }],
            [{ number: 1, beats: 0, notes: [] }],
            [{ number: 1, beats: 4, notes: [[-1, 1, 'C4', 'R']] }],
            [{ number: 1, beats: 4, notes: [[3, 2, 'C4', 'R']] }],
            [{ number: 1, beats: 4, notes: [[0, 0, 'C4', 'R']] }],
            [{ number: 1, beats: 4, notes: [[0, 1, 'H4', 'R']] }],
            [{ number: 1, beats: 4, notes: [[0, 1, 'C0', 'R']] }]
        ];
        for (const measures of invalid) {
            expect(() => compilePianoNotation(measures, 84)).toThrow();
        }
    });
});
