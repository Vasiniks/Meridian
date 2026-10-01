/**
 * Film grain + warm vignette — CSS layers over the whole page so DOM type
 * and the transparent WebGL canvas read as one printed surface.
 *
 * Perf: no mix-blend-mode. The tile is premultiplied black-alpha noise
 * (visually the same as multiplying near-white noise on paper) so the
 * compositor does plain alpha blending; the layer is only one tile larger
 * than the viewport and steps through tile offsets at ~8 fps (pure CSS,
 * paused when motion is off, still on touch devices).
 */
const TILE = 160

function noiseTile(size = TILE): Promise<string> {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    // skewed toward clear, a few darker specks (warm black)
    const a = Math.pow(Math.random(), 2.2)
    d[i] = 38
    d[i + 1] = 32
    d[i + 2] = 24
    d[i + 3] = Math.round(a * 255)
  }
  g.putImageData(img, 0, 0)
  return new Promise((resolve) => {
    if (c.toBlob) c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : c.toDataURL()), 'image/png')
    else resolve(c.toDataURL())
  })
}

export function startGrain(): () => void {
  // layers are rendered by Chrome.tsx; create them if absent (e.g. tests)
  const ensure = (id: string): HTMLElement => {
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement('div')
      el.id = id
      el.setAttribute('aria-hidden', 'true')
      document.body.append(el)
    }
    return el
  }
  ensure('vignette')
  const grain = ensure('grain')
  let url = ''
  void noiseTile().then((u) => {
    url = u
    grain.style.backgroundImage = `url("${u}")`
    grain.classList.add('is-ready')
  })
  return () => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
}
