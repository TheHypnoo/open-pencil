import { describe, expect, test } from 'bun:test'

import { collectPenAssetUrls, parsePenDocument, type PenNode } from '@open-pencil/pen'
import { computeImageHash } from '@open-pencil/scene-graph'

function at<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value')
  return value
}

/** A tiny but real PNG signature, so the importer has bytes to name. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function pen(children: PenNode[]): string {
  return JSON.stringify({ version: '2.8', children })
}

const HERO: PenNode = {
  type: 'frame',
  id: 'f1',
  name: 'Hero',
  width: 100,
  height: 100,
  fill: { type: 'image', enabled: true, url: 'assets/hero.png', mode: 'fit' }
}

function hero(json: string) {
  const { graph } = parsePenDocument(json)
  // A page takes the name of the document's first child, so it can shadow the node under test.
  const nodes = [...graph.getAllNodes()].filter((node) => node.type !== 'CANVAS')
  return at(nodes.find((node) => node.name === 'Hero'))
}

describe('an image fill', () => {
  test('becomes an IMAGE fill that keeps the scale mode the document declared', () => {
    const [fill] = hero(pen([HERO])).fills

    expect(at(fill).type).toBe('IMAGE')
    expect(at(fill).imageScaleMode).toBe('FIT')
  })

  test('stops being reported as a fill with no equivalent', () => {
    expect(parsePenDocument(pen([HERO])).diagnostics).toEqual([])
  })

  test('is not painted as a solid colour, which is what made it look black', () => {
    const [fill] = hero(pen([HERO])).fills

    expect(at(fill).type).not.toBe('SOLID')
  })
})

describe('an image fill whose bytes the caller can read', () => {
  const options = { resolveAsset: () => PNG }

  test('keeps the bytes in the graph under their content hash', () => {
    const { graph } = parsePenDocument(pen([HERO]), options)
    const hash = computeImageHash(PNG)

    expect(computeImageHash(at(graph.images.get(hash)))).toBe(hash)
  })

  test('names the fill with that hash, so a renderer finds the bytes', () => {
    const { graph } = parsePenDocument(pen([HERO]), options)
    const nodes = [...graph.getAllNodes()].filter((node) => node.type !== 'CANVAS')
    const [fill] = at(nodes.find((node) => node.name === 'Hero')).fills

    expect(at(fill).imageHash).toBe(computeImageHash(PNG))
    expect(graph.images.has(at(fill).imageHash ?? '')).toBe(true)
  })

  test('reads each asset once, however many nodes share it', () => {
    const reads: string[] = []
    const two = pen([HERO, { ...HERO, id: 'f2', name: 'Hero copy' }])

    parsePenDocument(two, {
      resolveAsset: (url) => {
        reads.push(url)
        return PNG
      }
    })

    expect(reads).toEqual(['assets/hero.png'])
  })
})

describe('an image fill whose bytes the caller cannot read', () => {
  test('keeps the fill and its scale mode, without pixels', () => {
    const [fill] = hero(pen([HERO])).fills

    expect(at(fill).type).toBe('IMAGE')
    expect(at(fill).imageScaleMode).toBe('FIT')
    expect(at(fill).imageHash).toBeUndefined()
  })

  test('leaves the graph with no image bytes', () => {
    expect(parsePenDocument(pen([HERO])).graph.images.size).toBe(0)
  })
})

describe('a fill type with no equivalent', () => {
  test('is still reported', () => {
    const json = pen([
      { type: 'frame', id: 'g1', name: 'Gradient', width: 10, height: 10, fill: { type: 'video' } }
    ])

    expect(parsePenDocument(json).diagnostics.map((d) => d.code)).toEqual(['unsupported-fill'])
  })
})

describe('collecting the asset urls a document references', () => {
  test('lists each referenced asset once, in document order', () => {
    const json = pen([
      HERO,
      {
        type: 'frame',
        id: 'f2',
        name: 'Second',
        width: 10,
        height: 10,
        fill: { type: 'image', url: 'assets/second.png', mode: 'fill' }
      },
      { ...HERO, id: 'f3', name: 'Hero again' }
    ])

    expect(collectPenAssetUrls(json)).toEqual(['assets/hero.png', 'assets/second.png'])
  })

  test('ignores fills that reference no asset', () => {
    const json = pen([
      { type: 'frame', id: 's1', name: 'Plain', width: 10, height: 10, fill: '#ff0000' }
    ])

    expect(collectPenAssetUrls(json)).toEqual([])
  })
})

describe('the url an image fill came from', () => {
  test('is kept on the fill, so a caller can resolve it after the import', () => {
    const [fill] = hero(pen([HERO])).fills

    expect(at(fill).imageURL).toBe('assets/hero.png')
  })

  test('is kept even when the bytes were read, so a later resolve can still find them', () => {
    const { graph } = parsePenDocument(pen([HERO]), { resolveAsset: () => PNG })
    const nodes = [...graph.getAllNodes()].filter((node) => node.type !== 'CANVAS')
    const [fill] = at(nodes.find((node) => node.name === 'Hero')).fills

    expect(at(fill).imageURL).toBe('assets/hero.png')
    expect(at(fill).imageHash).toBe(computeImageHash(PNG))
  })

  test('keeps a remote url, the case a folder on disk cannot answer', () => {
    const remote: PenNode = {
      ...HERO,
      fill: { type: 'image', url: 'https://cdn.example.com/hero.png', mode: 'fit' }
    }
    const [fill] = hero(pen([remote])).fills

    expect(at(fill).imageURL).toBe('https://cdn.example.com/hero.png')
  })

  test('is absent for a fill that declares no url', () => {
    const [fill] = hero(pen([{ ...HERO, fill: { type: 'image', mode: 'fit' } }])).fills

    expect(at(fill).imageURL).toBeUndefined()
  })
})
