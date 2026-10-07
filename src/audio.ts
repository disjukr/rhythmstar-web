import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import soundBankUrl from "../assets/SHS-10.SF2?url";
import type { MusicPort } from "./io";
import { parseSmaf, smafToMidi } from "./smaf";

const bankUrls = import.meta.glob<string>("../assets/*.[sS][fF]2", { query: "?url", import: "default", eager: true });
export const soundBanks = Object.entries(bankUrls).map(([path, url]) => ({
  name: path.split("/").pop()!, url,
})).sort((a, b) => a.name.localeCompare(b.name));

export class BrowserMusic implements MusicPort {
  readonly #context = new AudioContext();
  readonly #ready: Promise<void>;
  #synth: WorkletSynthesizer | undefined;
  #sequencer: Sequencer | undefined;
  #bankId = "gm";
  #switching = false;
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
    this.#ready = this.#initialize();
    void this.#ready.catch(onError);
  }

  async ready(): Promise<void> { await this.#ready; }

  async setSoundBank(url: string): Promise<void> {
    if (!soundBanks.some(bank => bank.url === url)) throw new Error("Unknown sound bank");
    if (this.#switching) throw new Error("Sound bank is already loading");
    this.#switching = true;
    try {
      await this.#ready;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Sound bank request failed (${response.status})`);
      const synth = this.#synth!;
      const nextId = this.#bankId === "gm" ? "alternate" : "gm";
      await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), nextId);
      // Keep the old bank available until its replacement has loaded successfully.
      synth.soundBankManager.priorityOrder = [nextId, this.#bankId];
      await synth.soundBankManager.deleteSoundBank(this.#bankId);
      this.#bankId = nextId;
      // Seeking restores program/controller state with the new bank while keeping
      // the song position and the game's clock unchanged.
      synth.stopAll(true);
      if (this.#current && this.#sequencer) this.#sequencer.currentTime = this.#sequencer.currentTime;
    } finally {
      this.#switching = false;
    }
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
    if (this.#context.state === "closed") return;
    // Where supported, treat game audio as media playback, including on iOS
    // devices with the ring/silent switch enabled.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== "playback") {
      try { session.type = "playback"; } catch (error) { this.onError(error); }
    }
    // Safari can enter "interrupted" after switching apps or locking the phone.
    if (this.#context.state !== "running") void this.#context.resume().catch(this.onError);
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
