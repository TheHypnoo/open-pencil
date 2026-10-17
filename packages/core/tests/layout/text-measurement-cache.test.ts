import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  clearTextMeasurements,
  installTextMeasurer,
  measureTextForLayout,
  withTextMeasurer
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

  test('measures again when the fonts change, since every cached size is stale', () => {
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

  test('measures again when a run of the text carries its own style', () => {
    const graph = new SceneGraph()
    const { counts, restore } = countingMeasurer()
    clearTextMeasurements()
    try {
      measureTextForLayout(textNode(graph))
      measureTextForLayout(
        textNode(graph, {
          styleRuns: [{ start: 0, length: 4, style: { fontWeight: 700 } }]
        })
      )

      // Shaped bold text is a different shape, so a plain run's size cannot answer for it.
      expect(counts.calls).toBe(2)
    } finally {
      restore()
    }
  })

  test('measures again when a paragraph setting differs, because spacing changes the height', () => {
    const graph = new SceneGraph()
    const { counts, restore } = countingMeasurer()
    clearTextMeasurements()
    try {
      measureTextForLayout(textNode(graph))
      measureTextForLayout(textNode(graph, { paragraphSpacing: 8 }))

      expect(counts.calls).toBe(2)
    } finally {
      restore()
    }
  })

  test('answers a temporary measurer with its own sizes, never the installed one\u2019s', () => {
    const graph = new SceneGraph()
    const node = textNode(graph)
    const restore = installTextMeasurer(() => ({ width: 10, height: 10 }))
    clearTextMeasurements()
    try {
      expect(measureTextForLayout(node).width).toBe(10)

      const swapped = withTextMeasurer(
        () => ({ width: 20, height: 10 }),
        () => measureTextForLayout(node)
      )

      expect(swapped.width).toBe(20)
      // The installed measurer's own answer is still its own once the override is over.
      expect(measureTextForLayout(node).width).toBe(10)
    } finally {
      restore()
    }
  })

  test('keeps each temporary measurer\u2019s sizes out of the next one\u2019s way', () => {
    const graph = new SceneGraph()
    const node = textNode(graph)
    clearTextMeasurements()

    const first = withTextMeasurer(
      () => ({ width: 30, height: 10 }),
      () => measureTextForLayout(node).width
    )
    const second = withTextMeasurer(
      () => ({ width: 40, height: 10 }),
      () => measureTextForLayout(node).width
    )

    expect([first, second]).toEqual([30, 40])
  })

  test('estimates when no measurer is installed, rather than caching nothing', () => {
    const graph = new SceneGraph()
    clearTextMeasurements()
    const size = measureTextForLayout(textNode(graph))

    expect(size.height).toBeGreaterThan(0)
  })
})
