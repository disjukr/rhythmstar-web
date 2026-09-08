import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import soundBankUrl from "../assets/1mgm.sf2?url";
import type { MusicPort } from "./io";
import { parseSmaf, smafToMidi } from "./smaf";

export class BrowserMusic implements MusicPort {
  readonly #context = new AudioContext();
  readonly #ready: Promise<void>;
  #synth: WorkletSynthesizer | undefined;
  #sequencer: Sequencer | undefined;
  #current: { midi: Uint8Array<ArrayBuffer>; repeat: boolean } | undefined;
  readonly #effectSources = new Set<AudioBufferSourceNode>();
  readonly #effectBuffers = new WeakMap<Uint8Array, { time: number; buffer: AudioBuffer }[]>();
  readonly #musicGain = this.#context.createGain();
  readonly #effectGain = this.#context.createGain();

  constructor(readonly onError: (error: unknown) => void) {
    this.#effectGain.gain.value = 0.5;
    this.#effectGain.connect(this.#context.destination);
    this.#musicGain.connect(this.#effectGain);
    // Prepare the bank while the opening screens run. A keyboard/pointer
    // gesture resumes the context without inventing a game input event.
    this.#ready = this.#initialize().catch(onError);
  }

  async #initialize(): Promise<void> {
    const [response] = await Promise.all([
      fetch(soundBankUrl),
      this.#context.audioWorklet.addModule(processorUrl),
    ]);
    if (!response.ok) throw new Error(`Sound bank request failed (${response.status})`);
    const synth = new WorkletSynthesizer(this.#context);
    await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), "gm");
    await synth.isReady;
    synth.connect(this.#musicGain);
    this.#synth = synth;
    this.#sequencer = new Sequencer(synth, { skipToFirstNoteOn: false });
    this.#apply();
  }

  unlock(): void {
    if (this.#context.state === "suspended") void this.#context.resume().catch(this.onError);
  }

  play(data: Uint8Array, repeat: boolean): void {
    this.#current = { midi: smafToMidi(parseSmaf(data)), repeat };
    this.#apply();
  }

  stop(): void {
    this.#stopEffect();
    this.#current = undefined;
    this.#apply();
  }

  setVolume(level: number): void {
    this.#effectGain.gain.value = level;
  }

  playEffect(data: Uint8Array): void {
    let buffers = this.#effectBuffers.get(data);
    if (!buffers) {
      const sequence = parseSmaf(data);
      if (!sequence.waves?.length || sequence.events.some(event => (event.data[0] & 0xf0) === 0x90)) {
        throw new Error("Expected a PCM-only menu effect");
      }
      buffers = sequence.waves.map(wave => {
        const buffer = this.#context.createBuffer(1, wave.samples.length, wave.samplingRate);
        const samples = buffer.getChannelData(0);
        wave.samples.forEach((sample, index) => { samples[index] = sample / 32768; });
        return { time: wave.time / 1000, buffer };
      });
      this.#effectBuffers.set(data, buffers);
    }
    // Replacing a PCM effect must not pause or reset the MIDI sequencer.
    this.#stopEffect();
    const start = this.#context.currentTime;
    for (const { time, buffer } of buffers) {
      const source = this.#context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.#effectGain);
      this.#effectSources.add(source);
      source.onended = () => { this.#effectSources.delete(source); source.disconnect(); };
      source.start(start + time);
    }
  }

  #stopEffect(): void {
    for (const source of this.#effectSources) { source.stop(); source.disconnect(); }
    this.#effectSources.clear();
  }

  #apply(): void {
    // Gate BGM independently, including while worklet messages are in flight.
    this.#musicGain.gain.value = this.#current ? 1 : 0;
    const sequencer = this.#sequencer;
    if (!sequencer) return;
    if (!this.#current) {
      sequencer.pause();
      this.#synth?.stopAll(true);
      return;
    }
    // The installed core uses Infinity; the wrapper's -1 JSDoc is stale.
    sequencer.loopCount = this.#current.repeat ? Infinity : 0;
    sequencer.loadNewSongList([{ binary: this.#current.midi.buffer, fileName: "Rhythm Star BGM.mid" }]);
    sequencer.play();
  }

  close(): void {
    this.stop();
    void this.#ready.then(() => this.#context.close()).catch(this.onError);
  }
}
