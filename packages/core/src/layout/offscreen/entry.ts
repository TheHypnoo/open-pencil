import { SkiaRenderer } from '#core/canvas'
import { browserCanvasKitLocate, getCanvasKit } from '#core/canvaskit'
import type { TextMeasurer } from '#core/layout/text-measurement'

import { layoutOffscreen, type OffscreenLayoutRequest, type OffscreenLayoutResponse } from './index'

/**
 * The worker side of an offscreen layout run. It owns its own CanvasKit and answers the text
 * measurements a layout asks for, which is the reason the run leaves the main thread at all.
 */
let measurer: TextMeasurer | null = null

async function prepareMeasurer(): Promise<TextMeasurer> {
  // `getCanvasKit`'s default locator asks the environment whether it is a browser, and a worker
  // is not one by that test; naming the files directly is what a worker can rely on.
  const ck = await getCanvasKit({ locateFile: browserCanvasKitLocate })
  const surface = ck.MakeSurface(1, 1)
  if (!surface) throw new Error('CanvasKit could not make a surface to measure text')
  const renderer = new SkiaRenderer(ck, surface)
  await renderer.loadFonts()
  return (node, maxWidth) => renderer.measureTextNode(node, maxWidth)
}

function answer(port: MessagePort, response: OffscreenLayoutResponse): void {
  port.postMessage(response, [])
}

async function handle(request: OffscreenLayoutRequest, port: MessagePort): Promise<void> {
  try {
    measurer ??= await prepareMeasurer()
    answer(port, layoutOffscreen(request, measurer))
  } catch (error) {
    answer(port, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

// The request carries the port to answer on, so nothing here posts to the worker's own scope.
self.onmessage = (event: MessageEvent<OffscreenLayoutRequest>) => {
  void handle(event.data, event.ports[0])
}
