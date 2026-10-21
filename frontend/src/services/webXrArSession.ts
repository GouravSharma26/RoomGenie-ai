import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface WebXrSessionOptions {
  modelUrl: string | null;
  dimensions?: [number, number, number]; // [width, height, depth] in metres
  domOverlayContainer?: HTMLElement | null;
  onSurfaceDetectedChange?: (detected: boolean) => void;
  onPlaced?: (position: [number, number, number], rotationY: number, scale: number) => void;
  onSessionEnd?: () => void;
  onError?: (error: Error) => void;
  rendererFactory?: (canvas: HTMLCanvasElement) => any;
}

export interface WebXrSessionController {
  endSession(): Promise<void>;
  isPlaced(): boolean;
  isSurfaceDetected(): boolean;
  setRotationY(yawRadians: number): void;
  setScale(scaleFactor: number): void;
  repositionToReticle(): boolean;
}

/**
 * Initiates and manages a native W3C WebXR 'immersive-ar' session.
 * Configures Three.js WebGLRenderer, XR reference spaces, XRHitTestSource,
 * dynamic surface reticle tracking, tap-to-place model rendering,
 * and clean resource teardown.
 */
export async function startWebXrArSession(
  options: WebXrSessionOptions
): Promise<WebXrSessionController> {
  if (typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr) {
    throw new Error('WebXR Device API is not available in this environment.');
  }

  const isSupported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!isSupported) {
    throw new Error('WebXR immersive-ar session mode is not supported on this device/browser.');
  }

  // 1. Build session initialization features
  const sessionInit: Record<string, any> = {
    requiredFeatures: ['hit-test', 'local-floor'],
    optionalFeatures: ['light-estimation'],
  };

  if (options.domOverlayContainer) {
    sessionInit.optionalFeatures.push('dom-overlay');
    sessionInit.domOverlay = { root: options.domOverlayContainer };
  }

  // 2. Request XR session
  const session = await (navigator.xr as any).requestSession('immersive-ar', sessionInit);

  // 3. Setup Three.js WebGLRenderer & XR Canvas
  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '9999';
  document.body.appendChild(canvas);

  const renderer = options.rendererFactory
    ? options.rendererFactory(canvas)
    : new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
      });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  await renderer.xr.setSession(session);

  // 4. Setup Scene, Camera & Lighting
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
  directionalLight.position.set(0.5, 3.0, 1.0);
  scene.add(directionalLight);

  // 5. Create Surface Reticle
  const reticleGeometry = new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2);
  const reticleMaterial = new THREE.MeshBasicMaterial({
    color: 0x06b6d4, // Cyan
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // 6. Setup Placed Model Container
  const placedGroup = new THREE.Group();
  placedGroup.visible = false;
  scene.add(placedGroup);

  const targetDimensions = options.dimensions || [0.8, 0.8, 0.8];
  const [targetW, targetH, targetD] = targetDimensions;

  // Load Model or Procedural Fallback Box
  if (options.modelUrl) {
    const loader = new GLTFLoader();
    loader.load(
      options.modelUrl,
      (gltf) => {
        const model = gltf.scene;
        const bbox = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        bbox.getSize(size);

        if (size.x > 0.001 && size.y > 0.001 && size.z > 0.001) {
          model.scale.set(targetW / size.x, targetH / size.y, targetD / size.z);
        }

        // Align model base flush with Y = 0
        const updatedBbox = new THREE.Box3().setFromObject(model);
        model.position.y = -updatedBbox.min.y;

        placedGroup.add(model);
      },
      undefined,
      (loadErr) => {
        // Fallback procedural visualizer if external load fails
        const fallbackBox = createFallbackFurnitureMesh(targetW, targetH, targetD);
        placedGroup.add(fallbackBox);
        const errMessage = (loadErr as any)?.message || String(loadErr);
        options.onError?.(new Error(`Model loading failed in XR: ${errMessage}`));
      }
    );
  } else {
    const fallbackBox = createFallbackFurnitureMesh(targetW, targetH, targetD);
    placedGroup.add(fallbackBox);
  }

  // 7. Request Reference Spaces & Hit Test Source
  let localFloorSpace: any = null;
  let hitTestSource: any = null;
  try {
    const viewerSpace = await session.requestReferenceSpace('viewer');
    localFloorSpace = await session.requestReferenceSpace('local-floor');
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  } catch (err: any) {
    options.onError?.(new Error(`Failed to initialize XR hit-test space: ${err.message}`));
  }

  let surfaceDetected = false;
  let modelPlaced = false;

  // 8. XR Animation / Frame Loop
  renderer.setAnimationLoop((_timestamp: number, frame: any) => {
    if (frame && hitTestSource && localFloorSpace) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(localFloorSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
          if (!surfaceDetected) {
            surfaceDetected = true;
            options.onSurfaceDetectedChange?.(true);
          }
        }
      } else {
        reticle.visible = false;
        if (surfaceDetected) {
          surfaceDetected = false;
          options.onSurfaceDetectedChange?.(false);
        }
      }
    }

    renderer.render(scene, camera);
  });

  // 9. Tap-to-Place (Select Gesture)
  const onSelect = () => {
    if (reticle.visible) {
      // Place at current reticle matrix
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      reticle.matrix.decompose(pos, quat, scale);

      placedGroup.position.copy(pos);
      placedGroup.visible = true;
      modelPlaced = true;

      options.onPlaced?.(
        [pos.x, pos.y, pos.z],
        placedGroup.rotation.y,
        placedGroup.scale.x
      );
    }
  };

  session.addEventListener('select', onSelect);

  // 10. Clean Teardown on Session End
  const cleanup = () => {
    renderer.setAnimationLoop(null);
    session.removeEventListener('select', onSelect);
    if (hitTestSource?.cancel) {
      hitTestSource.cancel();
    }
    reticleGeometry.dispose();
    reticleMaterial.dispose();
    scene.clear();
    renderer.dispose();
    if (canvas.parentElement) {
      canvas.parentElement.removeChild(canvas);
    }
    options.onSessionEnd?.();
  };

  session.addEventListener('end', cleanup);

  // 11. Controller Interface
  return {
    async endSession() {
      await session.end();
    },
    isPlaced() {
      return modelPlaced;
    },
    isSurfaceDetected() {
      return surfaceDetected;
    },
    setRotationY(yawRadians: number) {
      placedGroup.rotation.y = yawRadians;
    },
    setScale(scaleFactor: number) {
      const clamped = Math.max(0.5, Math.min(2.0, scaleFactor));
      placedGroup.scale.set(clamped, clamped, clamped);
    },
    repositionToReticle() {
      if (reticle.visible) {
        onSelect();
        return true;
      }
      return false;
    },
  };
}

/**
 * Creates an architectural preview mesh grounded at Y = 0
 * used when glTF model is unavailable or in testing environments.
 */
function createFallbackFurnitureMesh(w: number, h: number, d: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4f46e5, // Indigo
    roughness: 0.4,
    metalness: 0.2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = h / 2; // Ground bottom face at Y = 0
  return mesh;
}
