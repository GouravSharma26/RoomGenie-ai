/**
 * Augmented Reality (AR) Service & Device Capability Detection
 * 
 * Provides:
 * 1. WebXR 'immersive-ar' feature detection and device categorization (Android ARCore, iOS, Desktop).
 * 2. Scene Viewer intent URL generation for ARCore fallback.
 * 3. Mobile device handoff URL generation.
 * 4. Tracking, scale, and lighting limitation guidelines for user guidance.
 * 5. Safe WebXR session lifecycle management without breaking desktop/test environments.
 */

export interface ArLimitations {
  tracking: string;
  scale: string;
  lighting: string;
}

export type DeviceCategory = 'android-arcore' | 'ios-ar' | 'desktop' | 'unsupported';
export type ArRecommendation = 'webxr' | 'scene-viewer' | 'quick-look' | 'mobile-handoff';

export interface ArCapabilityResult {
  isWebXrSupported: boolean;
  isSceneViewerSupported: boolean;
  isQuickLookSupported: boolean;
  deviceCategory: DeviceCategory;
  recommendation: ArRecommendation;
  statusTitle: string;
  statusDescription: string;
  limitations: ArLimitations;
}

export interface ArPlacementTransform {
  position: [number, number, number]; // [x, y, z] in metres
  rotationY: number; // in radians
  scale: number; // uniform scale multiplier (0.5 to 2.0)
  surfaceDetected: boolean;
}

export const AR_LIMITATIONS: ArLimitations = {
  tracking:
    'Optical SLAM visual-inertial odometry requires textured, non-reflective surfaces and ambient lighting. Featureless white floors, high-gloss marble, or dim environments cause drift or loss of tracking.',
  scale:
    'ARCore and ARKit spatial surface estimation operates within an expected ±2% to 5% metric variance. Virtual placements provide spatial context and clearance preview, not structural survey measurements.',
  lighting:
    'Real-time light estimation approximates ambient irradiance and primary directional light, but secondary reflections, inter-object bounce, and localized physical shadows remain simulated approximations.',
};

/**
 * Evaluates browser and hardware support for Augmented Reality.
 * Can accept an optional custom userAgent for deterministic testing.
 */
export async function checkArCapability(userAgentOverride?: string): Promise<ArCapabilityResult> {
  const ua = userAgentOverride ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const isAndroid = /Android/i.test(ua);
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isDesktop = !isAndroid && !isIos;

  let isWebXrSupported = false;

  // Check WebXR Device API if present
  if (typeof navigator !== 'undefined' && 'xr' in navigator && navigator.xr?.isSessionSupported) {
    try {
      isWebXrSupported = await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      isWebXrSupported = false;
    }
  }

  // Scene Viewer is supported on Android devices with ARCore / Google Search app
  const isSceneViewerSupported = isAndroid && /Chrome|SamsungBrowser/i.test(ua);

  // Quick Look is supported on iOS Safari
  const isQuickLookSupported = isIos;

  let deviceCategory: DeviceCategory = 'unsupported';
  if (isAndroid) deviceCategory = 'android-arcore';
  else if (isIos) deviceCategory = 'ios-ar';
  else if (isDesktop) deviceCategory = 'desktop';

  let recommendation: ArRecommendation = 'mobile-handoff';
  let statusTitle = 'Desktop Browser (Non-AR Hardware)';
  let statusDescription =
    'Your current desktop environment lacks spatial camera sensors and SLAM tracking. Use the QR code below to transfer this session to a compatible Android or iOS smartphone.';

  if (isWebXrSupported) {
    recommendation = 'webxr';
    statusTitle = 'WebXR Immersive-AR Supported';
    statusDescription =
      'Native W3C WebXR immersive-ar session available. You can launch real-time camera hit-testing directly inside this browser window.';
  } else if (isSceneViewerSupported) {
    recommendation = 'scene-viewer';
    statusTitle = 'Google Scene Viewer Compatible';
    statusDescription =
      'ARCore-compatible Android device detected. You can launch Google Scene Viewer or scan your room surface.';
  } else if (isQuickLookSupported) {
    recommendation = 'quick-look';
    statusTitle = 'Apple AR Quick Look Compatible';
    statusDescription =
      'iOS ARKit device detected. Models can be previewed via AR Quick Look or transferred to an Android reference device for native WebXR.';
  }

  return {
    isWebXrSupported,
    isSceneViewerSupported,
    isQuickLookSupported,
    deviceCategory,
    recommendation,
    statusTitle,
    statusDescription,
    limitations: AR_LIMITATIONS,
  };
}

/**
 * Builds a Google Scene Viewer intent URL for Android devices.
 * Uses ar_preferred mode and references the model file.
 */
export function generateSceneViewerIntentUrl(
  modelUrl: string,
  title: string,
  fallbackUrl?: string
): string {
  const encodedModel = encodeURIComponent(modelUrl);
  const encodedTitle = encodeURIComponent(title);
  const fallbackParam = fallbackUrl ? `&link=${encodeURIComponent(fallbackUrl)}` : '';

  return `intent://arvr.google.com/scene-viewer/1.0?file=${encodedModel}&title=${encodedTitle}&mode=ar_preferred${fallbackParam}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;end;`;
}

/**
 * Generates a mobile handoff URL for transferring the 3D room session
 * to a compatible smartphone via QR code.
 */
export function generateMobileHandoffUrl(options?: {
  designId?: string | null;
  selectedAssetId?: string | null;
  baseUrl?: string;
}): string {
  let origin = 'http://localhost:5173';
  if (typeof window !== 'undefined' && window.location?.origin) {
    origin = window.location.origin;
  }
  const base = options?.baseUrl || origin;
  const url = new URL(base);
  url.searchParams.set('ar', 'true');

  if (options?.designId) {
    url.searchParams.set('designId', options.designId);
  }
  if (options?.selectedAssetId) {
    url.searchParams.set('assetId', options.selectedAssetId);
  }

  return url.toString();
}

/**
 * Clamps and validates AR placement adjustments.
 * Ensures the object stays grounded flush with the detected surface (Y = 0)
 * and maintains scale within realistic physical limits [0.5x, 2.0x].
 */
export function clampArPlacement(
  current: ArPlacementTransform,
  updates: Partial<ArPlacementTransform>
): ArPlacementTransform {
  const nextScale = updates.scale !== undefined
    ? Math.max(0.5, Math.min(2.0, updates.scale))
    : current.scale;

  // Normalize rotation between 0 and 2*PI
  let nextRotation = updates.rotationY !== undefined ? updates.rotationY : current.rotationY;
  const twoPi = 2 * Math.PI;
  nextRotation = ((nextRotation % twoPi) + twoPi) % twoPi;

  const nextPos: [number, number, number] = [
    updates.position ? updates.position[0] : current.position[0],
    0, // Clamped to detected surface floor plane
    updates.position ? updates.position[2] : current.position[2],
  ];

  return {
    position: nextPos,
    rotationY: nextRotation,
    scale: nextScale,
    surfaceDetected: updates.surfaceDetected ?? current.surfaceDetected,
  };
}
