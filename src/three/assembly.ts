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
 * Loads the external GLB asset and maps named nodes into a stable,
 * name-keyed product hierarchy. No fragile array indexes.
 */
/**
 * LOOKDEV runtime overrides (materials arrive as MeshStandardMaterial).
 * Frosted-black-anodized target (per exemplar): deep near-black albedo with
 * a soft broad sheen — moderately HIGH roughness, restrained env response,
 * fine micro-grain breaking up the reflection. Dark metals keep a small
 * albedo lift (specular is tinted by base color; ≈0.01 linear kills all
 * reflections), but the lift stays low so the body reads black, not grey.
 */
function tuneLookdev(mat: THREE.MeshStandardMaterial): void {
  if (mat.userData.lookdev) return
  mat.userData.lookdev = true
  const set = (
    metalness: number,
    roughness: number,
    env: number,
    lift = 1,
  ): void => {
    mat.metalness = metalness
    mat.roughness = roughness
    mat.envMapIntensity = env
    if (lift !== 1) mat.color.multiplyScalar(lift)
  }
  // Clean machined-metal PBR (Rotring reference): no color maps, no
  // patina — albedo + metalness + roughness + studio HDRI do the work.
  const plate = (_normalScale: number): void => {
    mat.roughnessMap = null
    mat.normalMap = null
  }
  switch (mat.name) {
    case 'anodized':
      // matte black metal: deep black, soft wide sheen
      set(1.0, 0.52, 1.0, 1.15)
      plate(0)
      break
    case 'dlc':
      set(1.0, 0.48, 1.0, 1.1)
      plate(0)
      break
    case 'steel':
      set(1.0, 0.34, 1.1)
      plate(0)
      break
    case 'polished':
      set(1.0, 0.24, 1.2)
      break
    case 'brass':
      set(1.0, 0.38, 1.0)
      plate(0)
      break
    case 'spring':
      set(1.0, 0.5, 0.9)
      break
    case 'recess':
      set(0.6, 0.62, 0.6)
      break
    case 'polymer':
      set(0.0, 0.5, 0.7)
      break
    case 'mechdark':
      set(0.5, 0.5, 0.8)
      break
    case 'reservoir':
      set(0.1, 0.15, 0.8)
      break
    case 'eraser':
      set(0.0, 0.92, 0.5)
      break
    case 'lead':
      set(0.25, 0.55, 0.6)
      break
    default:
      mat.envMapIntensity = 1.0
      break
  }
}

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
      if (name === 'barrelHex') barrelMat = active
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
