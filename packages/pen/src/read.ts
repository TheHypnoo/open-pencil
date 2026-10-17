import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { copyEffects, copyFills, copyStrokes } from '@open-pencil/scene-graph/copy'
import { populateInstanceChildren } from '@open-pencil/scene-graph/instances'

import {
  applyCornerRadius,
  convertEffects,
  convertFill,
  convertStroke,
  parseSize,
  type PenDocument,
  type PenNode
} from './convert'
import {
  createPenDiagnosticsCollector,
  type PenDiagnostic,
  type PenDiagnosticsCollector
} from './diagnostics'
import { createSceneNode } from './nodes'
import { applyTheme, buildVarContext, type VarContext } from './variables'

function inheritLayoutFromComp(node: SceneNode, pen: PenNode, comp: SceneNode): void {
  const wasRow = node.layoutMode === 'HORIZONTAL'
  node.layoutMode = comp.layoutMode
  node.primaryAxisAlign = comp.primaryAxisAlign
  node.counterAxisAlign = comp.counterAxisAlign
  const isRow = node.layoutMode === 'HORIZONTAL'
  if (wasRow !== isRow) {
    const oldP = node.primaryAxisSizing
    node.primaryAxisSizing = node.counterAxisSizing
    node.counterAxisSizing = oldP
  }
  const widthAxis = isRow ? 'primaryAxisSizing' : 'counterAxisSizing'
  const heightAxis = isRow ? 'counterAxisSizing' : 'primaryAxisSizing'
  if (pen.width === undefined) node[widthAxis] = comp[widthAxis]
  if (pen.height === undefined) node[heightAxis] = comp[heightAxis]
  if (pen.gap === undefined) node.itemSpacing = comp.itemSpacing
  if (pen.padding === undefined) {
    node.paddingTop = comp.paddingTop
    node.paddingRight = comp.paddingRight
    node.paddingBottom = comp.paddingBottom
    node.paddingLeft = comp.paddingLeft
  }
  if (pen.clip === undefined) node.clipsContent = comp.clipsContent
}

function applyRefVisuals(
  node: SceneNode,
  pen: PenNode,
  compPen: PenNode | undefined,
  ctx: VarContext,
  sink: PenDiagnosticsCollector
): void {
  if (!compPen) return
  if (pen.fill === undefined && compPen.fill !== undefined)
    node.fills = convertFill(compPen.fill, ctx, node, sink)
  if (pen.stroke === undefined && compPen.stroke)
    node.strokes = convertStroke(compPen.stroke, ctx, node, sink)
  if (pen.effect === undefined && compPen.effect)
    node.effects = convertEffects(compPen.effect, sink)
  if (pen.cornerRadius === undefined) applyCornerRadius(node, compPen.cornerRadius, ctx)
}

function applyRefProps(
  node: SceneNode,
  pen: PenNode,
  graph: SceneGraph,
  componentIds: Map<string, string>,
  penSources: Map<string, PenNode>,
  ctx: VarContext,
  sink: PenDiagnosticsCollector
): void {
  if (!pen.ref) return
  const componentId = componentIds.get(pen.ref) ?? pen.ref
  node.componentId = componentId
  const comp = graph.getNode(componentId)
  if (!comp) {
    sink.report({
      code: 'unresolved-component',
      severity: 'degraded',
      path: '',
      nodeId: pen.id,
      nodeName: pen.name,
      nodeType: pen.type,
      property: 'ref',
      value: pen.ref,
      detail: `Component "${pen.ref}" is not declared in this document, so this instance stays empty.`
    })
    return
  }
  if (pen.width === undefined) node.width = comp.width
  if (pen.height === undefined) node.height = comp.height
  if (pen.layout === undefined) inheritLayoutFromComp(node, pen, comp)
  applyRefVisuals(node, pen, penSources.get(pen.ref), ctx, sink)
}

function applyAllRefProps(
  pen: PenNode,
  path: string,
  graph: SceneGraph,
  componentIds: Map<string, string>,
  penSources: Map<string, PenNode>,
  ctx: VarContext,
  sink: PenDiagnosticsCollector
): void {
  sink.within(path, () => {
    if (pen.type === 'ref') {
      const node = graph.getNode(pen.id)
      if (node) applyRefProps(node, pen, graph, componentIds, penSources, ctx, sink)
    }
    pen.children?.forEach((child, index) => {
      applyAllRefProps(child, `children[${index}]`, graph, componentIds, penSources, ctx, sink)
    })
  })
}

