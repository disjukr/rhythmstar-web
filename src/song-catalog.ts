import songPaths from "../assets/songs.json";
import { parseMus, type RhythmChart } from "./chart";

export function loadSongCatalog(read: (path: string) => Uint8Array, paths: readonly string[] = songPaths): RhythmChart[][] {
  const catalog: RhythmChart[][] = [[], [], []];
  const seen = new Set<string>();
  for (const path of paths) {
    // Native musicdata.dat stores a zero-terminated 32-byte path as the record ID.
    if (seen.has(path) || new TextEncoder().encode(path).length > 31) throw new Error(`Invalid or duplicate song ID: ${path}`);
    seen.add(path);
    const chart = parseMus(path, read(path));
    read(`res/Mmf/${chart.audioFilename}`);
    catalog[chart.keyCount / 3 - 1].push(chart);
  }
  if (catalog.some(charts => !charts.length)) throw new Error("Song catalog needs at least one chart for each key mode");
  return catalog;
}
