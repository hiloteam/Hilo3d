import { busInput } from './AudioMixer.js';
import { retainClip, releaseClip, type AudioClip } from './AudioClip.js';
import { playbackPosition, voiceData, type AudioVoice } from './AudioVoice.js';
import { Ramp } from './internal.js';

/** Reusable DSP chain. BufferSource nodes are one-shot by Web Audio specification. */
export class VoiceSlot {
    readonly envelope: GainNode;
    private readonly gain: GainNode;
    private readonly filter: BiquadFilterNode;
    private panner: PannerNode | undefined;
    source: AudioBufferSourceNode | undefined;
    private sourceStarted = false;
    voice: AudioVoice | undefined;
    retiringUntil = Infinity;
    private readonly attenuation = new Ramp(1);
    private readonly lowpass: Ramp;
    private x = NaN;
    private y = NaN;
    private z = NaN;
    private retainedClip: AudioClip | undefined;

    constructor(private readonly context: BaseAudioContext) {
        this.envelope = context.createGain();
        this.gain = context.createGain();
        this.filter = context.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.Q.value = 0;
        this.filter.frequency.value = context.sampleRate / 2;
        this.lowpass = new Ramp(context.sampleRate / 2);
        this.envelope.connect(this.gain).connect(this.filter);
    }

    activate(voice: AudioVoice, now: number): void {
        const data = voiceData(voice);
        this.voice = voice;
        data.slot = this;
        this.retiringUntil = Infinity;
        this.filter.disconnect();
        this.panner?.disconnect();
        if (data.spatial) {
            this.panner ??= this.context.createPanner();
            this.panner.panningModel = data.spatial.panningModel;
            this.panner.channelCount = 1;
            this.panner.channelCountMode = 'explicit';
            this.panner.rolloffFactor = 0;
            this.panner.coneInnerAngle = 360;
            this.panner.coneOuterAngle = 360;
            this.filter.connect(this.panner).connect(busInput(data.bus));
        } else this.filter.connect(busInput(data.bus));
        this.x = NaN;
        this.y = NaN;
        this.z = NaN;
        this.attenuation.set(data.attenuation, 0, now, this.gain.gain);
        this.lowpass.set(data.lowpass, 0, now, this.filter.frequency);
        data.volume.apply(this.envelope.gain, now);
        this.update(now, 0);
        const source = this.context.createBufferSource();
        this.source = source;
        source.buffer = data.clip.buffer;
        this.retainedClip = data.clip;
        retainClip(data.clip);
        source.loop = data.loop;
        source.loopStart = data.loopStart;
        source.loopEnd = data.loopEnd;
        source.playbackRate.value = data.effectiveRate;
        source.connect(this.envelope);
        source.onended = (): void => {
            if (this.source !== source) return;
            const current = this.voice;
            this.clear();
            if (current)
                data.engine.finishVoice(
                    current,
                    data.stopAt === Infinity ? 'completed' : 'stopped'
                );
        };
        source.start(Math.max(now, data.anchorTime), playbackPosition(data, now));
        this.sourceStarted = true;
        if (data.stopAt !== Infinity) source.stop(data.stopAt);
    }

    update(now: number, seconds: number): void {
        if (!this.voice) return;
        const data = voiceData(this.voice);
        if (this.attenuation.target !== data.attenuation)
            this.attenuation.set(data.attenuation, seconds, now, this.gain.gain);
        if (this.lowpass.target !== data.lowpass)
            this.lowpass.set(data.lowpass, seconds, now, this.filter.frequency);
        const position = data.spatial?.pose;
        if (position && this.panner) {
            if (this.x !== position.x) this.panner.positionX.setValueAtTime(position.x, now);
            if (this.y !== position.y) this.panner.positionY.setValueAtTime(position.y, now);
            if (this.z !== position.z) this.panner.positionZ.setValueAtTime(position.z, now);
            this.x = position.x;
            this.y = position.y;
            this.z = position.z;
        }
    }

    release(now: number, seconds: number): void {
        if (this.voice) voiceData(this.voice).slot = undefined;
        this.voice = undefined;
        if (!this.source) return;
        if (!this.sourceStarted) {
            this.clear();
            return;
        }
        if (seconds > 0) {
            this.attenuation.set(0, seconds, now, this.gain.gain);
            this.retiringUntil = now + seconds;
            this.source.stop(this.retiringUntil);
        } else {
            this.source.stop();
            this.clear();
        }
    }

    clear(): void {
        if (this.voice) voiceData(this.voice).slot = undefined;
        if (this.source) {
            this.source.onended = null;
            this.source.disconnect();
            this.source.buffer = null;
        }
        this.source = undefined;
        this.sourceStarted = false;
        if (this.retainedClip) releaseClip(this.retainedClip);
        this.retainedClip = undefined;
        this.voice = undefined;
        this.retiringUntil = Infinity;
        this.filter.disconnect();
        this.panner?.disconnect();
    }

    destroy(): void {
        this.release(this.context.currentTime, 0);
        this.envelope.disconnect();
        this.gain.disconnect();
        this.filter.disconnect();
        this.panner?.disconnect();
    }
}
