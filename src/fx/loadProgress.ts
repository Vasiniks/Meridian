import * as THREE from 'three'
import { bus } from './bus'

/**
 * Real byte-level load progress for the preloader.
 *
 * Every three.js file loader (GLTFLoader, HDRLoader, ...) streams through
 * `THREE.FileLoader`, which reports per-chunk ProgressEvents to the caller's
 * onProgress. While tracking is on we wrap FileLoader.load to sum those
 * per-file fractions and emit `bus 'load:progress'` {p: 0..1}. No asset
 * URLs are hard-coded, so other agents can change models/HDRIs freely.
 *
 * Call `beginLoadTracking()` at the start of experience.init and the
 * returned `end()` once the assets are in (it emits p = 1).
 */
interface FileStat {
  loaded: number
  total: number
}

let active = 0
let original: THREE.FileLoader['load'] | null = null
const files = new Map<string, FileStat>()

/** experience.init loads the HDRI, then the GLB — expect at least two files. */
const EXPECTED_FILES = 2

function report(): void {
  let sum = 0
  files.forEach((f) => {
    sum += f.total > 0 ? Math.min(1, f.loaded / f.total) : f.loaded > 0 ? 0.3 : 0
  })
  const p = sum / Math.max(files.size, EXPECTED_FILES)
  bus.emit('load:progress', { p: Math.min(0.99, p) })
}

export function beginLoadTracking(): () => void {
  if (active++ === 0) {
    const proto = THREE.FileLoader.prototype
    original = proto.load
    const orig = original
    proto.load = function patchedLoad(
      this: THREE.FileLoader,
      url: string,
      onLoad?: (data: string | ArrayBuffer) => void,
      onProgress?: (e: ProgressEvent) => void,
      onError?: (err: unknown) => void,
    ) {
      const key = this.path ? this.path + url : url
      if (!files.has(key)) files.set(key, { loaded: 0, total: 0 })
      const stat = files.get(key)!
      return orig.call(
        this,
        url,
        (data) => {
          stat.total = Math.max(1, stat.total)
          stat.loaded = stat.total
          report()
          onLoad?.(data)
        },
        (e) => {
          stat.loaded = e.loaded
          if (e.lengthComputable) stat.total = e.total
          report()
          onProgress?.(e)
        },
        onError,
      )
    } as THREE.FileLoader['load']
    bus.emit('load:progress', { p: 0 })
  }
  let ended = false
  return () => {
    if (ended) return
    ended = true
    if (--active === 0 && original) {
      THREE.FileLoader.prototype.load = original
      original = null
      files.clear()
      bus.emit('load:progress', { p: 1 })
    }
  }
}
