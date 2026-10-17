import { describe, expect, test } from 'bun:test'

import { parsePenDocument, parsePenFile, type PenDiagnostic, type PenNode } from '@open-pencil/pen'

import { repoPath } from '#tests/helpers/paths'

const FIXTURE_DIR = repoPath('tests/fixtures')

async function loadFixture(name: string): Promise<string> {
  return Bun.file(`${FIXTURE_DIR}/${name}`).text()
}

function penDoc(children: PenNode[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: '2.8', children, ...extra })
}

function diagnosticsFor(json: string): PenDiagnostic[] {
  return [...parsePenDocument(json).diagnostics]
}

function codesFor(json: string): string[] {
  return diagnosticsFor(json).map((diagnostic) => diagnostic.code)
}

function at<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value')
  return value
}

function first(json: string): PenDiagnostic {
  return at(diagnosticsFor(json)[0])
}

describe('pen import diagnostics', () => {
  test('reports nothing for a document it represents faithfully', () => {
    const json = penDoc([
      {
        type: 'rectangle',
        id: 'r1',
        name: 'Rect',
        width: 100,
        height: 100,
        fill: '#ff0000'
      }
    ])

    expect(diagnosticsFor(json)).toEqual([])
  })

  test('reports a node type it has no equivalent for, naming the declared type', () => {
    const json = penDoc([{ type: 'polygon', id: 'p1', name: 'Poly' }])
    const diagnostic = first(json)

    expect(diagnostic.code).toBe('unsupported-node-type')
    expect(diagnostic.severity).toBe('degraded')
    expect(diagnostic.path).toBe('children[0]')
    expect(diagnostic.nodeId).toBe('p1')
    expect(diagnostic.nodeName).toBe('Poly')
    expect(diagnostic.nodeType).toBe('polygon')
  })

  test('reports a dropped node at its document path', () => {
    const json = penDoc([
      { type: 'frame', id: 'f1', name: 'Frame', layout: 'none', children: [] },
      { type: 'prompt', id: 'pr1', name: 'Ask AI', content: 'hello' }
    ])

    expect(codesFor(json)).toEqual(['dropped-node'])
    expect(first(json).path).toBe('children[1]')
    expect(first(json).nodeId).toBe('pr1')
  })

  test('reports a fill type it approximates as solid, naming the declared type', () => {
    const json = penDoc([
      {
        type: 'rectangle',
        id: 'v1',
        name: 'Video',
        width: 50,
        height: 50,
        fill: { type: 'video' }
      }
    ])
    const diagnostic = first(json)

    expect(diagnostic.code).toBe('unsupported-fill')
    expect(diagnostic.severity).toBe('degraded')
    expect(diagnostic.property).toBe('fill')
    expect(diagnostic.value).toBe('video')
  })

  test('reports nothing for a plain colour object fill', () => {
    const json = penDoc([
      {
        type: 'rectangle',
        id: 'c1',
        name: 'Plain',
        width: 50,
        height: 50,
        fill: { type: 'color', color: '#ff0000', enabled: true }
      }
    ])

    expect(diagnosticsFor(json)).toEqual([])
  })

  test('reports a stroke it drops for having no fill', () => {
    const json = penDoc([
      {
        type: 'rectangle',
        id: 's1',
        name: 'NoFill',
        width: 50,
        height: 50,
        stroke: { align: 'inside', thickness: 1 }
      }
    ])
    const diagnostic = first(json)

    expect(diagnostic.code).toBe('dropped-stroke')
    expect(diagnostic.severity).toBe('dropped')
    expect(diagnostic.property).toBe('stroke')
  })

  test('reports an effect type it drops, naming the declared type', () => {
    const json = penDoc([
      {
        type: 'rectangle',
        id: 'e1',
        name: 'Blurred',
        width: 50,
        height: 50,
        effect: { type: 'blur', blur: 4 }
      }
    ])
    const diagnostic = first(json)

    expect(diagnostic.code).toBe('unsupported-effect')
    expect(diagnostic.severity).toBe('dropped')
    expect(diagnostic.property).toBe('effect')
    expect(diagnostic.value).toBe('blur')
  })

  test('reports a variable reference the document never declares', () => {
    const json = penDoc(
      [
        {
          type: 'rectangle',
          id: 'v1',
          name: 'Varved',
          width: 50,
          height: 50,
          fill: '$--nope'
        }
      ],
      { variables: {} }
    )
    const diagnostic = first(json)

    expect(diagnostic.code).toBe('unresolved-variable')
    expect(diagnostic.severity).toBe('degraded')
    expect(diagnostic.value).toBe('$--nope')
  })

  test('reports nothing for a variable reference the document declares', () => {
    const json = penDoc(
      [
        {
          type: 'rectangle',
          id: 'v2',
          name: 'Varved',
          width: 50,
          height: 50,
          fill: '$--brand'
        }
      ],
      { variables: { '--brand': { type: 'color', value: '#123456' } } }
    )

    expect(diagnosticsFor(json)).toEqual([])
  })

  test('reports a ref whose component is absent from the document', () => {
    const json = penDoc([{ type: 'ref', id: 'i1', name: 'Orphan', ref: 'never-defined' }])
    const diagnostic = first(json)

    expect(diagnostic.code).toBe('unresolved-component')
    expect(diagnostic.severity).toBe('degraded')
    expect(diagnostic.nodeId).toBe('i1')
    expect(diagnostic.value).toBe('never-defined')
  })

  test('reports a descendant override with nothing to apply it to', () => {
    const json = penDoc([
      {
        type: 'frame',
        id: 'c1',
        name: 'Card',
        reusable: true,
        width: 100,
        height: 100,
        children: [{ type: 'text', id: 't1', name: 'Title', content: 'Hi' }]
      },
      {
        type: 'ref',
        id: 'inst1',
        name: 'Card instance',
        ref: 'c1',
        width: 100,
        height: 100,
        descendants: { 'ghost-id': { name: 'Ghost', content: 'x' } }
      }
    ])
    const diagnostic = first(json)

    expect(diagnostic.code).toBe('dropped-override')
    expect(diagnostic.severity).toBe('dropped')
    expect(diagnostic.path).toContain('ghost-id')
  })

  test('names the document path of a nested loss', () => {
    const json = penDoc([
      {
        type: 'frame',
        id: 'outer',
        name: 'Outer',
        layout: 'vertical',
        width: 200,
        height: 200,
        children: [{ type: 'polygon', id: 'inner', name: 'Inner' }]
      }
    ])

    expect(first(json).path).toBe('children[0].children[0]')
  })
})

