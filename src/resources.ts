import { ResourceStore } from "./io";

/** Preload individual files so the original synchronous game logic can read them. */
export async function loadResources(urls: Readonly<Record<string, string>>): Promise<ResourceStore> {
  const entries = await Promise.all(Object.entries(urls).map(async ([path, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Resource request failed: ${path} (${response.status})`);
    return [path, new Uint8Array(await response.arrayBuffer())] as const;
  }));
  return new ResourceStore(Object.fromEntries(entries));
}
