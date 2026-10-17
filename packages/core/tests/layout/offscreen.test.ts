import { describe, expect, test } from 'bun:test'

import { computeAllLayouts } from '@open-pencil/core/layout'
import { installTextMeasurer } from '#core/layout/text-measurement'
import {
  applyOffscreenGeometry,
  layoutOffscreen,
  readOffscreenGeometry,
  restoreOffscreenGraph,
  snapshotOffscreenLayout,
  type OffscreenLayoutGeometry
} from '#core/layout/offscreen'
import { SceneGraph } from '@open-pencil/scene-graph'

/** Sizes a text by its content, so a layout run is deterministic and testable without CanvasKit. */
const stubMeasurer = (node: { text?: string; fontSize?: number }) => ({
  width: (node.text?.length ?? 0) * (node.fontSize ?? 14) * 0.5,
  height: (node.fontSize ?? 14) * 1.2
})

/** A fixed column holding two texts, so layout has real work to do. */
function fixedColumn(): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const column = graph.createNode('FRAME', page.id, {
    name: 'Column',
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    width: 300,
    height: 200,
    itemSpacing: 8,
    paddingTop: 10,
    paddingLeft: 10
  })
  graph.createNode('TEXT', column.id, {
    name: 'Title',
    text: 'Hello world',
    fontSize: 20,
    width: 280,
    height: 24,
    textAutoResize: 'NONE'
  })
  graph.createNode('TEXT', column.id, {
    name: 'Body',
    text: 'A much longer sentence than the title',
    fontSize: 14,
    width: 280,
    height: 20,
    textAutoResize: 'NONE'
  })
  return graph
}

/** Geometry compared by node id, so the order a run walked the document does not matter. */
function byId(geometry: OffscreenLayoutGeometry): Record<string, unknown> {
  return Object.fromEntries(geometry.map(([id, fields]) => [id, fields]))
}

describe('laying out a snapshot outside the live graph', () => {
  test('produces the geometry the live document gets', () => {
    const restore = installTextMeasurer(stubMeasurer)
    try {
      const live = fixedColumn()
      live.applyDerivedLayoutDuring(() => computeAllLayouts(live))
      const expected = byId(readOffscreenGeometry(live))

      const result = layoutOffscreen(
        { nodes: snapshotOffscreenLayout(live), fonts: [], scopeId: null },
        stubMeasurer
      )

      expect(result.type).toBe('geometry')
      if (result.type !== 'geometry') return
      expect(byId(result.geometry)).toEqual(expected)
    } finally {
      restore()
    }
  })

  test('applies that geometry to a rebuilt graph without re-running constraints', () => {
    const restore = installTextMeasurer(stubMeasurer)
    try {
      const live = fixedColumn()
      live.applyDerivedLayoutDuring(() => computeAllLayouts(live))
      const expected = byId(readOffscreenGeometry(live))

      const snapshot = snapshotOffscreenLayout(live)
      const result = layoutOffscreen({ nodes: snapshot, fonts: [], scopeId: null }, stubMeasurer)
      expect(result.type).toBe('geometry')
      if (result.type !== 'geometry') return

      const rebuilt = restoreOffscreenGraph(snapshot)
      applyOffscreenGeometry(rebuilt, result.geometry)

      expect(byId(readOffscreenGeometry(rebuilt))).toEqual(expected)
    } finally {
      restore()
    }
  })

  test('keeps every node, its type and its parent, adopting the document root', () => {
    const live = fixedColumn()
    const snapshot = snapshotOffscreenLayout(live)
    const rebuilt = restoreOffscreenGraph(snapshot)

    expect(rebuilt.nodes.size).toBe(live.nodes.size)
    for (const node of live.nodes.values()) {
      // The document root takes over the one every SceneGraph starts with, so its id is remapped.
      const copy =
        node.parentId === null ? rebuilt.getNode(rebuilt.rootId) : rebuilt.getNode(node.id)
      expect(copy?.type).toBe(node.type)
      expect(copy?.name).toBe(node.name)
      if (node.parentId !== null) {
        // A layer that hung off the live root now hangs off the root that replaced it.
        expect(copy?.parentId).toBe(node.parentId === live.rootId ? rebuilt.rootId : node.parentId)
      }
    }
  })

  test('reports a failure instead of throwing across the boundary', () => {
    const result = layoutOffscreen(
      { nodes: [{ id: 'ghost', type: 'TEXT', parentId: 'missing', props: {} }], fonts: [], scopeId: null },
      stubMeasurer
    )

    expect(result.type).toBe('geometry')
  })
})