describe('pen import diagnostics describe a graph they did not change', () => {
  /** Generated node ids are random per graph, so compare the observable tree instead. */
  function summarize(graph: ReturnType<typeof parsePenFile>) {
    const rows: unknown[] = []
    const walk = (nodeId: string, depth: number) => {
      const node = graph.getNode(nodeId)
      if (!node) return
      rows.push({
        depth,
        type: node.type,
        name: node.name,
        width: node.width,
        height: node.height,
        fills: node.fills,
        strokes: node.strokes,
        effects: node.effects,
        text: node.text,
        layoutMode: node.layoutMode
      })
      for (const childId of node.childIds) walk(childId, depth + 1)
    }
    for (const page of graph.getPages()) {
      rows.push({ page: page.name })
      for (const childId of page.childIds) walk(childId, 0)
    }
    return rows
  }

  const fixtures = ['pencil_simple.pen', 'pencil_button.pen', 'pen-variables.pen']

  for (const fixture of fixtures) {
    test(`parsePenDocument builds the same tree as parsePenFile for ${fixture}`, async () => {
      const json = await loadFixture(fixture)

      expect(summarize(parsePenDocument(json).graph)).toEqual(summarize(parsePenFile(json)))
    })
  }

  test('names the losses a real fixture actually declares', async () => {
    const { diagnostics } = parsePenDocument(await loadFixture('pencil_simple.pen'))

    // This fixture declares 28 strokes with an alignment and a thickness but no fill colour.
    expect(diagnostics.filter((d) => d.code === 'dropped-stroke')).toHaveLength(28)
    expect(diagnostics.every((d) => d.path.startsWith('children['))).toBe(true)
  })
})