function collectByNameType(
  graph: SceneGraph,
  parentId: string,
  name: string,
  type: string,
  out: SceneNode[],
  depth: number
): void {
  if (depth > 2) return
  const parent = graph.getNode(parentId)
  if (!parent) return
  for (const childId of parent.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.name === name && child.type === type) out.push(child)
    collectByNameType(graph, childId, name, type, out, depth + 1)
  }
}

function findCloneByComponentId(
  graph: SceneGraph,
  parentId: string,
  origId: string
): SceneNode | undefined {
  const parent = graph.getNode(parentId)
  if (!parent) return undefined
  for (const childId of parent.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.componentId === origId) return child
    const deep = findCloneByComponentId(graph, childId, origId)
    if (deep) return deep
  }
  return undefined
}

function findCloneByNameFallback(
  graph: SceneGraph,
  parentId: string,
  origId: string
): SceneNode | undefined {
  const orig = graph.getNode(origId)
  if (!orig) return undefined
  const matches: SceneNode[] = []
  collectByNameType(graph, parentId, orig.name, orig.type, matches, 0)
  return matches.length === 1 ? matches[0] : undefined
}

function applyOverrideProps(
  target: SceneNode,
  overrideData: Partial<PenNode>,
  ctx: VarContext
): void {
  if (overrideData.fill !== undefined) target.fills = convertFill(overrideData.fill, ctx, target)
  if (overrideData.content !== undefined) target.text = overrideData.content
  if (overrideData.x !== undefined) target.x = overrideData.x
  if (overrideData.y !== undefined) target.y = overrideData.y
  if (overrideData.enabled !== undefined) target.visible = overrideData.enabled
  if (overrideData.width !== undefined)
    target.width = parseSize(overrideData.width, target.width, ctx).value
  if (overrideData.height !== undefined)
    target.height = parseSize(overrideData.height, target.height, ctx).value
  if (overrideData.rotation !== undefined) target.rotation = overrideData.rotation
  if (overrideData.name !== undefined) target.name = overrideData.name
}

function populateInstances(graph: SceneGraph): void {
  for (const node of graph.getAllNodes()) {
    if (node.type === 'INSTANCE' && node.componentId && node.childIds.length === 0) {
      const component = graph.getNode(node.componentId)
      if (component) populateInstanceChildren(graph, node.id, node.componentId)
    }
  }
}

function applyDescendantOverrides(
  graph: SceneGraph,
  pen: PenNode,
  ctx: VarContext,
  componentIds: Map<string, string>,
  penSources: Map<string, PenNode>,
  sink: PenDiagnosticsCollector
): void {
  if (pen.type !== 'ref' || !pen.descendants) return
  const instanceNode = graph.getNode(pen.id)
  if (!instanceNode) return

  for (const [origId, overrideData] of Object.entries(pen.descendants)) {
    sink.within(`descendants[${origId}]`, () => {
      const clone =
        findCloneByComponentId(graph, instanceNode.id, origId) ??
        findCloneByNameFallback(graph, instanceNode.id, origId)

      if (clone) {
        if (overrideData.children) {
          const toDelete = clone.childIds.slice()
          for (const childId of toDelete) graph.deleteNode(childId)
          overrideData.children.forEach((child, index) => {
            createSceneNode(
              child,
              clone.id,
              graph,
              ctx,
              componentIds,
              penSources,
              sink,
              `children[${index}]`
            )
          })
        }
        applyOverrideProps(clone, overrideData, ctx)
        return
      }

      if (overrideData.type && overrideData.id) {
        createSceneNode(
          overrideData as PenNode,
          instanceNode.id,
          graph,
          ctx,
          componentIds,
          penSources,
          sink,
          ''
        )
        return
      }

      sink.report({
        code: 'dropped-override',
        severity: 'dropped',
        path: '',
        nodeId: pen.id,
        nodeName: pen.name,
        nodeType: pen.type,
        property: 'descendants',
        value: origId,
        detail: `Override "${origId}" matches no descendant of this instance and declares no node of its own, so it was dropped.`
      })
    })
  }
}

function walkAndApplyOverrides(
  pen: PenNode,
  path: string,
  graph: SceneGraph,
  ctx: VarContext,
  componentIds: Map<string, string>,
  penSources: Map<string, PenNode>,
  sink: PenDiagnosticsCollector
): void {
  sink.within(path, () => {
    applyDescendantOverrides(graph, pen, ctx, componentIds, penSources, sink)
    pen.children?.forEach((child, index) => {
      walkAndApplyOverrides(child, `children[${index}]`, graph, ctx, componentIds, penSources, sink)
    })
  })
}

