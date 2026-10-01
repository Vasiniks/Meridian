import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Quality } from './config'

export type MechRole =
  | 'static'
  | 'button'
  | 'stem'
  | 'actuator'
  | 'rod'
  | 'clutch'
  | 'jaw'
  | 'springMain'
  | 'springBtn'
  | 'springStab'
  | 'lead'
  | 'sleeve'

export interface PartEntry {
  node: THREE.Object3D
  name: string
  base: THREE.Vector3
  explode: number
  kind: 'shell' | 'inner'
  mech: MechRole
  jawAngle: number
}

export interface Assembly {
  group: THREE.Group
  parts: PartEntry[]
  byName: Map<string, PartEntry>
  shellMats: THREE.MeshStandardMaterial[]
  barrelMat: THREE.MeshStandardMaterial | null
  coreMat: THREE.MeshStandardMaterial | null
  springMats: THREE.MeshStandardMaterial[]
  brassMat: THREE.MeshStandardMaterial | null
  gripNode: THREE.Object3D | null
  jawNodes: THREE.Object3D[]
}

interface PartExtras {
  ex?: number
  kind?: 'shell' | 'inner'
  mech?: MechRole
  jawAngle?: number
}

const NO_SHADOW = new Set(['returnSpring', 'buttonSpring', 'stabilizerSpring', 'lead'])

/**
 * LOOKDEV runtime overrides (materials arrive as MeshStandardMaterial from
 * the Blender build, scripts/asset-processing/blender/build_pencil.py).
 *
 * The GLB carries the frosted finish as maps: one shared bead-blast
 * micro-grain normal map + packed ORM (G = roughness multiplier 0.86–1.0,
 * B = metal) on the metals, and a lathe-mark normal map on turned parts.
 * Those maps are KEPT — they are what makes the anodized read as satin /
 * frosted metal instead of chrome or matte plastic. This table only fixes
 * the factors for the site's rig (NeutralToneMapping + studio HDRI + key/
 * rim/fill), so the look stays deterministic whatever the GLB factors are.
 *
 * Roughness floor: factor × the map's 0.86 minimum stays ≥ 0.22 (no chrome).
 */
interface Look {
  metal: number
  rough: number
  env: number
  /** albedo multiplier (dark metals keep a small lift so they still reflect) */
  lift?: number
  /** normal-map strength (frost grain / lathe marks); 0 drops the map */
  normal?: number
}

const ROUGH_FLOOR = 0.22
const MAP_MIN = 0.86 // darkest roughness multiplier in the ORM map

const LOOK: Record<string, Look> = {
  // frosted (bead-blasted) anodized barrel — the variant tint target
  anodized: { metal: 1.0, rough: 0.46, env: 1.0, lift: 1.15, normal: 0.32 },
  // laser-etched lettering: ablated bright satin aluminium
  etch: { metal: 1.0, rough: 0.42, env: 1.05, normal: 0.4 },
  // DLC-coated grip / collar: deep graphite satin
  dlc: { metal: 1.0, rough: 0.46, env: 1.0, lift: 1.1, normal: 0.34 },
  steel: { metal: 1.0, rough: 0.34, env: 1.1, normal: 0.26 },
  // turned / bead-polished cone + rods: brightest, but never mirror
  polished: { metal: 1.0, rough: 0.27, env: 1.15, normal: 0.14 },
  brass: { metal: 1.0, rough: 0.36, env: 1.0, normal: 0.26 },
  spring: { metal: 1.0, rough: 0.4, env: 0.9, normal: 0.18 },
  recess: { metal: 0.6, rough: 0.62, env: 0.6 },
  polymer: { metal: 0.0, rough: 0.5, env: 0.7 },
  mechdark: { metal: 0.6, rough: 0.46, env: 0.85, normal: 0.26 },
  reservoir: { metal: 0.1, rough: 0.22, env: 0.8 },
  eraser: { metal: 0.0, rough: 0.92, env: 0.5 },
  lead: { metal: 0.25, rough: 0.55, env: 0.6 },
}

