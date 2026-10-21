import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startWebXrArSession } from './webXrArSession';

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
    let animationLoopCallback: ((time: number, frame: any) => void) | null = null;
    let selectListener: (() => void) | null = null;
    let endListener: (() => void) | null = null;

    const mockSession = {
      requestReferenceSpace: vi.fn().mockImplementation((type: string) => {
        return Promise.resolve({ type });
      }),
      requestHitTestSource: vi.fn().mockResolvedValue({
        cancel: vi.fn(),
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
      setAnimationLoop: vi.fn().mockImplementation((cb) => {
        animationLoopCallback = cb;
      }),
      render: vi.fn(),
      dispose: vi.fn(),
    };

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
    expect(animationLoopCallback).toBeDefined();

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

    animationLoopCallback!(100, mockFrameWithHit);
    expect(onSurfaceDetectedChange).toHaveBeenCalledWith(true);
    expect(controller.isSurfaceDetected()).toBe(true);

    // 2. Simulate tap-to-place (select gesture)
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
    animationLoopCallback!(200, mockFrameNoHit);
    expect(onSurfaceDetectedChange).toHaveBeenCalledWith(false);
    expect(controller.isSurfaceDetected()).toBe(false);

    // 5. End session and verify teardown
    await controller.endSession();
    expect(mockSession.end).toHaveBeenCalled();
    expect(onSessionEnd).toHaveBeenCalled();
    expect(mockRenderer.dispose).toHaveBeenCalled();
  });
});
