/// <reference types="vite/client" />
import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm'

import { IS_BROWSER } from './constants'

let instance: CanvasKit | null = null

export interface CanvasKitOptions {
  locateFile?: (file: string) => string
}

/**
 * Where the browser build serves CanvasKit's files. Unlike {@link getCanvasKit}'s default, this
 * never consults the environment, so a worker — where `window` does not exist — can use it too.
 */
export function browserCanvasKitLocate(file: string): string {
  const base = 'env' in import.meta ? import.meta.env.BASE_URL : '/'
  const prefix = base === '/' ? '' : base.replace(/\/$/, '')
  return `${prefix}/${file}`
}

export async function getCanvasKit(options?: CanvasKitOptions): Promise<CanvasKit> {
  if (instance) return instance

  const defaultLocate = (file: string) => {
    if (!IS_BROWSER) {
      const ckPath = import.meta.resolve('canvaskit-wasm')
      return decodeURIComponent(new URL(file, ckPath).pathname)
    }
    return browserCanvasKitLocate(file)
  }

  instance = await CanvasKitInit({
    locateFile: options?.locateFile ?? defaultLocate
  })

  return instance
}
