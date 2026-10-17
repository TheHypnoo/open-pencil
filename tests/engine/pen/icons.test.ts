import { describe, expect, test } from 'bun:test'

import { parsePenDocument, type PenNode } from '@open-pencil/pen'
import { colorToHex } from '@open-pencil/scene-graph/color'

function at<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value')
  return value
}

function pen(child: PenNode): string {
  return JSON.stringify({ version: '2.8', children: [child] })
}

function read(json: string, name: string) {
  const { graph } = parsePenDocument(json)
  // A page takes the name of the document's first child, so it can shadow the node under test.
  const nodes = [...graph.getAllNodes()].filter((node) => node.type !== 'CANVAS')
  return at(nodes.find((node) => node.name === name))
}

const ICON: PenNode = {
  type: 'icon',
  id: 'i1',
  name: 'Search icon',
  icon: 'message-circle',
  library: 'lucide',
  width: 24,
  height: 24,
  fill: '#ff0000'
}

/** The plugin-data entries this importer writes for a `.pen` document. */
const PEN_PLUGIN = 'openpencil.pen'

describe('an icon node', () => {
  test('keeps the library reference instead of losing it', () => {
    const node = read(pen(ICON), 'Search icon')
    const entries = node.pluginData ?? []

    expect(entries).toContainEqual({ pluginId: PEN_PLUGIN, key: 'icon', value: 'message-circle' })
    expect(entries).toContainEqual({ pluginId: PEN_PLUGIN, key: 'library', value: 'lucide' })
  })

  test('keeps its box and fill, so it still occupies its place in the layout', () => {
    const node = read(pen(ICON), 'Search icon')

    expect(node.width).toBe(24)
    expect(colorToHex(at(node.fills[0]).color)).toBe('#FF0000')
  })

  test('is not reported as an unsupported node type any more', () => {
    expect(parsePenDocument(pen(ICON)).diagnostics).toEqual([])
  })

  test('keeps the reference even when the document names no library', () => {
    const node = read(pen({ ...ICON, library: undefined }), 'Search icon')
    const entries = node.pluginData ?? []

    expect(entries).toContainEqual({ pluginId: PEN_PLUGIN, key: 'icon', value: 'message-circle' })
  })
})

describe('a node type with no equivalent', () => {
  test('is still reported', () => {
    const json = pen({ type: 'polygon', id: 'p1', name: 'Poly' })

    expect(parsePenDocument(json).diagnostics.map((d) => d.code)).toEqual(['unsupported-node-type'])
  })
})