function tuneLookdev(mat: THREE.MeshStandardMaterial): void {
  if (mat.userData.lookdev) return
  mat.userData.lookdev = true
  const look = LOOK[mat.name]
  if (!look) {
    // unknown role: keep the GLB factors, just clamp away from chrome
    mat.roughness = Math.max(ROUGH_FLOOR / MAP_MIN, mat.roughness)
    mat.envMapIntensity = 1.0
    return
  }
  mat.metalness = look.metal
  mat.envMapIntensity = look.env
  if (look.lift !== undefined) mat.color.multiplyScalar(look.lift)
  const mapped = mat.roughnessMap !== null
  mat.roughness = Math.max(look.rough, mapped ? ROUGH_FLOOR / MAP_MIN : ROUGH_FLOOR)
  if (mat.normalMap) {
    const n = look.normal ?? 0
    if (n > 0) mat.normalScale.set(n, n)
    else mat.normalMap = null
  }
  mat.needsUpdate = true
}

/**
 * Loads the external GLB asset and maps named nodes into a stable,
 * name-keyed product hierarchy. No fragile array indexes.
 */
export async function loadAssembly(
  url: string,
  scene: THREE.Scene,
  quality: Quality,
): Promise<Assembly> {
  const gltf = await new GLTFLoader().loadAsync(url)
  const group = new THREE.Group()
  group.name = 'Pencil'
  const pencil = gltf.scene.getObjectByName('Pencil') ?? gltf.scene
  group.add(pencil)

  // Presentation attitude (preserved from prototype)
  group.rotation.z = -0.42
  group.rotation.x = 0.08
  group.position.y = 0.2
  group.scale.setScalar(0.6)
  scene.add(group)

  const parts: PartEntry[] = []
  const byName = new Map<string, PartEntry>()
  const shellMatSet = new Set<THREE.MeshStandardMaterial>()
  const springMatSet = new Set<THREE.MeshStandardMaterial>()
  let barrelMat: THREE.MeshStandardMaterial | null = null
  let coreMat: THREE.MeshStandardMaterial | null = null
  let brassMat: THREE.MeshStandardMaterial | null = null
  let gripNode: THREE.Object3D | null = null
  const jawNodes: THREE.Object3D[] = []

  pencil.updateMatrixWorld(true)
  // NOTE: GLTFLoader parents each glTF mesh under its named node, so the
  // registry anchors on the extras-carrying node (which owns the base
  // translation) and operates on descendant meshes for materials/shadows.
  const visited = new Set<string>()
  pencil.traverse((o) => {
    const extras = (o.userData ?? {}) as PartExtras
    if (extras.mech === undefined || visited.has(o.name)) return
    visited.add(o.name)
    const meshes: THREE.Mesh[] = []
    o.traverse((c) => {
      if (c instanceof THREE.Mesh) meshes.push(c)
    })
    if (meshes.length === 0) return
    const name = o.name
    const base = o.position.clone()
    const entry: PartEntry = {
      node: o,
      name,
      base,
      explode: extras.ex ?? 0,
      kind: extras.kind ?? 'inner',
      mech: extras.mech ?? 'static',
      jawAngle: extras.jawAngle ?? 0,
    }
    parts.push(entry)
    byName.set(name, entry)
    for (const m of meshes) {
      m.castShadow = quality === 'high' && !NO_SHADOW.has(name)
      const mat = m.material as THREE.MeshStandardMaterial
      if (entry.kind === 'shell') {
        // Clone shared shell materials so x-ray fading never leaks
        // into internal parts using the same source material.
        if (!mat.userData.shellClone) {
          const clone = mat.clone()
          clone.transparent = true
          mat.userData.shellClone = clone
          shellMatSet.add(clone)
        }
        m.material = mat.userData.shellClone as THREE.Material
      }
      const active = m.material as THREE.MeshStandardMaterial
      tuneLookdev(active)
      // barrelHex also carries the 'etch' lettering primitive: tint only
      // the anodized one
      if (name === 'barrelHex' && active.name === 'anodized') barrelMat = active
      if (name === 'reservoirHex') coreMat = active
      if (name === 'clutchHousing') brassMat = active
      if (
        name === 'returnSpring' ||
        name === 'buttonSpring' ||
        name === 'stabilizerSpring'
      ) {
        springMatSet.add(active)
      }
    }
    if (name === 'gripSleeve') gripNode = o
    if (entry.mech === 'jaw') jawNodes.push(o)
  })

  return {
    group,
    parts,
    byName,
    shellMats: [...shellMatSet],
    barrelMat,
    coreMat,
    springMats: [...springMatSet],
    brassMat,
    gripNode,
    jawNodes,
  }
}
