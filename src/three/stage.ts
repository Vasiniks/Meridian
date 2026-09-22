import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import type { QualityConfig } from './config'

export interface Stage {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  composer: EffectComposer
  key: THREE.DirectionalLight
  setSize: (w: number, h: number) => void
  dispose: () => void
}

export async function createStage(
  canvas: HTMLCanvasElement,
  cfg: QualityConfig,
): Promise<Stage> {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.dprCap))
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  renderer.shadowMap.enabled = cfg.quality === 'high'
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(
    35,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  )
  camera.position.set(3.6, 1.6, 8.0)

  const pmrem = new THREE.PMREMGenerator(renderer)
  // Real photo-studio HDRI (Poly Haven, CC0) for metal reflections.
  // Falls back to the procedural card room if the file can't load.
  try {
    const hdr = await new HDRLoader().loadAsync(
      '/environments/studio_small_09_1k.hdr',
    )
    scene.environment = pmrem.fromEquirectangular(hdr).texture
    hdr.dispose()
  } catch {
    scene.environment = pmrem.fromScene(buildStudioEnv(), 0.04).texture
  }
  // Scene-level base: per-material envMapIntensity (see assembly.ts) does
  // the selective part — anodized/steel/brass sit above 1, polymers below.
  if ('environmentIntensity' in scene) scene.environmentIntensity = 1.0
  pmrem.dispose()

  // Studio rig for faceted satin metal on a light-paper backdrop.
  // Key rakes from front-right-top so adjacent hex faces (60 deg apart)
  // get clearly different NdotL; rim + strip cut edges from back-left and
  // right-back; fill lifts shadow sides without flattening; top card-light
  // gives the anodized chamfers their sheen.
  const key = new THREE.DirectionalLight(0xfff1e2, 3.2)
  key.position.set(4.5, 6, 3.5)
  key.castShadow = cfg.quality === 'high'
  const s = cfg.quality === 'high' ? 2048 : 1024
  key.shadow.mapSize.set(s, s)
  key.shadow.bias = -0.00015
  key.shadow.normalBias = 0.02
  key.shadow.radius = 4
  key.shadow.camera.left = -3.5
  key.shadow.camera.right = 3.5
  key.shadow.camera.top = 6
  key.shadow.camera.bottom = -6
  key.shadow.camera.near = 1
  key.shadow.camera.far = 20
  const rim = new THREE.DirectionalLight(0xd8e6ff, 2.8)
  rim.position.set(-6, 3, -5.5)
  const fill = new THREE.DirectionalLight(0xfff1e0, 0.65)
  fill.position.set(-3.5, 0.8, 5.5)
  const top = new THREE.DirectionalLight(0xffffff, 1.4)
  top.position.set(0.5, 7.5, -0.5)
  const strip = new THREE.DirectionalLight(0xe8f0ff, 1.0)
  strip.position.set(6.5, 1.2, -2.5)
  scene.add(key, rim, fill, top, strip)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.16 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -4.8
  ground.receiveShadow = true
  scene.add(ground)

  const composer =
    cfg.msaaSamples > 0
      ? (() => {
          // Native MSAA on the composer's targets (WebGL2). Must be set at
          // construction — render-target textures are immutable afterwards.
          const size = renderer.getDrawingBufferSize(new THREE.Vector2())
          const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
            samples: cfg.msaaSamples,
            type: THREE.HalfFloatType,
          })
          return new EffectComposer(renderer, rt)
        })()
      : new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(new OutputPass())

  return {
    renderer,
    scene,
    camera,
    composer,
    key,
    setSize: (w: number, h: number) => {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.dprCap))
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
    },
    dispose: () => {
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const m = o.material as THREE.Material | THREE.Material[]
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
      composer.dispose()
      renderer.dispose()
    },
  }
}

/**
 * Tiny procedural product-photography environment for PMREM.
 * A near-black room with a few HDR "softbox" cards: a large warm key card
 * front-right-top (broad satin gradient), a tall cool strip left (facet
 * separation), a narrow bright kicker right-back (hex edge highlights), a
 * moderate top card (chamfer/anodized sheen) and a dim frontal fill card
 * so shadow faces stay readable. Dark metals need bright, SHAPED sources
 * to reflect — a neutral RoomEnvironment at 0.6 leaves them near-black.
 */
function buildStudioEnv(): THREE.Scene {
  const env = new THREE.Scene()
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(30, 30, 30),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
  )
  // Reflection floor: raised so no mirror direction returns pitch black.
  // Dark satin metals still read dark — but with a lifted floor plus narrow
  // bright cards, faces separate and edges catch streaks.
  room.material.color.setRGB(0.055, 0.055, 0.065)
  env.add(room)

  const card = (
    w: number,
    h: number,
    rgb: [number, number, number],
    pos: [number, number, number],
  ): void => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial(),
    )
    m.material.color.setRGB(...rgb)
    m.position.set(...pos)
    m.lookAt(0, 0, 0)
    env.add(m)
  }

  card(9, 6, [13, 11.5, 9.5], [8, 7, 6]) // warm key softbox
  card(3, 10, [7, 9, 12], [-8, 2, 5]) // cool left strip
  card(2.2, 9, [14, 15, 18], [8, 1.5, -3]) // right-back edge kicker
  card(1.4, 9, [9, 10, 12], [-6, 4, -7]) // back-left edge kicker
  card(7, 7, [4.5, 4.5, 4.6], [0, 9, 0]) // top sheen
  // Frontal softbox: camera-facing hex planes reflect the dark room behind
  // the camera, so this card must be bright enough to give them a readable
  // satin gradient (dark metals need shaped sources in every facing).
  card(10, 6, [2.8, 2.7, 2.55], [0, 1.5, 10]) // frontal satin lift
  card(8, 5, [0.6, 0.65, 0.75], [10, 0.5, 2]) // faint cool side bounce
  card(8, 8, [0.35, 0.35, 0.38], [0, -9, 2]) // dim floor bounce
  card(6, 6, [2.4, 2.6, 3.0], [-7, 1, -6]) // back-left gradient bounce
  return env
}
