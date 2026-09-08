import { Rgb565Framebuffer } from "./framebuffer";
import { VrpArchive, VrpPlayer } from "./vrp";

/** Overlay child 0x114640, requested on the fifth game-over update. */
export class GameOverScreen {
  readonly #players: VrpPlayer[];
  #finished = false;
  ready = false;
  constructor(archive: VrpArchive) {
    this.#players = [27, 29].map(animation => new VrpPlayer(archive, animation, false));
  }
  update(delta: number): void {
    if (this.#finished) this.ready = true;
    this.#players[0].update(delta);
    if (this.#players[1].update(delta) && !this.#finished) {
      this.#players[1].select(28);
      this.#finished = true;
    }
  }
  draw(target: Rgb565Framebuffer): void {
    for (const player of this.#players) player.draw(target);
  }
}
