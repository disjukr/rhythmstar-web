// Planet records at 0x137068: score multiplier, mirror, random, speed, cost.
export const PLANETS = [
  { name: '시리우스', multiplier: 72089, mirror: false, random: false, speed: 32768, cost: 4 },
  { name: '카펠라', multiplier: 78643, mirror: false, random: false, speed: 131072, cost: 4 },
  { name: '베텔기우스', multiplier: 98304, mirror: false, random: false, speed: 196608, cost: 9 },
  { name: '안타레스', multiplier: 91750, mirror: true, random: false, speed: 65536, cost: 6 },
  { name: '모노세티스', multiplier: 104857, mirror: false, random: true, speed: 65536, cost: 7 },
  { name: '레오니스', multiplier: 104857, mirror: true, random: false, speed: 32768, cost: 9 },
  { name: '도라두스', multiplier: 114688, mirror: true, random: false, speed: 131072, cost: 12 },
  { name: '라슈퍼바', multiplier: 137625, mirror: true, random: false, speed: 196608, cost: 14 },
  { name: '사이그니', multiplier: 124518, mirror: false, random: true, speed: 32768, cost: 11 },
  { name: '사지타리', multiplier: 131072, mirror: false, random: true, speed: 131072, cost: 13 },
  { name: 'VV사이퍼', multiplier: 163840, mirror: false, random: true, speed: 196608, cost: 15 },
] as const;
