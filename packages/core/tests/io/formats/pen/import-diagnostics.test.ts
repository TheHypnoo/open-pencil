import { describe, expect, test } from 'bun:test'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'

const io = new IORegistry(BUILTIN_IO_FORMATS)

function penDoc(children: unknown[]): string {
  return JSON.stringify({ version: '2.8', children })
}

async function readPen(json: string) {
  return io.readDocument({ name: 'sample.pen', data: new TextEncoder().encode(json) })
}

describe('reading a .pen document through the IO registry', () => {
  test('carries the reader diagnostics to the caller', async () => {
    const json = penDoc([
      { type: 'rectangle', id: 'r1', name: 'Rect', width: 100, height: 100, fill: '#ff0000' },
      { type: 'polygon', id: 'p1', name: 'Poly' }
    ])

    const { sourceFormat, diagnostics } = await readPen(json)

    expect(sourceFormat).toBe('pen')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics?.[0]?.code).toBe('unsupported-node-type')
    expect(diagnostics?.[0]?.path).toBe('children[1]')
  })

  test('reports an empty list, not nothing, for a lossless document', async () => {
    const json = penDoc([
      { type: 'rectangle', id: 'r1', name: 'Rect', width: 100, height: 100, fill: '#ff0000' }
    ])

    const { diagnostics } = await readPen(json)

    expect(diagnostics).toEqual([])
  })

  test('still imports the document it reported on', async () => {
    const json = penDoc([
      {
        type: 'frame',
        id: 'f1',
        name: 'Card',
        layout: 'vertical',
        width: 200,
        height: 100,
        children: [
          { type: 'rectangle', id: 'r1', name: 'Rect', width: 100, height: 50, fill: '#ff0000' }
        ]
      }
    ])

    const { graph, diagnostics } = await readPen(json)
    const names = [...graph.getAllNodes()].map((node) => node.name)

    expect(diagnostics).toEqual([])
    expect(names).toContain('Card')
    expect(names).toContain('Rect')
  })
})
