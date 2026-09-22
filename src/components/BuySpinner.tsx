import { useEffect, useRef } from "react";
import * as THREE from "three";
import { loadAssembly, type Assembly } from "../three/assembly";
import { ANODIZED } from "../three/config";

const MODEL_URL = "/models/mobile/mechanical-pencil-mobile.glb";
// Slow turntable: one revolution ≈ 14 s.
const SPIN_SPEED = 0.45;
// Exponential color chase: 1 − exp(−6·t) settles ≈97% in ~600 ms.
const LERP_RATE = 6;

interface BuySpinnerProps {
  variant: string;
}

/**
 * Compact second Three.js scene: the real product asset (same mobile GLB
 * the main experience loads on small screens — browser-cached) on a
 * slow turntable. Own renderer/scene/camera — the main PencilExperience
 * canvas is never touched.
 */
export default function BuySpinner({ variant }: BuySpinnerProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<THREE.Color>(
    new THREE.Color(ANODIZED[variant] ?? ANODIZED.Core),
  );

  // The selected variant chases a target color; the render loop LERPs the
  // barrel material toward it every frame (≈600 ms settle, no snap).
  useEffect(() => {
    targetRef.current.setHex(ANODIZED[variant] ?? ANODIZED.Core);
  }, [variant]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    let disposed = false;
    let raf = 0;
    let running = false;
    let visible = true;
    let reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    // Performance discipline: DPR capped at 1.5; single 1024px shadow map.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    // No backdrop: transparent canvas floats the real model over the page.

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
    camera.position.set(3.6, 2.0, 8.4);
    camera.lookAt(0, 0.35, 0);

    // Simplified studio env (same softbox-card approach as stage.ts) so
    // the satin metals read — no HDR download, built procedurally.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(buildSpinnerEnv(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    // 3-light studio rig: warm key (casts the ground shadow), cool rim,
    // soft frontal fill.
    const key = new THREE.DirectionalLight(0xfff1e2, 2.6);
    key.position.set(4, 5, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 25;
    key.shadow.bias = -0.0002;
    const rim = new THREE.DirectionalLight(0xd8e6ff, 2.0);
    rim.position.set(-5, 3, -4);
    const fill = new THREE.DirectionalLight(0xfff1e0, 0.6);
    fill.position.set(-3, 1, 5);
    scene.add(key, rim, fill);

    // Soft contact shadow catcher under the model.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowMaterial({ opacity: 0.18 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const sizeToWrapper = (): void => {
      const r = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      // Square card; fall back to 300 px before layout settles.
      const h = Math.max(1, Math.round(r.width || 300));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    sizeToWrapper();

    let asm: Assembly | null = null;
    // Reuse the real product hierarchy (assembled pose, lookdev tuning).
    // "high" so the meshes cast onto the shadow catcher.
    loadAssembly(MODEL_URL, scene, "high")
      .then((a) => {
        if (disposed) return;
        asm = a;
        // Flattering 3/4 opening angle; the loop turntables from here.
        asm.group.rotation.y = -0.45;
        asm.barrelMat?.color.copy(targetRef.current);
        // Frame the whole model, centered on its bounding sphere, and
        // seat the shadow catcher under it.
        const box = new THREE.Box3().setFromObject(asm.group);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        ground.position.y = box.min.y - 0.02;
        const fitH =
          sphere.radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const fitW =
          sphere.radius /
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
          camera.aspect;
        const dist = Math.max(fitH, fitW) * 1.05;
        const dir = new THREE.Vector3(0.38, 0.22, 1).normalize();
        camera.position.copy(sphere.center).addScaledVector(dir, dist);
        camera.lookAt(sphere.center);
      })
      .catch(() => {
        // Asset failure: hide the card, leave the buy layout intact.
        if (!disposed) wrap.style.display = "none";
      });

    const clock = new THREE.Clock();
    const loop = (): void => {
      if (!running || disposed) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, clock.getDelta());
      if (asm) {
        // Turntable; frozen entirely under prefers-reduced-motion.
        if (!reduced) asm.group.rotation.y += SPIN_SPEED * dt;
        // Gradual variant tint: chase the target, never snap.
        const barrel = asm.barrelMat;
        if (barrel && barrel.color.getHex() !== targetRef.current.getHex()) {
          barrel.color.lerp(targetRef.current, 1 - Math.exp(-LERP_RATE * dt));
        }
      }
      renderer.render(scene, camera);
    };
    const start = (): void => {
      if (running || disposed || !visible || document.hidden) return;
      running = true;
      clock.getDelta();
      raf = requestAnimationFrame(loop);
    };
    const stop = (): void => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // Pause rendering when the card scrolls offscreen.
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) start();
      else stop();
    });
    io.observe(wrap);

    const ro = new ResizeObserver(sizeToWrapper);
    ro.observe(wrap);

    const onVis = (): void => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVis);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = (e: MediaQueryListEvent): void => {
      reduced = e.matches;
    };
    mq.addEventListener("change", onMq);

    start();

    return () => {
      disposed = true;
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onMq);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      envTex.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={wrapRef} className="buy-spinner">
      <canvas
        ref={canvasRef}
        className="buy-spinner-canvas"
        aria-label={`Live 3D preview — ${variant} variant`}
        role="img"
      />
      <p className="buy-spinner-cap" aria-live="polite">
        Live preview · {variant}
      </p>
    </div>
  );
}

/**
 * Procedural mini studio for PMREM: dark room + warm key, cool strip,
 * top sheen and frontal lift cards (reduced version of stage.ts).
 */
function buildSpinnerEnv(): THREE.Scene {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(30, 30, 30),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
  );
  room.material.color.setRGB(0.055, 0.055, 0.065);
  env.add(room);

  const card = (
    w: number,
    h: number,
    rgb: [number, number, number],
    pos: [number, number, number],
  ): void => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial(),
    );
    m.material.color.setRGB(...rgb);
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };

  card(9, 6, [13, 11.5, 9.5], [8, 7, 6]); // warm key softbox
  card(3, 10, [7, 9, 12], [-8, 2, 5]); // cool left strip
  card(2.2, 9, [14, 15, 18], [8, 1.5, -3]); // right-back edge kicker
  card(7, 7, [4.5, 4.5, 4.6], [0, 9, 0]); // top sheen
  card(10, 6, [2.8, 2.7, 2.55], [0, 1.5, 10]); // frontal satin lift
  return env;
}
