import type { PianoScore, PianoScoreNote } from '../shared/pianoMidi';
import { CALL_OF_SILENCE_NOTATION, type PianoHand, type PianoMeasure } from './callOfSilence.notes';

export const CALL_OF_SILENCE_TITLE = 'Call of Silence';
/** Performance choice: the supplied PDF has no metronome marking. */
export const CALL_OF_SILENCE_BPM = 84;
export const CALL_OF_SILENCE_MEASURES = 69;
export const CALL_OF_SILENCE_BEATS = 274;

interface BeatNote {
    readonly midi: number;
    readonly hand: PianoHand;
    readonly start: number;
    end: number;
    readonly velocity: number;
    readonly rolled: boolean;
    readonly grace: boolean;
}

const SEMITONES: Readonly<Record<string, number>> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11
};

function midiPitch(pitch: string): number {
    const match = /^([A-G])([#b]?)([0-8])$/u.exec(pitch);
    if (!match) throw new Error(`Invalid score pitch: ${pitch}`);
    const step = SEMITONES[match[1] ?? ''];
    if (step === undefined) throw new Error(`Invalid score pitch: ${pitch}`);
    const midi =
        (Number(match[3]) + 1) * 12 + step + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
    if (midi < 21 || midi > 108)
        throw new RangeError(`Score pitch lies outside the piano: ${pitch}`);
    return midi;
}

/** Dynamic markings are interpreted as struck-key velocity; sustained ties are never reattacked. */
function velocity(measure: number, beat: number, hand: PianoHand, grace: boolean): number {
    let value = hand === 'R' ? 0.62 : 0.5;
    if (measure >= 9) value = hand === 'R' ? 0.73 : 0.57;
    if (measure >= 19) value = hand === 'R' ? 0.6 : 0.5;
    if (measure >= 24)
        value = hand === 'R' ? 0.5 + Math.min(1, ((measure - 24) * 4 + beat) / 12) * 0.17 : 0.48;
    if (measure >= 27) value = hand === 'R' ? 0.72 : 0.54;
    if (measure >= 37) value = hand === 'R' ? 0.84 : 0.67;
    if (measure >= 58) value *= Math.max(0.68, 1 - ((measure - 58) * 4 + beat) / 20);
    if (measure >= 61) value = hand === 'R' ? 0.61 : 0.53;
    if (measure >= 62 && hand === 'L') value = 0.43;
    if (measure === 8) value += (beat / 4) * 0.1;
    return grace ? value * 0.72 : value;
}

/**
 * Compile the reviewed notation to the existing audio-clock score format. Ties are matched by
 * hand and pitch across bar/page boundaries; malformed tie chains fail instead of retriggering.
 */
export function compilePianoNotation(
    measures: readonly PianoMeasure[],
    beatsPerMinute: number
): PianoScore {
    if (!Number.isFinite(beatsPerMinute) || beatsPerMinute <= 0)
        throw new RangeError('Score tempo must be a finite positive BPM.');
    const beatSeconds = 60 / beatsPerMinute;
    if (!Number.isFinite(beatSeconds)) throw new RangeError('Score tempo is too small.');
    const notes: BeatNote[] = [];
    const ties = new Map<string, BeatNote>();
    let measureStart = 0;
    for (const [index, measure] of measures.entries()) {
        if (measure.number !== index + 1 || !Number.isFinite(measure.beats) || measure.beats <= 0)
            throw new Error('Score measures must be consecutive and have positive lengths.');
        for (const [beat, length, pitch, hand, articulation] of [...measure.notes].sort(
            (a, b) => a[0] - b[0]
        )) {
            const grace = articulation === 'grace';
            if (
                !Number.isFinite(beat) ||
                !Number.isFinite(length) ||
                beat < 0 ||
                beat >= measure.beats ||
                length < 0 ||
                (length === 0 && !grace) ||
                beat + length > measure.beats ||
                (grace && length !== 0)
            )
                throw new Error(`Invalid note timing in measure ${String(measure.number)}.`);
            const midi = midiPitch(pitch);
            const key = `${hand}:${String(midi)}`;
            const start = measureStart + beat;
            const end = start + length;
            if (grace && start <= 0)
                throw new Error('A grace note needs time before its main note.');
            const tieIn = articulation === 'in' || articulation === 'through';
            const tieOut = articulation === 'out' || articulation === 'through';
            let note: BeatNote;
            if (tieIn) {
                const held = ties.get(key);
                if (held?.end !== start)
                    throw new Error(
                        `Unmatched incoming tie in measure ${String(measure.number)}: ${pitch}.`
                    );
                note = held;
                note.end = end;
                ties.delete(key);
            } else {
                if (ties.has(key)) throw new Error(`Missing tie continuation for ${pitch}.`);
                note = {
                    midi,
                    hand,
                    start,
                    end,
                    velocity: velocity(measure.number, beat, hand, grace),
                    rolled: articulation === 'roll',
                    grace
                };
                notes.push(note);
            }
            if (tieOut) ties.set(key, note);
        }
        measureStart += measure.beats;
    }
    if (ties.size > 0) throw new Error('Score ends with an unresolved tie.');
    const rolledGroups = new Map<string, BeatNote[]>();
    for (const note of notes)
        if (note.rolled) {
            const key = `${note.hand}:${String(note.start)}`;
            const group = rolledGroups.get(key) ?? [];
            if (!rolledGroups.has(key)) rolledGroups.set(key, group);
            group.push(note);
        }
    const rollSteps = new Map<string, number>();
    for (const [key, group] of rolledGroups) {
        group.sort((a, b) => a.midi - b.midi);
        let shortest = Infinity;
        for (const note of group)
            shortest = Math.min(shortest, (note.end - note.start) * beatSeconds);
        rollSteps.set(key, Math.min(0.028, shortest / (group.length + 1)));
    }
    const rendered: PianoScoreNote[] = notes.map(note => {
        const groupKey = `${note.hand}:${String(note.start)}`;
        const group = rolledGroups.get(groupKey);
        const roll = note.rolled
            ? Math.max(0, group?.indexOf(note) ?? 0) * (rollSteps.get(groupKey) ?? 0)
            : 0;
        const graceLength = Math.min(0.09, beatSeconds * 0.125);
        const when = note.start * beatSeconds + roll - (note.grace ? graceLength : 0);
        const end = note.end * beatSeconds;
        if (!Number.isFinite(end) || end <= Math.max(0, when))
            throw new Error('Score note has no finite playable duration.');
        return Object.freeze({
            midi: note.midi,
            velocity: note.velocity,
            when: Math.max(0, when),
            duration: end - Math.max(0, when)
        });
    });
    rendered.sort((a, b) => a.when - b.when || a.midi - b.midi);
    return Object.freeze({ notes: Object.freeze(rendered), duration: measureStart * beatSeconds });
}

/** The complete provided arrangement, with its pickup, ties, grace note and rolled chords. */
export function createCallOfSilenceScore(beatsPerMinute = CALL_OF_SILENCE_BPM): PianoScore {
    return compilePianoNotation(CALL_OF_SILENCE_NOTATION, beatsPerMinute);
}
