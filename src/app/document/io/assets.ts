import type { IORegistry } from '@open-pencil/core/io'
import { collectPenAssetUrls } from '@open-pencil/pen'

import { isTauri } from '@/app/tauri/env'

/** Answers a `.pen` document's image lookups from bytes already read off the disk. */
export type PenAssetResolver = (url: string) => Uint8Array | undefined

/** A reference the document's own folder cannot answer, such as a remote image. */
function isRemoteAsset(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url)
}

/**
 * Reads the image assets a `.pen` document references next to itself.
 *
 * The importer answers asset lookups synchronously, so every local reference is read first and the
 * returned resolver only looks the bytes up. A reference that cannot be read leaves its fill
 * without pixels: the document still opens, and nothing else in it is affected. A remote
 * reference is skipped here, because opening a file must not wait on the network.
 */
export async function readPenAssetResolver(
  filePath: string,
  text: string
): Promise<PenAssetResolver | undefined> {
  if (!isTauri()) return undefined
  const urls = collectPenAssetUrls(text).filter((url) => !isRemoteAsset(url))
  if (urls.length === 0) return undefined

  const [{ dirname, join }, { readFile }] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs')
  ])
  const folder = await dirname(filePath)
  const assets = new Map<string, Uint8Array>()
  await Promise.all(
    urls.map(async (url) => {
      try {
        assets.set(url, await readFile(await join(folder, url)))
      } catch (error) {
        console.warn(`[pen] Could not read the image asset "${url}" next to ${filePath}`, error)
      }
    })
  )
  return (url) => assets.get(url)
}

/** Resolves the assets this file needs before it is read, or nothing when it needs none. */
async function penAssetResolverFor(
  fileName: string,
  filePath: string | undefined,
  data: Uint8Array
): Promise<PenAssetResolver | undefined> {
  if (!filePath || !(fileName || filePath).toLowerCase().endsWith('.pen')) return undefined
  return readPenAssetResolver(filePath, new TextDecoder().decode(data))
}

/**
 * Reads a document through the IO registry, giving a `.pen` the image assets it references next
 * to itself. The importer asks for assets synchronously, so they are read before it runs.
 */
export async function readDocumentWithAssets(io: IORegistry, file: File, filePath?: string) {
  const data = new Uint8Array(await file.arrayBuffer())
  const resolveAsset = await penAssetResolverFor(file.name, filePath, data)
  return io.readDocument(
    { name: file.name, mimeType: file.type || undefined, data },
    { resolveAsset }
  )
}
