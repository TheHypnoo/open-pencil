import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  clearTextMeasurements,
  installTextMeasurer,
  measureTextForLayout
} from '#core/layout/text-measurement'

/** A text node with the fields a measurement reads. */
function textNode(graph: SceneGraph, overrides: Partial<SceneNode> = {}): SceneNode {
  const page = graph.getPages()[0]
  return graph.createNode('TEXT', page.id, {
    text: 'Ver ficha',
    fontSize: 14,
    width: 100,
    height: 20,
    ...overrides
  })
}

/** Counts how often the measurer actually runs, which is what the cache exists to reduce. */
function countingMeasurer() {
  const counts = { calls: 0 }
  const restore = installTextMeasurer(() => {
    counts.calls += 1
    return { width: 10, height: 10 }
  })
  return { counts, restore }
}

describe('the text measurement cache', () => {
  test('measures identical text once, however many nodes carry it', () => {
    const graph = new SceneGraph()
    const first = textNode(graph)
    const clone = textNode(graph)
    const { counts, restore } = countingMeasurer()
    clearTextMeasurements()
    try {
      measureTextForLayout(first)
      measureTextForLayout(clone)

      expect(counts.calls).toBe(1)
    } finally {
      restore()
    }
  })

  test('measures again when the text differs', () => {
    const graph = new SceneGraph()
    const { counts, restore } = countingMeasurer()
    clearTextMeasurements()
    try {
      measureTextForLayout(textNode(graph))
      measureTextForLayout(textNode(graph, { text: 'Otra etiqueta' }))

      expect(counts.calls).toBe(2)
    } finally {
      restore()
    }
  })

  test('measures again when the box differs, because the paragraph is laid out at its width', () => {
    const graph = new SceneGraph()
    const { counts, restore } = countingMeasurer()
    clearTextMeasurements()
    try {
      measureTextForLayout(textNode(graph))
      measureTextForLayout(textNode(graph, { width: 240 }))

      expect(counts.calls).toBe(2)
    } finally {
      restore()
    }
  })

  test('measures again when the constraint differs', () => {
    const graph = new SceneGraph()
    const { counts, restore } = countingMeasurer()
    clearTextMeasurements()
    try {
      const node = textNode(graph)
      measureTextForLayout(node, 80)
      measureTextForLayout(node, 120)

      expect(counts.calls).toBe(2)
    } finally {
      restore()
    }
  })

  test('measures again after the fonts change, since every cached size is stale', () => {
    const graph = new SceneGraph()
    const { counts, restore } = countingMeasurer()
    clearTextMeasurements()
    try {
      const node = textNode(graph)
      measureTextForLayout(node)
      clearTextMeasurements()
      measureTextForLayout(node)

      expect(counts.calls).toBe(2)
    } finally {
      restore()
    }
  })

  test('estimates when no measurer is installed, rather than caching nothing', () => {
    const graph = new SceneGraph()
    clearTextMeasurements()
    const size = measureTextForLayout(textNode(graph))

    expect(size.height).toBeGreaterThan(0)
  })
})
