import { describe, expect, test } from 'bun:test'

import { computeAllLayouts } from '@open-pencil/core/layout'
import {
  fillSizingFields,
  SceneGraph,
  type SceneNode,
  type VectorNetwork
} from '@open-pencil/scene-graph'

function at<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value')
  return value
}

/** A closed square whose vertices span `size`, as `.pen` bakes a path at the size it was drawn. */
function square(size: number): VectorNetwork {
  const corners = [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size }
  ]
  return {
    vertices: corners.map((corner) => ({ ...corner })),
    segments: corners.map((_, index) => ({
      start: index,
      end: (index + 1) % corners.length,
      tangentStart: { x: 0, y: 0 },
      tangentEnd: { x: 0, y: 0 }
    })),
    regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }]
  }
}

function geometryBox(network: VectorNetwork) {
  const xs = network.vertices.map((vertex) => vertex.x)
  const ys = network.vertices.map((vertex) => vertex.y)
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  }
}

/**
 * A fixed 16×16 column holding one vector. By default the vector stretches across the counter
 * axis, so the layout gives it a width the geometry it was drawn at does not match.
 */
function columnWith(overrides: Partial<SceneNode>): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', page, {
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    width: 16,
    height: 16
  })
  graph.createNode('VECTOR', frame.id, {
    width: 64,
    height: 64,
    vectorNetwork: square(64),
    ...fillSizingFields('VERTICAL', 'HORIZONTAL'),
    ...overrides
  })
  return graph
}

function vectorOf(graph: SceneGraph): SceneNode {
  return at([...graph.getAllNodes()].find((node) => node.type === 'VECTOR'))
}

describe('a vector whose size the layout changes', () => {
  test('follows each axis the layout changes, so it stays inside its box', () => {
    const graph = columnWith({})
    computeAllLayouts(graph)
    const vector = vectorOf(graph)

    // The column stretches the counter axis only, so the width follows it and the height stays.
    expect(Math.round(vector.width)).toBe(16)
    expect(Math.round(vector.height)).toBe(64)
    expect(geometryBox(at(vector.vectorNetwork ?? undefined))).toEqual({ width: 16, height: 64 })
  })

  test('keeps its geometry when the layout leaves its size alone', () => {
    const graph = columnWith({
      layoutAlignSelf: 'AUTO',
      layoutGrow: 0,
      width: 16,
      height: 16,
      vectorNetwork: square(16)
    })
    computeAllLayouts(graph)
    const vector = vectorOf(graph)

    expect(Math.round(vector.width)).toBe(16)
    expect(geometryBox(at(vector.vectorNetwork ?? undefined))).toEqual({ width: 16, height: 16 })
  })
})
