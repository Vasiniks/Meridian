/**
 * Resolve a file in /public against Vite's base. The site deploys to a
 * GitHub Pages project path (/Meridian/), so root-absolute URLs like
 * "/models/x.glb" would 404 there. Always build public URLs with this.
 */
export const asset = (path: string): string =>
  import.meta.env.BASE_URL + path.replace(/^\/+/, '')
