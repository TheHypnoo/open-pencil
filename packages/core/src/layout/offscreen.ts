import type { SceneNode } from '@open-pencil/scene-graph'
import { SceneGraph } from '@open-pencil/scene-graph'

import { computeAllLayouts } from '#core/layout'
import { installTextMeasurer, type TextMeasurer } from './text-measurement'
import { fontManager } from '#core/text'

/**
 * Layout can run in a worker, so a large document does not freeze the window while CanvasKit
 * measures its text. The worker cannot share the live graph, so a layout run crosses the boundary
 * as plain data: a snapshot in, the geometry it produced out, applied back on the main thread.
 *
 * Measurement stays with the caller: the layout engine asks for text sizes synchronously, and only
 * the side that owns CanvasKit and the document's fonts can answer.
 */

/** One node as plain data, so a worker can receive the document it must lay out. */
export interface OffscreenLayoutNode {
  id: string
  type: SceneNode['type']
  parentId: string | null
  props: Partial<SceneNode>
}

/** A font face the layout needs, carried as the bytes the main thread already loaded. */
export interface OffscreenLayoutFont {
  family: string
  style: string
  data: ArrayBuffer
}

/** What layout decided for one node. */
export type OffscreenLayoutGeometry = Array<
  [string, Partial<Pick<SceneNode, 'x' | 'y' | 'width' | 'height' | 'vectorNetwork'>>]
>

export interface OffscreenLayoutRequest {
  nodes: OffscreenLayoutNode[]
  fonts: OffscreenLayoutFont[]
  /** The frame or page to lay out; null lays out the whole document. */
  scopeId: string | null
}

export type OffscreenLayoutResponse =
  | { type: 'geometry'; geometry: OffscreenLayoutGeometry; durationMs: number }
  | { type: 'error'; message: string }

/** Every node as plain data. A worker rebuilds the document from this. */
export function snapshotOffscreenLayout(graph: SceneGraph): OffscreenLayoutNode[] {
  const nodes: OffscreenLayoutNode[] = []
  for (const node of graph.nodes.values()) {
    const { parentId, childIds: _childIds, ...props } = node
    nodes.push({ id: node.id, type: node.type, parentId, props: structuredClone(props) })
  }
  return nodes
}

/** The bytes of the faces a layout needs, for the side that has them loaded. */
export function snapshotOffscreenFonts(keys: ReadonlyArray<[string, string]>): OffscreenLayoutFont[] {
  const fonts: OffscreenLayoutFont[] = []
  for (const [family, style] of keys) {
    const data = fontManager.loadedData(family, style)
    if (data) fonts.push({ family, style, data })
  }
  return fonts
}

/** Rebuilds a document from a snapshot, parents first so every child has somewhere to go. */
export function restoreOffscreenGraph(nodes: readonly OffscreenLayoutNode[]): SceneGraph {
  const graph = new SceneGraph()
  // The constructor always seeds a document root, and it cannot be removed, so the snapshot's root
  // takes it over: its props are applied to the seeded node and its id is remapped. Every other id
  // is preserved, so a page id still scopes the run the same way it did on the main thread.
  for (const page of graph.getPages(true)) graph.deleteNode(page.id)

  const root = nodes.find((node) => node.parentId === null)
  const remap = new Map<string, string>()
  if (root) {
    remap.set(root.id, graph.rootId)
    graph.updateNode(graph.rootId, root.props)
  }
  const resolve = (id: string) => remap.get(id) ?? id

  const pending = new Map(
    nodes.filter((node) => node !== root).map((node) => [node.id, node] as const)
  )
  let placed = true
  while (pending.size > 0 && placed) {
    placed = false
    for (const [id, node] of pending) {
      const parentId = node.parentId === null ? null : resolve(node.parentId)
      if (parentId !== null && !graph.getNode(parentId)) continue
      graph.createNodeWithId(id, node.type, parentId, node.props)
      pending.delete(id)
      placed = true
    }
  }
  return graph
}

/** The geometry a layout run produced, ready to send back. */
export function readOffscreenGeometry(graph: SceneGraph): OffscreenLayoutGeometry {
  const geometry: OffscreenLayoutGeometry = []
  for (const node of graph.nodes.values()) {
    geometry.push([
      node.id,
      {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        ...(node.vectorNetwork ? { vectorNetwork: structuredClone(node.vectorNetwork) } : {})
      }
    ])
  }
  return geometry
}

/**
 * Applies geometry a layout run produced elsewhere. It arrives as derived layout, so constraints
 * are not re-applied over values the run already accounted for.
 */
export function applyOffscreenGeometry(
  graph: SceneGraph,
  geometry: OffscreenLayoutGeometry
): void {
  graph.applyDerivedLayoutDuring(() => {
    for (const [id, fields] of geometry) {
      if (graph.getNode(id)) graph.updateNode(id, fields)
    }
  })
}

/**
 * Lays out a snapshot, whatever thread this runs on. The caller supplies the measurer, because
 * only the side holding CanvasKit and the document's fonts can answer what a text measures.
 */
export function layoutOffscreen(
  request: OffscreenLayoutRequest,
  measurer: TextMeasurer
): OffscreenLayoutResponse {
  try {
    for (const font of request.fonts) fontManager.markLoaded(font.family, font.style, font.data)
    const graph = restoreOffscreenGraph(request.nodes)
    const restoreMeasurer = installTextMeasurer(measurer)
    try {
      const started = performance.now()
      graph.applyDerivedLayoutDuring(() =>
        computeAllLayouts(graph, request.scopeId ?? undefined)
      )
      return {
        type: 'geometry',
        geometry: readOffscreenGeometry(graph),
        durationMs: performance.now() - started
      }
    } finally {
      restoreMeasurer()
    }
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
