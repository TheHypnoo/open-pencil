import { computeImageHash, type Fill, type SceneGraph } from '@open-pencil/scene-graph'

import { isTauri } from '@/app/tauri/env'

/** Bounds one image, so a single huge or slow one cannot hold up the rest. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 20_000
/** Images come from unrelated hosts, so a few at a time is enough and kinder to them. */
const CONCURRENCY = 6

/** Reads one url's bytes, or nothing when it cannot be read. */
export type ImageFetcher = (url: string, signal: AbortSignal) => Promise<Uint8Array | undefined>

/**
 * The fills in this graph that point at a remote url and have no bytes yet, grouped by that url.
 *
 * Reading them from the graph rather than from the import means a fill cloned from a component is
 * covered too: a clone copies its source's fill, including the url it came from.
 */
function pendingByURL(graph: SceneGraph): Map<string, Fill[]> {
  const byURL = new Map<string, Fill[]>()
  for (const node of graph.getAllNodes()) {
    for (const fill of node.fills) {
      const url = fill.imageURL
      if (fill.type !== 'IMAGE' || fill.imageHash !== undefined) continue
      if (url === undefined || !/^https?:/i.test(url)) continue
      const list = byURL.get(url)
      if (list) list.push(fill)
      else byURL.set(url, [fill])
    }
  }
  return byURL
}

/** Splits the work into as many lanes as we allow in flight, so each lane runs in order. */
function lanes(values: string[], count: number): string[][] {
  return Array.from({ length: count }, (_, lane) =>
    values.filter((_, index) => index % count === lane)
  )
}

async function fetchImageBytes(url: string, signal: AbortSignal): Promise<Uint8Array | undefined> {
  let response: Response
  if (isTauri()) {
    const { tauriFetch } = await import('@/app/tauri/http')
    response = await tauriFetch(url, { signal }, MAX_IMAGE_BYTES, IMAGE_TIMEOUT_MS)
  } else {
    response = await fetch(url, { signal })
  }
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined
}

async function readImage(
  url: string,
  fetchImage: ImageFetcher,
  signal: AbortSignal
): Promise<Uint8Array | undefined> {
  try {
    return await fetchImage(url, signal)
  } catch (error) {
    if (signal.aborted) return undefined
    console.warn(`[pen] Could not fetch the image "${url}"`, error)
    return undefined
  }
}

/**
 * Fetches the images a document references by url but could not read when it was opened, and
 * gives their fills pixels as they arrive.
 *
 * Each url is read once however many fills point at it. An image that cannot be fetched leaves
 * its fills as they are, so a stale or unreachable url costs nothing beyond a warning. Callers
 * pass their own fetcher because the desktop build must reach images through the native bridge to
 * skip the webview's CORS rules.
 */
export async function applyRemoteImages(
  graph: SceneGraph,
  fetchImage: ImageFetcher,
  onImageLoaded?: (url: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const byURL = pendingByURL(graph)
  const urls = [...byURL.keys()]
  if (urls.length === 0) return
  const stop = signal ?? new AbortController().signal

  await Promise.all(
    lanes(urls, Math.min(CONCURRENCY, urls.length)).map(async (lane) => {
      for (const url of lane) {
        if (stop.aborted) return
        // An abort mid-flight makes the read answer nothing, so the bytes already carry that.
        const bytes = await readImage(url, fetchImage, stop)
        if (!bytes) continue
        const hash = computeImageHash(bytes)
        graph.images.set(hash, bytes)
        for (const fill of byURL.get(url) ?? []) fill.imageHash = hash
        onImageLoaded?.(url)
      }
    })
  )
}

/**
 * Reads a document's remote images once it is on screen, repainting as each one lands. Opening a
 * document never waits on this: it is started and left to finish on its own.
 */
export function hydrateImages(graph: SceneGraph, requestRender: () => void): void {
  void applyRemoteImages(graph, fetchImageBytes, requestRender)
}
