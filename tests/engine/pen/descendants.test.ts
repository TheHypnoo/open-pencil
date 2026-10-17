import { describe, expect, test } from 'bun:test'

import { parsePenDocument, type PenNode } from '@open-pencil/pen'

function at<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value')
  return value
}

/**
 * A component holding a text, a second component holding an instance of the first, and an
 * instance of the second. Pencil addresses the inner text of that instance either directly or by
 * the `parent/child` path it takes to reach it.
 */
function nestedDocument(descendants: Record<string, Partial<PenNode>>): string {
  return JSON.stringify({
    version: '2.8',
    children: [
      {
        type: 'frame',
        id: 'innerComp',
        name: 'Badge',
        reusable: true,
        width: 20,
        height: 20,
        children: [
          { type: 'text', id: 'badgeLabel', name: 'Label', content: 'A', width: 10, height: 10 }
        ]
      },
      {
        type: 'frame',
        id: 'outerComp',
        name: 'Card',
        reusable: true,
        width: 100,
        height: 100,
        children: [
          { type: 'ref', id: 'outerRef', name: 'Badge instance', ref: 'innerComp' },
          { type: 'text', id: 'cardTitle', name: 'Title', content: 'T', width: 40, height: 10 }
        ]
      },
      {
        type: 'ref',
        id: 'inst',
        name: 'Card instance',
        ref: 'outerComp',
        width: 100,
        height: 100,
        descendants
      }
    ]
  })
}

/** Every text inside the named instance, in tree order. */
function textsInside(json: string, instanceName: string): string[] {
  const { graph } = parsePenDocument(json)
  const instance = at(
    [...graph.getAllNodes()].find((node) => node.name === instanceName && node.type === 'INSTANCE')
  )
  const texts: string[] = []
  const walk = (nodeId: string) => {
    const node = graph.getNode(nodeId)
    if (!node) return
    if (node.type === 'TEXT') texts.push(node.text)
    for (const childId of node.childIds) walk(childId)
  }
  for (const childId of instance.childIds) walk(childId)
  return texts
}

describe('a descendant override keyed by a plain node id', () => {
  test('still applies to the matching descendant', () => {
    const json = nestedDocument({ cardTitle: { content: 'Overridden' } })

    expect(textsInside(json, 'Card instance')).toContain('Overridden')
  })
})

describe('a descendant override keyed by a parent/child path', () => {
  test('applies to the node the path reaches', () => {
    const json = nestedDocument({ 'outerRef/badgeLabel': { content: 'Z' } })

    expect(textsInside(json, 'Card instance')).toContain('Z')
  })

  test('reports no loss, because the path resolved', () => {
    const json = nestedDocument({ 'outerRef/badgeLabel': { content: 'Z' } })

    expect(parsePenDocument(json).diagnostics).toEqual([])
  })

  test('still reports the override when the path reaches nothing', () => {
    const json = nestedDocument({ 'noSuchNode/badgeLabel': { content: 'Z' } })

    expect(parsePenDocument(json).diagnostics.map((d) => d.code)).toEqual(['dropped-override'])
  })
})
