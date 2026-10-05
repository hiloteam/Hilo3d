/** A local MIDI arrangement converted to seconds on the audio clock. */
export interface PianoScoreNote {
    readonly midi: number;
    readonly velocity: number;
    readonly when: number;
    readonly duration: number;
}

export interface PianoScore {
    readonly notes: readonly PianoScoreNote[];
    readonly duration: number;
}

interface MidiEvent {
    readonly tick: number;
    readonly order: number;
    readonly kind: 'on' | 'off' | 'sustain' | 'tempo';
    readonly channel: number;
    readonly value: number;
    readonly velocity: number;
}

interface HeldNote {
    readonly midi: number;
    readonly velocity: number;
    readonly when: number;
}

class MidiReader {
    position = 0;
    constructor(private readonly bytes: Uint8Array) {}

    ensureBytes(length: number, end = this.bytes.length): void {
        if (length < 0 || this.position + length > end)
            throw new Error('The MIDI file is truncated.');
    }

    byte(end = this.bytes.length): number {
        this.ensureBytes(1, end);
        return this.bytes[this.position++] ?? 0;
    }

    word(): number {
        return this.byte() * 256 + this.byte();
    }

    long(): number {
        return this.word() * 65536 + this.word();
    }

    tag(): string {
        return String.fromCharCode(this.byte(), this.byte(), this.byte(), this.byte());
    }

    variable(end: number): number {
        let result = 0;
        for (let index = 0; index < 4; index++) {
            const value = this.byte(end);
            result = result * 128 + (value & 127);
            if (value < 128) return result;
        }
        throw new Error('The MIDI file contains an invalid variable-length value.');
    }

    data(end: number): number {
        const value = this.byte(end);
        if (value >= 128) throw new Error('The MIDI file contains invalid channel data.');
        return value;
    }
}

/**
 * Parse bounded Standard MIDI Files (format 0/1, PPQN clock). Tempo changes and CC64 sustain
 * are merged across tracks; percussion and notes outside the 88-key piano are ignored.
 * Files stay on the device. SMPTE/format 2 files are rejected rather than mistimed.
 */
