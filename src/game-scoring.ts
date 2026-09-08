export type HitGrade = 1 | 2 | 3 | 4;
export type Grade = 0 | HitGrade;

/** 0x11188c: the original uses inclusive integer windows, not rounded timestamps. */
export const judgeTiming = (differenceMs: number): Grade => {
  const distance = Math.abs(differenceMs);
  return distance <= 59 ? 4 : distance <= 99 ? 3 : distance <= 149 ? 2 : distance <= 199 ? 1 : 0;
};

const REWARDS = [0, 4, 12, 17, 27];
const GAUGE = [[-3, 0, 0, 1, 3], [-4, -2, 0, 1, 3], [-6, -3, 0, 1, 3]];

/** Semantic fields of the game object's 0x7a4..0x7dc scoring block. */
export class GameScoring {
  score = 0;
  gauge: number;
  gaugeDebt = 0;
  combo = 0;
  maxCombo = 0;
  multiplier = 65536;
  missStreak = 0;
  missPenalty = 0;
  readonly counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  constructor(readonly mode: number, readonly planetMultiplier = 65536) { this.gauge = 80 - mode * 5; }

  // 0x112f24. Hold ticks count toward combo, including ticks without score awards.
  hit(grade: HitGrade, award = true): void {
    this.counts[grade]++;
    this.combo = grade > 1 ? this.combo + 1 : 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (this.combo > 1) this.multiplier = (this.combo <= 19 ? 1 : this.combo <= 39 ? 2 : this.combo <= 69 ? 3 : this.combo <= 99 ? 4 : 5) * 65536;
    if (award) this.award(grade);
  }

  // 0x113190. Gauge recovery first repays the debt accumulated by missed taps.
  award(grade: Grade): void {
    if (grade === 4 && this.missPenalty !== 0) this.missPenalty += 2;
    const scale = Math.floor(this.planetMultiplier * this.multiplier / 65536);
    this.score = Math.min(9_999_999, this.score + Math.floor(REWARDS[grade] * scale / 65536));
    const change = GAUGE[this.mode][grade];
    const debt = this.gaugeDebt + change;
    if (debt < 0) this.gaugeDebt = debt;
    else { this.gaugeDebt = 0; this.gauge += change; }
    this.gauge = Math.min(99, this.gauge);
  }

  // 0x113408. Missed hold segments penalize gauge only on every tenth segment.
  miss(holdIndex?: number): void {
    this.combo = 0;
    this.multiplier = 65536;
    this.counts[0]++;
    if (holdIndex === undefined) this.gaugeDebt -= 15;
    if (holdIndex !== undefined && holdIndex % 10 !== 0) return;
    if (++this.missStreak > 4) { this.missStreak = 0; this.missPenalty -= 2; }
    this.gauge += GAUGE[this.mode][0] + this.missPenalty;
  }

  /** 0x1130a4: result grade, 0 best through 6 worst. */
  rank(): number {
    const [miss, bad, good, great, perfect] = this.counts;
    const total = miss + bad + good + great + perfect;
    if (total === 0) return 6;
    const accuracy = Math.trunc((perfect * 95 + great * 90 + good * 80 + bad - miss * 20) / total);
    const comboRate = Math.trunc(this.combo * 100 / total);
    const value = accuracy + (comboRate <= 29 ? -3 : comboRate <= 70 ? 1 : comboRate <= 99 ? 3 : 5);
    return value <= 70 ? 6 : value <= 74 ? 5 : value <= 79 ? 4 : value <= 89 ? 3 : value <= 94 ? 2 : value <= 99 ? 1 : 0;
  }
}
