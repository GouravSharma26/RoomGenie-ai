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
  gltfLoader?: {
    load(
      url: string,
      onLoad: (gltf: any) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (err: unknown) => void
    ): void;
  };
}

export interface WebXrSessionController {
  endSession(): Promise<void>;
  isPlaced(): boolean;
  isSurfaceDetected(): boolean;
  setRotationY(yawRadians: number): void;
  setScale(scaleFactor: number): void;
  repositionToReticle(): boolean;
  isDisposed?(): boolean;
}

const disposedResourceSet = new WeakSet<object>();

/**
 * Traverses an Object3D hierarchy and disposes all unique BufferGeometries,
 * Materials, and Textures.
 * Deduplicates shared resources so each is disposed exactly once.
 * Prevents double-disposal across multiple calls using a WeakSet.
 */
export function disposeObjectHierarchy(root: THREE.Object3D): void {
  if (!root) return;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  const collectTexture = (tex: any) => {
    if (tex && typeof tex === 'object' && typeof tex.dispose === 'function') {
      if ((tex.isTexture === true || tex instanceof THREE.Texture) && !disposedResourceSet.has(tex)) {
        textures.add(tex);
      }
    }
  };

  root.traverse((node: any) => {
    // 1. Collect geometry
    if (node.geometry && typeof node.geometry.dispose === 'function') {
      if (!disposedResourceSet.has(node.geometry)) {
        geometries.add(node.geometry);
      }
    }

    // 2. Collect material(s) and associated textures
    if (node.material) {
      const matList = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of matList) {
        if (mat && typeof mat === 'object') {
          if (typeof mat.dispose === 'function' && !disposedResourceSet.has(mat)) {
            materials.add(mat);
          }

          // Inspect standard material properties for textures
          for (const key of Object.keys(mat)) {
            const val = mat[key];
            if (Array.isArray(val)) {
              for (const item of val) {
                collectTexture(item);
              }
            } else {
              collectTexture(val);
            }
          }

          // Inspect shader uniforms for textures
          if (mat.uniforms && typeof mat.uniforms === 'object') {
            for (const uniformKey of Object.keys(mat.uniforms)) {
              const uVal = mat.uniforms[uniformKey]?.value;
              collectTexture(uVal);
            }
          }
        }
      }
    }
  });

  // Detach from parent if attached
  if (root.parent) {
    try {
      root.parent.remove(root);
    } catch {
      // safe
    }
  }

  // Dispose textures
  for (const texture of textures) {
    disposedResourceSet.add(texture);
    try {
      texture.dispose();
    } catch {
      // safe
    }
  }

  // Dispose materials
  for (const material of materials) {
    disposedResourceSet.add(material);
    try {
      material.dispose();
    } catch {
      // safe
    }
  }

  // Dispose geometries
  for (const geometry of geometries) {
    disposedResourceSet.add(geometry);
    try {
      geometry.dispose();
    } catch {
      // safe
    }
  }
}

/**
 * Initiates and manages a native W3C WebXR 'immersive-ar' session.
 * Configures Three.js WebGLRenderer, XR reference spaces, XRHitTestSource,
 * dynamic surface reticle tracking, tap-to-place model rendering,
 * and robust resource lifecycle management.
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

  let canvas: HTMLCanvasElement | null = null;
  let renderer: any = null;
  let scene: THREE.Scene | null = null;
  let hitTestSource: any = null;
  let isDisposed = false;
  let isInitialized = false;
  let activeModel: THREE.Object3D | null = null;
  let fallbackMesh: THREE.Mesh | null = null;
  let onSelect: (() => void) | null = null;

  const cleanup = () => {
    if (isDisposed) {
      return;
    }
    isDisposed = true;

    if (renderer) {
      try {
        renderer.setAnimationLoop(null);
      } catch {}
    }

    if (session) {
      if (onSelect) {
        try {
          session.removeEventListener('select', onSelect);
        } catch {}
      }
      try {
        session.removeEventListener('end', cleanup);
      } catch {}
    }

    if (hitTestSource?.cancel) {
      try {
        hitTestSource.cancel();
      } catch {}
      hitTestSource = null;
    }

    if (activeModel) {
      disposeObjectHierarchy(activeModel);
      activeModel = null;
    }

    if (fallbackMesh) {
      disposeObjectHierarchy(fallbackMesh);
      fallbackMesh = null;
    }

    if (scene) {
      try {
        disposeObjectHierarchy(scene);
        scene.clear();
      } catch {}
    }

    if (renderer) {
      try {
        renderer.dispose();
      } catch {}
    }

    if (canvas && canvas.parentElement) {
      try {
        canvas.parentElement.removeChild(canvas);
      } catch {}
    }

    if (isInitialized) {
      try {
        options.onSessionEnd?.();
      } catch {}
    }
  };

  try {
    // 3. Setup Three.js WebGLRenderer & XR Canvas
    canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);

    renderer = options.rendererFactory
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
    scene = new THREE.Scene();
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
      const loader = options.gltfLoader || new GLTFLoader();
      loader.load(
        options.modelUrl,
        (gltf: any) => {
          if (isDisposed) {
            // Teardown has already executed: release model resources immediately without attaching
            if (gltf?.scene) {
              disposeObjectHierarchy(gltf.scene);
            }
            return;
          }

          const model = gltf.scene;
          activeModel = model;
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
        (loadErr: any) => {
          if (isDisposed) {
            return;
          }
          // Fallback procedural visualizer if external load fails
          fallbackMesh = createFallbackFurnitureMesh(targetW, targetH, targetD);
          placedGroup.add(fallbackMesh);
          const errMessage = (loadErr as any)?.message || String(loadErr);
          options.onError?.(new Error(`Model loading failed in XR: ${errMessage}`));
        }
      );
    } else {
      fallbackMesh = createFallbackFurnitureMesh(targetW, targetH, targetD);
      placedGroup.add(fallbackMesh);
    }

    // 7. Request Reference Spaces & Hit Test Source
    const viewerSpace = await session.requestReferenceSpace('viewer');
    const localFloorSpace = await session.requestReferenceSpace('local-floor');
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

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
    onSelect = () => {
      if (reticle.visible) {
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
    session.addEventListener('end', cleanup);

    isInitialized = true;

    // 10. Controller Interface
    return {
      async endSession() {
        if (isDisposed) {
          return;
        }
        try {
          await session.end();
        } catch {
          // Safe if session already ended
        } finally {
          cleanup();
        }
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
        if (reticle.visible && onSelect) {
          onSelect();
          return true;
        }
        return false;
      },
      isDisposed() {
        return isDisposed;
      },
    };
  } catch (err: any) {
    cleanup();
    if (session) {
      try {
        await session.end();
      } catch {}
    }
    const errorObj = err instanceof Error ? err : new Error(String(err));
    options.onError?.(errorObj);
    throw errorObj;
  }
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