export function parsePianoMidi(buffer: ArrayBuffer): PianoScore {
    if (buffer.byteLength > 2 * 1024 * 1024) throw new Error('Choose a MIDI file below 2 MiB.');
    const reader = new MidiReader(new Uint8Array(buffer));
    if (reader.tag() !== 'MThd') throw new Error('Choose a Standard MIDI file (.mid or .midi).');
    const headerLength = reader.long();
    if (headerLength < 6) throw new Error('The MIDI header is invalid.');
    reader.ensureBytes(headerLength);
    const format = reader.word();
    const trackCount = reader.word();
    const division = reader.word();
    if (format > 1 || (format === 0 && trackCount !== 1))
        throw new Error('Only MIDI format 0 and 1 are supported.');
    if (trackCount < 1 || trackCount > 64) throw new Error('Choose a MIDI file with 1–64 tracks.');
    if (division === 0 || (division & 0x8000) !== 0)
        throw new Error('The MIDI file must use a PPQN musical clock, not SMPTE timing.');
    reader.position += headerLength - 6;
    const events: MidiEvent[] = [];
    let eventCount = 0;
    let finalTick = 0;
    for (let track = 0; track < trackCount; track++) {
        if (reader.tag() !== 'MTrk') throw new Error('The MIDI track header is invalid.');
        const length = reader.long();
        reader.ensureBytes(length);
        const end = reader.position + length;
        let tick = 0;
        let runningStatus = 0;
        while (reader.position < end) {
            if (++eventCount > 20000)
                throw new Error('Choose a MIDI arrangement below 20,000 events.');
            tick += reader.variable(end);
            if (tick > 0x7fffffff) throw new Error('The MIDI timeline is too long.');
            finalTick = Math.max(finalTick, tick);
            let status = reader.byte(end);
            if (status < 128) {
                if (runningStatus === 0) throw new Error('The MIDI running status is invalid.');
                reader.position--;
                status = runningStatus;
            } else if (status < 0xf0) runningStatus = status;
            if (status === 0xff) {
                const type = reader.byte(end);
                const metaLength = reader.variable(end);
                reader.ensureBytes(metaLength, end);
                if (type === 0x51) {
                    if (metaLength !== 3) throw new Error('The MIDI tempo event is invalid.');
                    const tempo =
                        reader.byte(end) * 65536 + reader.byte(end) * 256 + reader.byte(end);
                    if (tempo === 0) throw new Error('The MIDI tempo must be positive.');
                    events.push({
                        tick,
                        order: eventCount,
                        kind: 'tempo',
                        channel: 0,
                        value: tempo,
                        velocity: 0
                    });
                } else reader.position += metaLength;
                if (type === 0x2f) {
                    if (metaLength !== 0)
                        throw new Error('The MIDI end-of-track event is invalid.');
                    reader.position = end;
                }
                continue;
            }
            if (status === 0xf0 || status === 0xf7) {
                runningStatus = 0;
                const sysexLength = reader.variable(end);
                reader.ensureBytes(sysexLength, end);
                reader.position += sysexLength;
                continue;
            }
            if (status >= 0xf0)
                throw new Error('The MIDI file contains unsupported system events.');
            const command = status >> 4;
            const channel = status & 15;
            const value = reader.data(end);
            const velocity = command === 0xc || command === 0xd ? 0 : reader.data(end);
            if (channel === 9) continue;
            if ((command === 0x8 || command === 0x9) && value >= 21 && value <= 108)
                events.push({
                    tick,
                    order: eventCount,
                    kind: command === 0x8 || velocity === 0 ? 'off' : 'on',
                    channel,
                    value,
                    velocity
                });
            else if (command === 0xb && value === 64)
                events.push({
                    tick,
                    order: eventCount,
                    kind: 'sustain',
                    channel,
                    value: velocity,
                    velocity: 0
                });
        }
    }
    events.sort((left, right) => left.tick - right.tick || left.order - right.order);
    const held = new Map<number, HeldNote[]>();
    const sustained = Array.from({ length: 16 }, (): HeldNote[] => []);
    const pedals = Array.from({ length: 16 }, () => false);
    const notes: PianoScoreNote[] = [];
    let tempo = 500000;
    let tick = 0;
    let seconds = 0;
    let starts = 0;
    const finish = (note: HeldNote, time: number): void => {
        notes.push({ ...note, duration: Math.max(0.04, time - note.when) });
    };
    for (const event of events) {
        seconds += ((event.tick - tick) * tempo) / division / 1000000;
        tick = event.tick;
        if (seconds > 1800) throw new Error('Choose a MIDI arrangement below 30 minutes.');
        if (event.kind === 'tempo') {
            tempo = event.value;
            continue;
        }
        const key = event.channel * 128 + event.value;
        if (event.kind === 'on') {
            if (++starts > 4096) throw new Error('Choose a MIDI arrangement below 4,096 notes.');
            let voices = held.get(key);
            if (!voices) {
                voices = [];
                held.set(key, voices);
            }
            voices.push({ midi: event.value, velocity: event.velocity / 127, when: seconds });
        } else if (event.kind === 'off') {
            const note = held.get(key)?.shift();
            if (note) {
                if (pedals[event.channel]) sustained[event.channel]?.push(note);
                else finish(note, seconds);
            }
        } else {
            const down = event.value >= 64;
            pedals[event.channel] = down;
            if (!down) {
                for (const note of sustained[event.channel] ?? []) finish(note, seconds);
                const tail = sustained[event.channel];
                if (tail) tail.length = 0;
            }
        }
    }
    seconds += ((finalTick - tick) * tempo) / division / 1000000;
    if (seconds > 1800) throw new Error('Choose a MIDI arrangement below 30 minutes.');
    for (const voices of held.values())
        for (const note of voices) finish(note, Math.max(seconds, note.when + 0.25));
    for (const voices of sustained) for (const note of voices) finish(note, seconds);
    if (notes.length === 0) throw new Error('The MIDI file contains no playable piano notes.');
    notes.sort((left, right) => left.when - right.when || left.midi - right.midi);
    // Trim score-leading silence for an immediate, predictable Play gesture.
    const offset = notes[0]?.when ?? 0;
    const trimmed = notes.map(note => ({ ...note, when: note.when - offset }));
    const duration = trimmed.reduce((end, note) => Math.max(end, note.when + note.duration), 0);
    return { notes: trimmed, duration };
}
