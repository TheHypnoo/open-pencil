import type { SceneNode } from '@open-pencil/scene-graph'

import { fontManager, weightToStyle } from '#core/text/fonts'
import { measureTextWithOpenType } from '#core/text/opentype'

export type TextMeasurer = (
  node: SceneNode,
  maxWidth?: number
) => { width: number; height: number } | null

let globalTextMeasurer: TextMeasurer | null = null

const GLYPH_WIDTH_FACTOR = 0.6

/**
 * Measurements repeat heavily: instance clones reuse the same text, style and constraint, so a
 * document measured eighty thousand times may hold only a couple of thousand distinct shapes.
 * Caching them by what they depend on is what keeps a large layout from blocking the window.
 */
const MEASUREMENT_CACHE_LIMIT = 20_000

interface MeasurementCache {
  entries: Map<string, { width: number; height: number }>
  generation: number
}

function createMeasurementCache(): MeasurementCache {
  return { entries: new Map(), generation: -1 }
}

/** Drops every cached measurement. A font change makes all of them stale. */
export function clearTextMeasurements(): void {
  for (const cache of [estimateCache, installedCache]) {
    cache.entries.clear()
    cache.generation = -1
  }
}

/**
 * Measures through `cache`, computing only what has not been measured since the fonts last
 * changed. A cached measurement is only ever compared with one from the same measurer, because
 * an estimate and a shaped one describe the same text differently.
 */
function cachedMeasurement(
  cache: MeasurementCache,
  measurer: TextMeasurer,
  node: SceneNode,
  maxWidth?: number
): { width: number; height: number } | null {
  const generation = fontManager.generation()
  if (generation !== cache.generation) {
    cache.entries.clear()
    cache.generation = generation
  }
  const key = measurementKey(node, maxWidth)
  const hit = cache.entries.get(key)
  if (hit) return hit

  const size = measurer(node, maxWidth)
  if (!size) return null
  if (cache.entries.size >= MEASUREMENT_CACHE_LIMIT) cache.entries.clear()
  cache.entries.set(key, size)
  return size
}

/**
 * What a measurement depends on, as one cache key. `join` turns an absent value into an empty
 * field, so nothing here needs to guard for one.
 */
function measurementKey(node: SceneNode, maxWidth?: number): string {
  return [
    node.text,
    node.fontFamily,
    node.fontWeight,
    node.italic,
    node.fontSize,
    node.lineHeight,
    node.letterSpacing,
    node.textAlignHorizontal,
    node.textCase,
    node.textDecoration,
    node.maxLines,
    // The width a paragraph is laid out at comes from the node as well as the constraint.
    node.textAutoResize,
    node.width,
    maxWidth
  ].join('\u0000')
}

const estimateCache = createMeasurementCache()
const installedCache = createMeasurementCache()

export function estimateTextSize(
  node: SceneNode,
  maxWidth?: number
): { width: number; height: number } {
  const cached = cachedMeasurement(estimateCache, computeEstimateTextSize, node, maxWidth)
  return cached ?? computeEstimateTextSize(node, maxWidth)
}

function computeEstimateTextSize(
  node: SceneNode,
  maxWidth?: number
): { width: number; height: number } {
  const fontSize = node.fontSize || 14
  const family = node.fontFamily || 'Inter'
  const style = weightToStyle(node.fontWeight || 400, node.italic)
  const text = node.text || ''

  const explicitLineH = (node.lineHeight ?? 0) > 0 ? (node.lineHeight as number) : undefined
  const measured = measureTextWithOpenType(text, fontSize, family, style, maxWidth, explicitLineH)
  if (measured) return measured

  const charWidth = fontSize * GLYPH_WIDTH_FACTOR
  const singleLineWidth = Math.ceil(text.length * charWidth)
  const lineH = (node.lineHeight ?? 0) > 0 ? (node.lineHeight as number) : Math.ceil(fontSize * 1.4)

  if (maxWidth && maxWidth > 0 && singleLineWidth > maxWidth) {
    const lines = Math.ceil(singleLineWidth / maxWidth)
    return { width: maxWidth, height: Math.ceil(lines * lineH) }
  }
  return { width: singleLineWidth, height: lineH }
}

export function getTextMeasurer(): TextMeasurer | null {
  return globalTextMeasurer
}

export function setTextMeasurer(measurer: TextMeasurer | null): void {
  resetInstalledCache()
  globalTextMeasurer = measurer
}

const installedMeasurers: TextMeasurer[] = []

function resetInstalledCache(): void {
  installedCache.entries.clear()
  installedCache.generation = -1
}

/**
 * The size layout should use for `node`. A live measurer answers with shaped text, and its answers
 * are cached across nodes: instance clones repeat the same text, style and constraint, so a large
 * document asks for the same few shapes thousands of times. What cannot be measured is estimated.
 */
export function measureTextForLayout(
  node: SceneNode,
  maxWidth?: number
): { width: number; height: number } {
  const measurer = globalTextMeasurer
  if (!measurer) return estimateTextSize(node, maxWidth)
  return (
    cachedMeasurement(installedCache, measurer, node, maxWidth) ?? estimateTextSize(node, maxWidth)
  )
}

/**
 * Makes `measurer` the layout text measurer until the returned function uninstalls it. Then
 * the most recent measurer still installed takes over, so closing one editor neither leaves
 * layout measuring with its destroyed renderer nor keeps that editor alive.
 */
export function installTextMeasurer(measurer: TextMeasurer): () => void {
  resetInstalledCache()
  installedMeasurers.push(measurer)
  globalTextMeasurer = measurer
  return () => {
    const index = installedMeasurers.lastIndexOf(measurer)
    if (index !== -1) installedMeasurers.splice(index, 1)
    if (globalTextMeasurer === measurer) globalTextMeasurer = installedMeasurers.at(-1) ?? null
    resetInstalledCache()
  }
}

/**
 * Run `fn` with `measurer` as the layout text measurer. The measurer is shared, so `fn` must
 * be synchronous: an override held across an await would leak into other layouts.
 */
export function withTextMeasurer<T>(measurer: TextMeasurer, fn: () => T): T {
  const previous = globalTextMeasurer
  globalTextMeasurer = measurer
  try {
    return fn()
  } finally {
    globalTextMeasurer = previous
  }
}