function collectComponentIds(nodes: PenNode[], map: Map<string, string>): void {
  for (const node of nodes) {
    if (node.reusable) map.set(node.id, node.id)
    if (node.children) collectComponentIds(node.children, map)
  }
}

function resolveNodeVars(node: SceneNode, graph: SceneGraph, ctx: VarContext): void {
  for (const [key, varId] of Object.entries(node.boundVariables)) {
    const variable = graph.variables.get(varId)
    if (!variable) continue
    const modeVal =
      variable.valuesByMode[ctx.activeModeId] ?? Object.values(variable.valuesByMode)[0]
    if (key.startsWith('fills[') && typeof modeVal === 'object' && 'r' in modeVal) {
      const idx = Number.parseInt(key.match(/\d+/)?.[0] ?? '0', 10)
      if (node.fills[idx]) node.fills[idx].color = modeVal
    } else if (key.startsWith('strokes[') && typeof modeVal === 'object' && 'r' in modeVal) {
      const idx = Number.parseInt(key.match(/\d+/)?.[0] ?? '0', 10)
      if (node.strokes[idx]) node.strokes[idx].color = modeVal
    }
  }
  for (const childId of node.childIds) {
    const child = graph.getNode(childId)
    if (child) resolveNodeVars(child, graph, ctx)
  }
}

function resolveThemeVariables(
  pen: PenNode,
  path: string,
  graph: SceneGraph,
  ctx: VarContext,
  sink: PenDiagnosticsCollector
): void {
  sink.within(path, () => {
    if (pen.theme) applyTheme(pen.theme, ctx)
    const node = graph.getNode(pen.id)
    if (node) resolveNodeVars(node, graph, ctx)
    pen.children?.forEach((child, index) => {
      resolveThemeVariables(child, `children[${index}]`, graph, ctx, sink)
    })
  })
}

function fixInstanceWidths(graph: SceneGraph): void {
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'INSTANCE' || !node.componentId) continue
    const comp = graph.getNode(node.componentId)
    if (!comp) continue
    if (node.width <= 100 && comp.width > 100) node.width = comp.width
    if (node.height <= 100 && comp.height > 100) node.height = comp.height
    if (comp.layoutGrow > 0) node.layoutGrow = comp.layoutGrow
    if (comp.layoutAlignSelf !== 'AUTO') node.layoutAlignSelf = comp.layoutAlignSelf
    node.fills = copyFills(node.fills)
    node.strokes = copyStrokes(node.strokes)
    node.effects = copyEffects(node.effects)
  }
}

export interface PenImportResult {
  graph: SceneGraph
  /** Every declaration the importer could not represent faithfully, in document order. */
  diagnostics: PenDiagnostic[]
}

/**
 * Parses a `.pen` document and reports what the import could not represent faithfully.
 * Prefer this over {@link parsePenFile} when the caller can show the losses to a user.
 */
export function parsePenDocument(json: string): PenImportResult {
  const doc: PenDocument = JSON.parse(json)
  const graph = new SceneGraph()

  for (const page of graph.getPages(true)) {
    graph.deleteNode(page.id)
  }

  const sink = createPenDiagnosticsCollector()
  const ctx = buildVarContext(graph, doc.variables ?? {}, doc.themes ?? {}, sink)
  const componentIds = new Map<string, string>()
  const penSources = new Map<string, PenNode>()

  collectComponentIds(doc.children, componentIds)

  const page = graph.addPage(doc.children[0]?.name ?? 'Page 1')
  doc.children.forEach((child, index) => {
    createSceneNode(
      child,
      page.id,
      graph,
      ctx,
      componentIds,
      penSources,
      sink,
      `children[${index}]`
    )
  })

  doc.children.forEach((child, index) => {
    applyAllRefProps(child, `children[${index}]`, graph, componentIds, penSources, ctx, sink)
  })
  populateInstances(graph)
  doc.children.forEach((child, index) => {
    walkAndApplyOverrides(child, `children[${index}]`, graph, ctx, componentIds, penSources, sink)
  })
  populateInstances(graph)
  doc.children.forEach((child, index) => {
    resolveThemeVariables(child, `children[${index}]`, graph, ctx, sink)
  })
  fixInstanceWidths(graph)

  if (graph.getPages(true).length === 0) {
    graph.addPage('Page 1')
  }

  return { graph, diagnostics: [...sink.entries] }
}

/** Parses a `.pen` document into a graph, discarding the import diagnostics. */
export function parsePenFile(json: string): SceneGraph {
  return parsePenDocument(json).graph
}

export async function readPenFile(file: File): Promise<SceneGraph> {
  return parsePenFile(await file.text())
}
