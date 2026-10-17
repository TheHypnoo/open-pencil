import { describe, expect, test } from 'bun:test'

import { computeImageHash, SceneGraph, type Fill } from '@open-pencil/scene-graph'

import { applyRemoteImages } from '@/app/document/io/remote-images'

/** A tiny but real PNG signature, so the images have bytes to be named by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
const OTHER_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 4])

function imageFill(properties: Partial<Fill> = {}): Fill {
  return {
    type: 'IMAGE',
    visible: true,
    opacity: 1,
    color: { r: 0, g: 0, b: 0, a: 1 },
    ...properties
  }
}

/** A graph whose page holds one rectangle per node id, each carrying the fills it is given. */
function graphWith(nodes: Record<string, Fill[]>): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  for (const [id, fills] of Object.entries(nodes)) {
    graph.createNode('RECTANGLE', page.id, { id, name: id, width: 10, height: 10, fills })
  }
  return graph
}

function fillAt(graph: SceneGraph, id: string, index = 0): Fill | undefined {
  return graph.getNode(id)?.fills[index]
}

describe('hydrating the images a document references by url', () => {
  test('gives the fill the bytes it fetched, named by their content', async () => {
    const graph = graphWith({ r1: [imageFill({ imageURL: 'https://cdn.test/a.png' })] })

    await applyRemoteImages(graph, async () => PNG)

    expect(fillAt(graph, 'r1')?.imageHash).toBe(computeImageHash(PNG))
    expect(graph.images.get(computeImageHash(PNG))).toEqual(PNG)
  })

  test('reads a url once even when several fills point at it', async () => {
    const url = 'https://cdn.test/a.png'
    const graph = graphWith({
      r1: [imageFill({ imageURL: url })],
      r2: [imageFill({ imageURL: url })]
    })
    let reads = 0

    await applyRemoteImages(graph, async () => {
      reads += 1
      return PNG
    })

    expect(reads).toBe(1)
    expect(fillAt(graph, 'r1')?.imageHash).toBe(computeImageHash(PNG))
    expect(fillAt(graph, 'r2')?.imageHash).toBe(computeImageHash(PNG))
  })

  test('covers a fill cloned from a component, which copies the url but not the bytes', async () => {
    const url = 'https://cdn.test/a.png'
    const graph = graphWith({
      source: [imageFill({ imageURL: url })],
      clone: [imageFill({ imageURL: url })]
    })

    await applyRemoteImages(graph, async () => PNG)

    expect(fillAt(graph, 'clone')?.imageHash).toBe(computeImageHash(PNG))
  })

  test('leaves a fill that already has bytes alone', async () => {
    const graph = graphWith({
      r1: [imageFill({ imageURL: 'https://cdn.test/a.png', imageHash: 'already' })]
    })
    let reads = 0

    await applyRemoteImages(graph, async () => {
      reads += 1
      return PNG
    })

    expect(reads).toBe(0)
    expect(fillAt(graph, 'r1')?.imageHash).toBe('already')
  })

  test('ignores a reference the open answered from the document folder', async () => {
    const graph = graphWith({ r1: [imageFill({ imageURL: 'assets/hero.png' })] })
    let reads = 0

    await applyRemoteImages(graph, async () => {
      reads += 1
      return PNG
    })

    expect(reads).toBe(0)
    expect(fillAt(graph, 'r1')?.imageHash).toBeUndefined()
  })

  test('repaints once for each image that landed', async () => {
    const graph = graphWith({
      r1: [imageFill({ imageURL: 'https://cdn.test/a.png' })],
      r2: [imageFill({ imageURL: 'https://cdn.test/b.png' })]
    })
    const repainted: string[] = []

    await applyRemoteImages(
      graph,
      async () => PNG,
      (url) => repainted.push(url)
    )

    expect(repainted.toSorted()).toEqual(['https://cdn.test/a.png', 'https://cdn.test/b.png'])
  })

  test('keeps going when one fetch fails', async () => {
    const graph = graphWith({
      r1: [imageFill({ imageURL: 'https://cdn.test/a.png' })],
      r2: [imageFill({ imageURL: 'https://cdn.test/b.png' })]
    })
    const attempted: string[] = []

    await applyRemoteImages(graph, async (url) => {
      attempted.push(url)
      if (url === 'https://cdn.test/b.png') throw new Error('offline')
      return OTHER_PNG
    })

    expect(attempted).toHaveLength(2)
    expect(graph.images.size).toBe(1)
    expect(fillAt(graph, 'r1')?.imageHash).toBe(computeImageHash(OTHER_PNG))
    expect(fillAt(graph, 'r2')?.imageHash).toBeUndefined()
  })
})
