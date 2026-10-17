import { fontManager } from '#core/text/fonts'

import {
  snapshotOffscreenFonts,
  snapshotOffscreenLayout,
  type OffscreenLayoutRequest,
  type OffscreenLayoutResponse,
  type OffscreenLayoutRunner
} from './index'

/** How long a run may take before the document is laid out where it lives instead. */
const LAYOUT_WORKER_TIMEOUT_MS = 12_000

/**
 * Builds the runner that lays a document out in a worker.
 *
 * It answers null whenever the worker cannot, and the caller then lays the document out where it
 * lives: an unavailable worker costs the wait it always did, never a document that fails to open.
 */
export function createOffscreenLayoutRunner(): OffscreenLayoutRunner {
  let worker: Worker | null = null

  const ensureWorker = (): Worker | null => {
    if (typeof Worker === 'undefined') return null
    worker ??= new Worker(new URL('./entry.ts', import.meta.url), {
      type: 'module'
    })
    return worker
  }

  return async (graph, scopeId) => {
    const running = ensureWorker()
    if (!running) return null

    const request: OffscreenLayoutRequest = {
      nodes: snapshotOffscreenLayout(graph),
      fonts: snapshotOffscreenFonts(fontManager.collectFontKeys(graph, [...graph.nodes.keys()])),
      scopeId
    }
    const channel = new MessageChannel()
    let failure = ''
    const response = await new Promise<OffscreenLayoutResponse>((resolve, reject) => {
      setTimeout(() => reject(new Error('the layout worker timed out')), LAYOUT_WORKER_TIMEOUT_MS)
      channel.port1.onmessage = (event: MessageEvent<OffscreenLayoutResponse>) =>
        resolve(event.data)
      running.onerror = (event: ErrorEvent) =>
        reject(new Error(event.message || 'the layout worker failed'))
      running.postMessage(request, [channel.port2])
    }).catch((error: unknown): null => {
      failure = error instanceof Error ? error.message : String(error)
      return null
    })
    channel.port1.close()

    if (response?.type !== 'geometry') {
      // A worker that could not answer is dropped, so the next document starts a fresh one. The
      // document is still laid out in this thread, so the only cost is the wait that always was.
      console.warn(
        `[layout] the offscreen runner could not answer${failure ? ` (${failure})` : ''}; laying the document out in this thread`
      )
      running.terminate()
      worker = null
      return null
    }
    return response.geometry
  }
}
