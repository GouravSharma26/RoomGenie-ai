import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { startWebXrArSession, disposeObjectHierarchy } from './webXrArSession';

describe('webXrArSession', () => {
  let originalXr: any;

  beforeEach(() => {
    originalXr = (navigator as any).xr;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'xr', {
      value: originalXr,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  function setupMockXREnvironment() {
    let animationLoopCallback: ((time: number, frame: any) => void) | null = null;
    let selectListener: (() => void) | null = null;
    let endListener: (() => void) | null = null;

    const cancelHitTestSource = vi.fn();
    const mockSession = {
      requestReferenceSpace: vi.fn().mockImplementation((type: string) => {
        return Promise.resolve({ type });
      }),
      requestHitTestSource: vi.fn().mockResolvedValue({
        cancel: cancelHitTestSource,
      }),
      addEventListener: vi.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'select') selectListener = handler;
        if (event === 'end') endListener = handler;
      }),
      removeEventListener: vi.fn(),
      end: vi.fn().mockImplementation(() => {
        endListener?.();
        return Promise.resolve();
      }),
    };

    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: vi.fn().mockResolvedValue(true),
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
      configurable: true,
    });

    const mockRenderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      xr: {
        enabled: false,
        setSession: vi.fn().mockResolvedValue(undefined),
      },
      setAnimationLoop: vi.fn().mockImplementation((cb: any) => {
        animationLoopCallback = cb;
      }),
      render: vi.fn(),
      dispose: vi.fn(),
    };

    return {
      mockSession,
      mockRenderer,
      cancelHitTestSource,
      getAnimationLoopCallback: () => animationLoopCallback,
      getSelectListener: () => selectListener,
      triggerEnd: () => endListener?.(),
    };
  }

  it('rejects if WebXR is not present on navigator', async () => {
    Object.defineProperty(navigator, 'xr', {
      value: undefined,
      configurable: true,
    });

    await expect(
      startWebXrArSession({ modelUrl: null, dimensions: [1, 1, 1] })
    ).rejects.toThrow('WebXR Device API is not available');
  });

  it('rejects if immersive-ar is not supported', async () => {
    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: vi.fn().mockResolvedValue(false),
      },
      configurable: true,
    });

    await expect(
      startWebXrArSession({ modelUrl: null, dimensions: [1, 1, 1] })
    ).rejects.toThrow('immersive-ar session mode is not supported');
  });

  it('successfully initializes WebXR session, registers hit-testing frame loop, detects surfaces, places model, and cleans up on end', async () => {
    const {
      mockSession,
      mockRenderer,
      getAnimationLoopCallback,
      getSelectListener,
    } = setupMockXREnvironment();

    const onSurfaceDetectedChange = vi.fn();
    const onPlaced = vi.fn();
    const onSessionEnd = vi.fn();

    const controller = await startWebXrArSession({
      modelUrl: null,
      dimensions: [0.8, 0.8, 0.8],
      onSurfaceDetectedChange,
      onPlaced,
      onSessionEnd,
      rendererFactory: () => mockRenderer as any,
    });

    expect(controller).toBeDefined();
    expect(controller.isPlaced()).toBe(false);
    expect(controller.isSurfaceDetected()).toBe(false);
    expect(mockRenderer.xr.setSession).toHaveBeenCalledWith(mockSession);
    expect(getAnimationLoopCallback()).toBeDefined();

    // 1. Simulate XR frame with real hit-test result
    const mockHitPose = {
      transform: {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0, -1.2, 1],
      },
    };
    const mockFrameWithHit = {
      getHitTestResults: vi.fn().mockReturnValue([
        {
          getPose: vi.fn().mockReturnValue(mockHitPose),
        },
      ]),
    };

    getAnimationLoopCallback()!(100, mockFrameWithHit);
    expect(onSurfaceDetectedChange).toHaveBeenCalledWith(true);
    expect(controller.isSurfaceDetected()).toBe(true);

    // 2. Simulate tap-to-place (select gesture)
    const selectListener = getSelectListener();
    expect(selectListener).toBeDefined();
    selectListener!();
    expect(onPlaced).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Number),
      expect.any(Number)
    );
    expect(controller.isPlaced()).toBe(true);

    // 3. Test adjustments
    controller.setRotationY(Math.PI / 4);
    controller.setScale(1.5);

    // 4. Simulate XR frame without hit-test results (lost tracking / no surface)
    const mockFrameNoHit = {
      getHitTestResults: vi.fn().mockReturnValue([]),
    };
    getAnimationLoopCallback()!(200, mockFrameNoHit);
    expect(onSurfaceDetectedChange).toHaveBeenCalledWith(false);
    expect(controller.isSurfaceDetected()).toBe(false);

    // 5. End session and verify teardown
    await controller.endSession();
    expect(mockSession.end).toHaveBeenCalled();
    expect(onSessionEnd).toHaveBeenCalled();
    expect(mockRenderer.dispose).toHaveBeenCalled();
    expect(controller.isDisposed?.()).toBe(true);
  });

  it('disposeObjectHierarchy disposes unique geometries, materials, and textures without double-disposing shared resources', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const texture = new THREE.Texture();
    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const spyGeoDispose = vi.spyOn(geo, 'dispose');
    const spyMatDispose = vi.spyOn(mat, 'dispose');
    const spyTexDispose = vi.spyOn(texture, 'dispose');

    const group = new THREE.Group();
    // Two meshes sharing the same geometry and material
    const mesh1 = new THREE.Mesh(geo, mat);
    const mesh2 = new THREE.Mesh(geo, mat);
    group.add(mesh1);
    group.add(mesh2);

    disposeObjectHierarchy(group);

    // Each shared resource should be disposed exactly once
    expect(spyGeoDispose).toHaveBeenCalledTimes(1);
    expect(spyMatDispose).toHaveBeenCalledTimes(1);
    expect(spyTexDispose).toHaveBeenCalledTimes(1);

    // Repeated call should not double-dispose
    disposeObjectHierarchy(group);
    expect(spyGeoDispose).toHaveBeenCalledTimes(1);
    expect(spyMatDispose).toHaveBeenCalledTimes(1);
    expect(spyTexDispose).toHaveBeenCalledTimes(1);
  });

  it('ending the session after a model has loaded disposes its resources', async () => {
    const { mockRenderer } = setupMockXREnvironment();

    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const texture = new THREE.Texture();
    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const spyGeo = vi.spyOn(geo, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');
    const spyTex = vi.spyOn(texture, 'dispose');

    const modelScene = new THREE.Group();
    modelScene.add(new THREE.Mesh(geo, mat));

    const mockLoader = {
      load: vi.fn((_url: string, onLoad: (gltf: any) => void) => {
        onLoad({ scene: modelScene });
      }),
    };

    const controller = await startWebXrArSession({
      modelUrl: 'https://example.com/couch.glb',
      dimensions: [0.8, 0.8, 0.8],
      rendererFactory: () => mockRenderer as any,
      gltfLoader: mockLoader,
    });

    expect(mockLoader.load).toHaveBeenCalledWith(
      'https://example.com/couch.glb',
      expect.any(Function),
      undefined,
      expect.any(Function)
    );

    await controller.endSession();

    expect(spyGeo).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
    expect(spyTex).toHaveBeenCalledTimes(1);
    expect(mockRenderer.dispose).toHaveBeenCalled();
    expect(controller.isDisposed?.()).toBe(true);
  });

  it('ending the session before the GLTF load resolves disposes the late-loaded model without attaching it', async () => {
    const { mockRenderer } = setupMockXREnvironment();

    let capturedOnLoad: ((gltf: any) => void) | null = null;
    const mockLoader = {
      load: vi.fn((_url: string, onLoad: (gltf: any) => void) => {
        capturedOnLoad = onLoad;
      }),
    };

    const controller = await startWebXrArSession({
      modelUrl: 'https://example.com/slow-model.glb',
      dimensions: [0.8, 0.8, 0.8],
      rendererFactory: () => mockRenderer as any,
      gltfLoader: mockLoader,
    });

    expect(capturedOnLoad).toBeDefined();

    // End session BEFORE load callback fires
    await controller.endSession();
    expect(controller.isDisposed?.()).toBe(true);

    // Late arrival of model
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const texture = new THREE.Texture();
    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const spyGeo = vi.spyOn(geo, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');
    const spyTex = vi.spyOn(texture, 'dispose');

    const lateModel = new THREE.Group();
    lateModel.add(new THREE.Mesh(geo, mat));

    // Invoke late load callback
    capturedOnLoad!({ scene: lateModel });

    // Should NOT be attached to anything
    expect(lateModel.parent).toBeNull();

    // Resources should be disposed immediately
    expect(spyGeo).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
    expect(spyTex).toHaveBeenCalledTimes(1);
  });

  it('fallback geometry and material are disposed when session ends', async () => {
    const { mockRenderer } = setupMockXREnvironment();

    const spyBoxDispose = vi.spyOn(THREE.BoxGeometry.prototype, 'dispose');
    const spyMatDispose = vi.spyOn(THREE.MeshStandardMaterial.prototype, 'dispose');

    const controller = await startWebXrArSession({
      modelUrl: null,
      dimensions: [0.8, 0.8, 0.8],
      rendererFactory: () => mockRenderer as any,
    });

    await controller.endSession();

    expect(spyBoxDispose).toHaveBeenCalled();
    expect(spyMatDispose).toHaveBeenCalled();
    expect(mockRenderer.dispose).toHaveBeenCalled();
    expect(controller.isDisposed?.()).toBe(true);
  });

  it('repeated cleanup does not double-dispose resources or throw', async () => {
    const { mockRenderer, triggerEnd } = setupMockXREnvironment();

    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const mat = new THREE.MeshBasicMaterial();
    const spyGeo = vi.spyOn(geo, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');

    const modelScene = new THREE.Group();
    modelScene.add(new THREE.Mesh(geo, mat));

    const mockLoader = {
      load: vi.fn((_url: string, onLoad: (gltf: any) => void) => {
        onLoad({ scene: modelScene });
      }),
    };

    const controller = await startWebXrArSession({
      modelUrl: 'https://example.com/chair.glb',
      dimensions: [0.8, 0.8, 0.8],
      rendererFactory: () => mockRenderer as any,
      gltfLoader: mockLoader,
    });

    // 1st end
    await controller.endSession();
    expect(spyGeo).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);

    // 2nd end via controller
    await expect(controller.endSession()).resolves.toBeUndefined();
    expect(spyGeo).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);

    // 3rd end via XR event
    expect(() => triggerEnd()).not.toThrow();
    expect(spyGeo).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });

  it('initialization failure cleans up any resources already acquired', async () => {
    const cancelHitTest = vi.fn();
    const mockSession = {
      requestReferenceSpace: vi.fn().mockImplementation((type: string) => {
        if (type === 'local-floor') {
          return Promise.reject(new Error('Floor reference space unavailable'));
        }
        return Promise.resolve({ type });
      }),
      requestHitTestSource: vi.fn().mockResolvedValue({
        cancel: cancelHitTest,
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: vi.fn().mockResolvedValue(true),
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
      configurable: true,
    });

    const mockRenderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      xr: {
        enabled: false,
        setSession: vi.fn().mockResolvedValue(undefined),
      },
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    };

    const onError = vi.fn();
    const initialCanvasCount = document.querySelectorAll('canvas').length;

    await expect(
      startWebXrArSession({
        modelUrl: null,
        dimensions: [0.8, 0.8, 0.8],
        onError,
        rendererFactory: () => mockRenderer as any,
      })
    ).rejects.toThrow('Floor reference space unavailable');

    // XR camera session must be cleanly ended
    expect(mockSession.end).toHaveBeenCalled();

    // WebGL renderer must be disposed
    expect(mockRenderer.dispose).toHaveBeenCalled();

    // Canvas must be removed from document.body without leaking
    expect(document.querySelectorAll('canvas').length).toBe(initialCanvasCount);

    // Error callback invoked
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Floor reference space unavailable') })
    );
  });

  it('failure during renderer session setup terminates session and cleans up DOM canvas', async () => {
    const mockSession = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: vi.fn().mockResolvedValue(true),
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
      configurable: true,
    });

    const mockRenderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      xr: {
        enabled: false,
        setSession: vi.fn().mockRejectedValue(new Error('XR device lost')),
      },
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    };

    const initialCanvasCount = document.querySelectorAll('canvas').length;

    await expect(
      startWebXrArSession({
        modelUrl: null,
        rendererFactory: () => mockRenderer as any,
      })
    ).rejects.toThrow('XR device lost');

    expect(mockSession.end).toHaveBeenCalled();
    expect(mockRenderer.dispose).toHaveBeenCalled();
    expect(document.querySelectorAll('canvas').length).toBe(initialCanvasCount);
  });

  it('session ending while requestReferenceSpace("viewer") is pending aborts initialization, cleans up, and rejects', async () => {
    let endListener: (() => void) | null = null;
    let resolveViewerSpace: ((val: any) => void) | null = null;

    const mockSession = {
      requestReferenceSpace: vi.fn().mockImplementation((type: string) => {
        if (type === 'viewer') {
          return new Promise((resolve) => {
            resolveViewerSpace = resolve;
          });
        }
        return Promise.resolve({ type });
      }),
      requestHitTestSource: vi.fn(),
      addEventListener: vi.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'end') endListener = handler;
      }),
      removeEventListener: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: vi.fn().mockResolvedValue(true),
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
      configurable: true,
    });

    const mockRenderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      xr: {
        enabled: false,
        setSession: vi.fn().mockResolvedValue(undefined),
      },
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    };

    const initialCanvasCount = document.querySelectorAll('canvas').length;

    const initPromise = startWebXrArSession({
      modelUrl: null,
      rendererFactory: () => mockRenderer as any,
    });

    // Wait microtasks for requestSession to resolve and addEventListener to be registered
    await new Promise((r) => setTimeout(r, 0));

    // Verify session end listener was registered early before viewerSpace resolved
    expect(endListener).toBeDefined();

    // Trigger session end while viewerSpace is pending
    endListener!();

    // Now viewerSpace resolves after session has ended
    resolveViewerSpace!({ type: 'viewer' });

    // Expect initialization to reject
    await expect(initPromise).rejects.toThrow(/session ended/i);

    // Renderer must be disposed
    expect(mockRenderer.dispose).toHaveBeenCalled();

    // Canvas must be removed from DOM
    expect(document.querySelectorAll('canvas').length).toBe(initialCanvasCount);

    // Animation loop callback must NEVER have been registered
    expect(mockRenderer.setAnimationLoop).not.toHaveBeenCalledWith(expect.any(Function));

    // Subsequent reference spaces / hit-test sources must NOT have been requested
    expect(mockSession.requestHitTestSource).not.toHaveBeenCalled();
  });

  it('session ending while requestReferenceSpace("local-floor") is pending aborts initialization, cleans up, and rejects', async () => {
    let endListener: (() => void) | null = null;
    let resolveFloorSpace: ((val: any) => void) | null = null;

    const mockSession = {
      requestReferenceSpace: vi.fn().mockImplementation((type: string) => {
        if (type === 'local-floor') {
          return new Promise((resolve) => {
            resolveFloorSpace = resolve;
          });
        }
        return Promise.resolve({ type });
      }),
      requestHitTestSource: vi.fn(),
      addEventListener: vi.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'end') endListener = handler;
      }),
      removeEventListener: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: vi.fn().mockResolvedValue(true),
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
      configurable: true,
    });

    const mockRenderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      xr: {
        enabled: false,
        setSession: vi.fn().mockResolvedValue(undefined),
      },
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    };

    const initialCanvasCount = document.querySelectorAll('canvas').length;

    const initPromise = startWebXrArSession({
      modelUrl: null,
      rendererFactory: () => mockRenderer as any,
    });

    // Allow viewer reference space promise microtask to resolve
    await new Promise((r) => setTimeout(r, 0));

    expect(endListener).toBeDefined();

    // Trigger session end while local-floor is pending
    endListener!();

    // Now resolve floor space
    resolveFloorSpace!({ type: 'local-floor' });

    // Expect initialization to reject
    await expect(initPromise).rejects.toThrow(/session ended/i);

    expect(mockRenderer.dispose).toHaveBeenCalled();
    expect(document.querySelectorAll('canvas').length).toBe(initialCanvasCount);
    expect(mockRenderer.setAnimationLoop).not.toHaveBeenCalledWith(expect.any(Function));
    expect(mockSession.requestHitTestSource).not.toHaveBeenCalled();
  });

  it('session ending while requestHitTestSource() is pending aborts initialization, cleans up, and rejects', async () => {
    let endListener: (() => void) | null = null;
    let resolveHitTestSource: ((val: any) => void) | null = null;
    const cancelHitTestSource = vi.fn();

    const mockSession = {
      requestReferenceSpace: vi.fn().mockImplementation((type: string) => {
        return Promise.resolve({ type });
      }),
      requestHitTestSource: vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveHitTestSource = resolve;
        });
      }),
      addEventListener: vi.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'end') endListener = handler;
      }),
      removeEventListener: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };

    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: vi.fn().mockResolvedValue(true),
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
      configurable: true,
    });

    const mockRenderer = {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      xr: {
        enabled: false,
        setSession: vi.fn().mockResolvedValue(undefined),
      },
      setAnimationLoop: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    };

    const initialCanvasCount = document.querySelectorAll('canvas').length;

    const initPromise = startWebXrArSession({
      modelUrl: null,
      rendererFactory: () => mockRenderer as any,
    });

    // Allow reference spaces promises microtasks to resolve
    await new Promise((r) => setTimeout(r, 0));

    expect(endListener).toBeDefined();

    // Trigger session end while requestHitTestSource is pending
    endListener!();

    // Now resolve hit test source
    resolveHitTestSource!({ cancel: cancelHitTestSource });

    // Expect initialization to reject
    await expect(initPromise).rejects.toThrow(/session ended/i);

    // Hit-test source must be cancelled immediately to prevent leaks
    expect(cancelHitTestSource).toHaveBeenCalled();

    expect(mockRenderer.dispose).toHaveBeenCalled();
    expect(document.querySelectorAll('canvas').length).toBe(initialCanvasCount);
    expect(mockRenderer.setAnimationLoop).not.toHaveBeenCalledWith(expect.any(Function));
  });

  it('displays reticle immediately upon first valid hit-test result and synchronizes matrices', async () => {
    const { mockRenderer, getAnimationLoopCallback } = setupMockXREnvironment();
    const onSurfaceDetectedChange = vi.fn();

    const controller = await startWebXrArSession({
      modelUrl: null,
      dimensions: [0.8, 0.8, 0.8],
      onSurfaceDetectedChange,
      rendererFactory: () => mockRenderer as any,
    });

    // Before hit-test frame, surfaceDetected is false
    expect(controller.isSurfaceDetected()).toBe(false);
    expect(onSurfaceDetectedChange).toHaveBeenCalledWith(false);

    // Frame with hit-test pose
    const mockHitPose = {
      transform: {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.2, 0, -1.8, 1],
      },
    };
    const mockFrame = {
      getHitTestResults: vi.fn().mockReturnValue([
        {
          getPose: vi.fn().mockReturnValue(mockHitPose),
        },
      ]),
    };

    getAnimationLoopCallback()!(16.6, mockFrame);

    expect(controller.isSurfaceDetected()).toBe(true);
    expect(onSurfaceDetectedChange).toHaveBeenCalledWith(true);

    const metrics = controller.getPerformanceMetrics?.();
    expect(metrics).toBeDefined();
    expect(metrics?.timeToFirstHitTestMs).toBeGreaterThanOrEqual(0);
    expect(metrics?.timeToFirstReticleMs).toBeGreaterThanOrEqual(0);
    expect(metrics?.frameCount).toBe(1);

    await controller.endSession();
  });

  it('repositions an already-loaded model without re-fetching or re-decoding the GLB', async () => {
    const { mockRenderer, getAnimationLoopCallback, getSelectListener } = setupMockXREnvironment();

    const geo = new THREE.BoxGeometry(2.1, 0.85, 0.9);
    const mat = new THREE.MeshBasicMaterial();
    const modelGroup = new THREE.Group();
    modelGroup.add(new THREE.Mesh(geo, mat));

    const mockLoader = {
      load: vi.fn((_url: string, onLoad: (gltf: any) => void) => {
        onLoad({ scene: modelGroup });
      }),
    };

    const onPlaced = vi.fn();

    const controller = await startWebXrArSession({
      modelUrl: '/models/sofa.glb',
      dimensions: [2.1, 0.85, 0.9],
      onPlaced,
      rendererFactory: () => mockRenderer as any,
      gltfLoader: mockLoader,
    });

    // Model loaded once
    expect(mockLoader.load).toHaveBeenCalledTimes(1);

    // 1. Initial hit-test at (0.2, 0.0, -1.5)
    const pose1 = {
      transform: {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, 0.0, -1.5, 1],
      },
    };
    getAnimationLoopCallback()!(16, {
      getHitTestResults: vi.fn().mockReturnValue([{ getPose: () => pose1 }]),
    });

    // First placement via tap
    getSelectListener()!();
    expect(controller.isPlaced()).toBe(true);
    expect(onPlaced).toHaveBeenLastCalledWith([0.2, 0.0, -1.5], expect.any(Number), expect.any(Number));
    expect(mockLoader.load).toHaveBeenCalledTimes(1);

    // 2. Move phone: new hit-test at (1.4, 0.0, -2.8)
    const pose2 = {
      transform: {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.4, 0.0, -2.8, 1],
      },
    };
    getAnimationLoopCallback()!(32, {
      getHitTestResults: vi.fn().mockReturnValue([{ getPose: () => pose2 }]),
    });

    // Reposition via controller or tap
    const repositioned = controller.repositionToReticle();
    expect(repositioned).toBe(true);
    expect(onPlaced).toHaveBeenLastCalledWith([1.4, 0.0, -2.8], expect.any(Number), expect.any(Number));

    // Crucial check: loader was NOT invoked again!
    expect(mockLoader.load).toHaveBeenCalledTimes(1);

    // Verify placement latency metric is captured
    const metrics = controller.getPerformanceMetrics?.();
    expect(metrics?.placementLatencyMs).toBeGreaterThanOrEqual(0);

    await controller.endSession();
  });

  it('preserves correct metric SI transforms, yaw rotation, scale, and grounding after subsequent repositioning', async () => {
    const { mockRenderer, getAnimationLoopCallback, getSelectListener } = setupMockXREnvironment();

    const onPlaced = vi.fn();
    const controller = await startWebXrArSession({
      modelUrl: null,
      dimensions: [1.0, 0.5, 0.8],
      onPlaced,
      rendererFactory: () => mockRenderer as any,
    });

    // First placement at (0, 0, -1)
    const pose1 = {
      transform: {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 1],
      },
    };
    getAnimationLoopCallback()!(16, {
      getHitTestResults: vi.fn().mockReturnValue([{ getPose: () => pose1 }]),
    });
    getSelectListener()!();

    // User applies manual rotation and scale adjustments
    controller.setRotationY(Math.PI / 3);
    controller.setScale(1.25);

    // Move to second location (0.75, 0, -2.2)
    const pose2 = {
      transform: {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.75, 0, -2.2, 1],
      },
    };
    getAnimationLoopCallback()!(32, {
      getHitTestResults: vi.fn().mockReturnValue([{ getPose: () => pose2 }]),
    });

    // Reposition
    controller.repositionToReticle();

    expect(onPlaced).toHaveBeenLastCalledWith(
      [0.75, 0, -2.2],
      expect.closeTo(Math.PI / 3, 4),
      expect.closeTo(1.25, 4)
    );

    await controller.endSession();
  });
});

