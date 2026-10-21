import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkArCapability,
  generateSceneViewerIntentUrl,
  generateMobileHandoffUrl,
  clampArPlacement,
  AR_LIMITATIONS,
  type ArPlacementTransform,
} from './arService';

describe('arService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkArCapability', () => {
    it('detects desktop environment when no mobile user agent is present and WebXR is absent', async () => {
      const desktopUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
      const result = await checkArCapability(desktopUa);

      expect(result.deviceCategory).toBe('desktop');
      expect(result.isWebXrSupported).toBe(false);
      expect(result.isSceneViewerSupported).toBe(false);
      expect(result.isQuickLookSupported).toBe(false);
      expect(result.recommendation).toBe('mobile-handoff');
      expect(result.statusTitle).toContain('Desktop');
      expect(result.limitations.tracking).toBe(AR_LIMITATIONS.tracking);
    });

    it('detects Android ARCore device with Scene Viewer support', async () => {
      const androidUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
      const result = await checkArCapability(androidUa);

      expect(result.deviceCategory).toBe('android-arcore');
      expect(result.isSceneViewerSupported).toBe(true);
      expect(result.recommendation).toBe('scene-viewer');
      expect(result.statusTitle).toContain('Google Scene Viewer');
    });

    it('detects iOS AR device with Quick Look support', async () => {
      const iosUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      const result = await checkArCapability(iosUa);

      expect(result.deviceCategory).toBe('ios-ar');
      expect(result.isQuickLookSupported).toBe(true);
      expect(result.recommendation).toBe('quick-look');
      expect(result.statusTitle).toContain('Apple AR Quick Look');
    });

    it('detects WebXR support when navigator.xr reports immersive-ar capability', async () => {
      const isSessionSupportedMock = vi.fn().mockResolvedValue(true);
      const originalXr = (navigator as unknown as { xr?: unknown }).xr;

      Object.defineProperty(navigator, 'xr', {
        value: { isSessionSupported: isSessionSupportedMock },
        configurable: true,
      });

      const androidUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
      const result = await checkArCapability(androidUa);

      expect(result.isWebXrSupported).toBe(true);
      expect(result.recommendation).toBe('webxr');
      expect(result.statusTitle).toContain('WebXR Immersive-AR');

      // Cleanup
      Object.defineProperty(navigator, 'xr', {
        value: originalXr,
        configurable: true,
      });
    });

    it('handles WebXR rejection safely without throwing', async () => {
      const isSessionSupportedMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
      const originalXr = (navigator as unknown as { xr?: unknown }).xr;

      Object.defineProperty(navigator, 'xr', {
        value: { isSessionSupported: isSessionSupportedMock },
        configurable: true,
      });

      const result = await checkArCapability();
      expect(result.isWebXrSupported).toBe(false);

      Object.defineProperty(navigator, 'xr', {
        value: originalXr,
        configurable: true,
      });
    });
  });

  describe('generateSceneViewerIntentUrl', () => {
    it('constructs well-formed Android intent URL with encoded parameters', () => {
      const modelUrl = 'https://roomgenie.example.com/models/armchair.glb';
      const title = 'Modern Velvet Armchair';
      const intentUrl = generateSceneViewerIntentUrl(modelUrl, title);

      expect(intentUrl).toContain('intent://arvr.google.com/scene-viewer/1.0?file=');
      expect(intentUrl).toContain(encodeURIComponent(modelUrl));
      expect(intentUrl).toContain(encodeURIComponent(title));
      expect(intentUrl).toContain('mode=ar_preferred');
      expect(intentUrl).toContain('com.google.android.googlequicksearchbox');
    });

    it('includes optional fallback link if provided', () => {
      const modelUrl = 'https://roomgenie.example.com/models/armchair.glb';
      const title = 'Armchair';
      const fallback = 'https://roomgenie.example.com/designs/123';
      const intentUrl = generateSceneViewerIntentUrl(modelUrl, title, fallback);

      expect(intentUrl).toContain(`&link=${encodeURIComponent(fallback)}`);
    });
  });

  describe('generateMobileHandoffUrl', () => {
    it('generates mobile URL with ar=true flag and optional designId and assetId', () => {
      const url = generateMobileHandoffUrl({
        designId: 'design-uuid-456',
        selectedAssetId: 'custom-sofa',
        baseUrl: 'https://roomgenie.local',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('ar')).toBe('true');
      expect(parsed.searchParams.get('designId')).toBe('design-uuid-456');
      expect(parsed.searchParams.get('assetId')).toBe('custom-sofa');
    });

    it('defaults cleanly when no options are provided', () => {
      const url = generateMobileHandoffUrl({ baseUrl: 'http://localhost:5173' });
      const parsed = new URL(url);
      expect(parsed.searchParams.get('ar')).toBe('true');
      expect(parsed.searchParams.has('designId')).toBe(false);
    });
  });

  describe('clampArPlacement', () => {
    it('grounds Y coordinate flush to detected surface level (0)', () => {
      const initial: ArPlacementTransform = {
        position: [1.2, 0.5, -2.0],
        rotationY: 0,
        scale: 1.0,
        surfaceDetected: true,
      };

      const clamped = clampArPlacement(initial, { position: [1.5, 3.4, -1.8] });
      expect(clamped.position[0]).toBe(1.5);
      expect(clamped.position[1]).toBe(0); // Clamped to 0
      expect(clamped.position[2]).toBe(-1.8);
    });

    it('clamps scale within safe [0.5, 2.0] physical bounds', () => {
      const initial: ArPlacementTransform = {
        position: [0, 0, 0],
        rotationY: 0,
        scale: 1.0,
        surfaceDetected: true,
      };

      expect(clampArPlacement(initial, { scale: 0.1 }).scale).toBe(0.5);
      expect(clampArPlacement(initial, { scale: 5.0 }).scale).toBe(2.0);
      expect(clampArPlacement(initial, { scale: 1.25 }).scale).toBe(1.25);
    });

    it('normalizes rotation within [0, 2*PI)', () => {
      const initial: ArPlacementTransform = {
        position: [0, 0, 0],
        rotationY: 0,
        scale: 1.0,
        surfaceDetected: true,
      };

      const clampedOver = clampArPlacement(initial, { rotationY: 2.5 * Math.PI });
      expect(clampedOver.rotationY).toBeCloseTo(0.5 * Math.PI, 4);

      const clampedNegative = clampArPlacement(initial, { rotationY: -0.5 * Math.PI });
      expect(clampedNegative.rotationY).toBeCloseTo(1.5 * Math.PI, 4);
    });
  });
});
