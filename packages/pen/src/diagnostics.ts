/**
 * Import diagnostics for Pencil `.pen` documents.
 *
 * A `.pen` file can declare nodes and properties OpenPencil has no equivalent for. The importer
 * keeps going and records every loss here, so a caller can tell the user exactly what an import
 * changed instead of leaving it to guesswork. Nothing in this module influences the produced
 * graph: a diagnostic describes an import, it never performs one.
 */

import { compact } from 'es-toolkit/array'

/** Which kind of fidelity was lost. */
export type PenDiagnosticCode =
  | 'unsupported-node-type'
  | 'dropped-node'
  | 'unsupported-fill'
  | 'dropped-stroke'
  | 'unsupported-effect'
  | 'unresolved-variable'
  | 'unresolved-component'
  | 'dropped-override'

/** `degraded` kept the declaration with a changed appearance; `dropped` left it out entirely. */
export type PenDiagnosticSeverity = 'degraded' | 'dropped'

export interface PenDiagnostic {
  code: PenDiagnosticCode
  severity: PenDiagnosticSeverity
  /** Position of the offending declaration, such as `children[2].children[0]`; empty at the document root. */
  path: string
  /** `.pen` id of the node the declaration belongs to. */
  nodeId?: string
  nodeName?: string
  /** `.pen` node type as declared, not as mapped. */
  nodeType?: string
  /** `.pen` property that could not be represented. */
  property?: string
  /** Declared value, rendered for a report. */
  value?: string
  /** What the importer did instead. */
  detail: string
}

/** Receives fidelity losses, and answers the asset lookups conversion needs. */
export interface PenDiagnosticsSink {
  report(diagnostic: PenDiagnostic): void
  /** The name an image asset's bytes are stored under, or undefined when it cannot be read. */
  resolveImage?: (url: string) => string | undefined
}

export interface PenDiagnosticsCollector extends PenDiagnosticsSink {
  readonly entries: readonly PenDiagnostic[]
  /** Runs `body` with `segment` appended to the path every report inside it carries. */
  within<T>(segment: string, body: () => T): T
}

export function createPenDiagnosticsCollector(
  resolveImage?: (url: string) => string | undefined
): PenDiagnosticsCollector {
  const entries: PenDiagnostic[] = []
  const segments: string[] = []

  return {
    entries,
    resolveImage,
    report(diagnostic) {
      entries.push({
        ...diagnostic,
        path: compact([...segments, diagnostic.path]).join('.')
      })
    },
    within(segment, body) {
      segments.push(segment)
      try {
        return body()
      } finally {
        segments.pop()
      }
    }
  }
}

/** One diagnostic as a single line, for console output and text reports. */
export function formatPenDiagnostic(diagnostic: PenDiagnostic): string {
  const where = diagnostic.path === '' ? 'document' : diagnostic.path
  const node = diagnostic.nodeName === undefined ? '' : ` "${diagnostic.nodeName}"`
  const property = diagnostic.property === undefined ? '' : ` (${diagnostic.property})`
  const value = diagnostic.value === undefined ? '' : ` = ${diagnostic.value}`
  return `${diagnostic.severity}: ${diagnostic.code} at ${where}${node}${property}${value} — ${diagnostic.detail}`
}
