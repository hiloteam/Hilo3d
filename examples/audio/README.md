# Call of Silence score

The project owner supplied `call-of-silence.pdf` and confirmed authorization to use the arrangement
in this example. The PDF is preserved byte-for-byte; it credits **Hiroyuki Sawano** and **Transposed
By vivace music**. The owner's written authorization record will follow separately; this directory
does not assert that the composition or arrangement is public domain or relicense it under the
engine's software license.

Source SHA-256: `0c8477e559210900be488ab330fd7e6a4b55ab2356861ec437027b5f0af50c76`.

## Transcription

`callOfSilence.notes.ts` records the 69 measures and all 766 written noteheads in the three-page
score. The two-beat pickup plus 68 four-beat measures total 274 quarter beats. Sounding pitches
include the local bass octave-down signs in measures 9 and 18. Rest positions are implicit gaps;
independent right/left-hand voices and ties are retained.

`callOfSilence.ts` compiles this notation into the existing `PianoScore` format. The 77 tied
continuations merge into their preceding notes, yielding **689 attacks** including the grace note.
The E4/G4 tie crosses the page break at measures 31-32; the final D5/E5/B5 chord is held for 8.5
beats without reattacks. All noteheads were checked against the PDF's actual music-glyph baseline
positions, then rhythms, beams, rests and ties were checked visually.

The PDF has no numeric tempo marking. **84 BPM** is an example performance choice, giving a
195.714-second score before the reverb tail. Printed dynamic marks are interpreted as key velocity;
the right-hand melody is voiced above the left-hand accompaniment. The unmeasured D5 grace in
measure 45 is placed just before beat 2. Upward rolls in measures 22, 26, 36 and 69 use a short
bottom-to-top onset spread while preserving each chord's notated release time. These timing and
velocity choices are performance interpretations, not extra notes or a claim of matching a specific
commercial recording.

The example loads this complete score as its default automatic performance. Importing a local MIDI
replaces it for the current page session. Audio keeps the complete 88-key pitch range; the compact
37-key visual piano folds out-of-range notes by octaves for its key and light positions.
