import { describe, expect, test } from 'bun:test'

import { parsePenDocument, type PenNode } from '@open-pencil/pen'
import { colorToHex8 } from '@open-pencil/scene-graph/color'
import {
  DEFAULT_GRADIENT_TRANSFORM,
  IDENTITY_GRADIENT_TRANSFORM
} from '@open-pencil/scene-graph/gradient'

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

const FRAME: PenNode = { type: 'frame', id: 'f1', name: 'Fade', width: 100, height: 100 }

/** The gradient shape two of the triaged document's fills declare. */
const LINEAR_DOWN = {
  type: 'gradient',
  gradientType: 'linear',
  enabled: true,
  rotation: 180,
  size: { height: 1 },
  colors: [
    { color: '#123D2D66', position: 0 },
    { color: '#123D2DF2', position: 1 }
  ]
}

function stopsOf(json: string) {
  return read(json, 'Fade').fills[0]?.gradientStops?.map((stop) => ({
    hex: colorToHex8(stop.color),
    position: stop.position
  }))
}

describe('a linear gradient', () => {
  test('becomes a linear gradient fill that keeps its stops in order', () => {
    const json = pen({ ...FRAME, fill: LINEAR_DOWN })

    expect(read(json, 'Fade').fills[0]?.type).toBe('GRADIENT_LINEAR')
    expect(stopsOf(json)).toEqual([
      { hex: '#123D2D66', position: 0 },
      { hex: '#123D2DF2', position: 1 }
    ])
  })

  test('points down when its angle says so, the way the engine already names that transform', () => {
    const json = pen({ ...FRAME, fill: LINEAR_DOWN })

    expect(read(json, 'Fade').fills[0]?.gradientTransform).toEqual(DEFAULT_GRADIENT_TRANSFORM)
  })

  test('points right when its angle is 90, matching the identity transform', () => {
    const json = pen({ ...FRAME, fill: { ...LINEAR_DOWN, rotation: 90 } })

    expect(read(json, 'Fade').fills[0]?.gradientTransform).toEqual(IDENTITY_GRADIENT_TRANSFORM)
  })

  test('is not reported as a fill with no equivalent any more', () => {
    expect(parsePenDocument(pen({ ...FRAME, fill: LINEAR_DOWN })).diagnostics).toEqual([])
  })

  test('resolves a stop colour that references a declared variable', () => {
    const json = JSON.stringify({
      version: '2.8',
      variables: { '--fade': { type: 'color', value: '#abcdef' } },
      children: [
        {
          ...FRAME,
          fill: {
            ...LINEAR_DOWN,
            colors: [
              { color: '$--fade', position: 0 },
              { color: '#000000', position: 1 }
            ]
          }
        }
      ]
    })

    expect(at(stopsOf(json)[0]).hex).toBe('#ABCDEF')
  })
})

describe('a gradient kind whose geometry is not read', () => {
  test('is drawn centred and reported, rather than passed off as exact', () => {
    const json = pen({ ...FRAME, fill: { ...LINEAR_DOWN, gradientType: 'radial' } })
    const result = parsePenDocument(json)
    const fill = read(json, 'Fade').fills[0]

    expect(fill?.type).toBe('GRADIENT_RADIAL')
    expect(fill?.gradientTransform).toEqual(DEFAULT_GRADIENT_TRANSFORM)
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unsupported-fill'])
  })
})

describe('a gradient kind with no equivalent', () => {
  test('falls back to a solid fill and is still reported', () => {
    const json = pen({ ...FRAME, fill: { ...LINEAR_DOWN, gradientType: 'conic' } })
    const result = parsePenDocument(json)

    expect(read(json, 'Fade').fills[0]?.type).toBe('SOLID')
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unsupported-fill'])
  })
})
