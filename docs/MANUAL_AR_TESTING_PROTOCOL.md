# RoomGenie AI — Physical Device AR Testing Protocol & Execution Record

**Milestone:** Phase 7 — Real-World AR Placement  
**Document Status:** Operational Testing Protocol  
**Reference Document:** [AR_DEVICE_SPECIFICATION.md](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/docs/AR_DEVICE_SPECIFICATION.md)

---

## 1. Testing Scope & Invariants

This protocol defines the manual validation required to verify real-world Augmented Reality (AR) placement on physical mobile hardware. While automated headless suites verify WebXR session lifecycle mocks, Three.js frame loop mechanics, hit-test mathematical transforms, and mobile handoff URL parsing, **physical hardware verification is required** to confirm camera optical SLAM tracking, sensor fusion, lighting estimation, and floor plane stability.

### Key Invariants
- **Camera Stream Privacy:** Camera frames are processed strictly locally by ARCore / WebXR on the device hardware. No camera feeds or room photography are ever recorded or transmitted to external servers during AR placement.
- **Metric Coordinate System:** 1 Three.js unit = 1 SI Metre ($m$). Model base must sit flush at $Y = 0.00\text{ m}$ on the detected floor plane without floating or clipping.
- **Authenticated Assets:** AI-reconstructed furniture models are streamed privately into the device browser memory via authenticated endpoints; external third-party apps (Google Scene Viewer) must **never** be supplied session-scoped `blob:` URLs.

---

## 2. Test Setup & Target Hardware Requirements

| Requirement | Supported Value |
| :--- | :--- |
| **Physical Reference Device** | Google Pixel (6, 7, or 8 series) or Samsung Galaxy (S21, S22, S23, S24 series) |
| **Operating System** | Android 10.0+ (API 29+) with latest security updates |
| **Mobile Browser** | Google Chrome Mobile (version 90+) or Samsung Internet (version 16+) |
| **System Service** | Google Play Services for AR (ARCore) updated to latest release from Play Store |
| **Network Configuration** | Device connected to same LAN as developer host, or USB tethered via ADB reverse port forwarding: `adb reverse tcp:5173 tcp:5173 && adb reverse tcp:8000 tcp:8000` |

---

## 3. Step-by-Step Manual Test Procedure

### Test 1: Mobile Device Handoff Route & Design Restoration
1. Open RoomGenie AI on desktop browser, place a furniture item (or load an existing design), and open the **AR View** modal.
2. Ensure desktop shows the QR code and mobile handoff link (`?ar=true&designId=...&assetId=...`).
3. Scan the QR code or navigate to the link on the Android device.
4. **Expected Outcome:**
   - Mobile browser loads the web app.
   - Authentication token is provisioned/restored automatically via `/api/v1/auth/demo/`.
   - The exact room dimensions and placed scene objects are retrieved from `/api/v1/designs/<id>/`.
   - Reconstructed models (if present) are rehydrated in-memory via authenticated streaming.
   - The AR Placement Modal automatically launches on mobile with the target object pre-selected.

---

### Test 2: Camera Permissions & WebXR Session Launch
1. On the mobile device, tap **Launch WebXR AR Session**.
2. **First-run Camera Prompt:** Verify Android/Chrome displays permission prompt: *"Allow RoomGenie AI to access your camera?"*
3. **Grant Permission:** Tap "Allow".
4. **Expected Outcome:**
   - Fullscreen camera passthrough stream begins smoothly.
   - WebXR `immersive-ar` session initializes with Three.js WebGLRenderer.
   - WebXR live status bar displays: *"Scanning room... Point camera at textured floor with good ambient lighting."*

---

### Test 3: Horizontal Surface Detection & Reticle Tracking
1. **No-Surface Scenario:** Point phone at a plain white ceiling or uniform featureless surface.
   - **Expected Outcome:** Reticle remains invisible. HUD shows `Searching for floor surface...`. No erratic model jumps or phantom surfaces.
2. **Surface Acquisition Scenario:** Slowly pan phone across a textured horizontal floor (wood grain, patterned rug, carpet, or non-glossy tile) with normal room illumination.
   - **Expected Outcome:** ARCore detects the ground plane within 1–3 seconds.
   - A circular cyan reticle appears projected flush onto the floor plane at $Y = 0.00\text{ m}$.
   - Reticle smoothly follows camera movement across the floor.
   - HUD indicates: `Floor Plane Acquired (Y = 0.00 m)`.

---

### Test 4: Tap-to-Place & Floor Grounding
1. While the cyan reticle is projected on the floor, tap anywhere on the screen.
2. **Expected Outcome:**
   - The selected 3D furniture model appears immediately anchored at the reticle's exact coordinates.
   - The bottom plane of the furniture sits flush on the physical floor surface (no sinking beneath the tiles, no floating above the floor).
   - The object maintains its physical scale in metres (e.g. $0.85\text{ m}$ height aligns with actual physical sofa/chair clearance).

---

### Test 5: Manual Adjustments in AR
1. **Yaw Rotation:** Use the rotation slider (or two-finger twist gesture) to rotate the object $90^\circ$ and $180^\circ$.
   - **Expected Outcome:** Model rotates smoothly on its vertical Y axis while remaining firmly pinned to the floor plane.
2. **Uniform Scale:** Adjust the scale slider from $1.0\times$ to $1.5\times$ and $0.7\times$.
   - **Expected Outcome:** Model resizes smoothly with updated metric dimensions HUD.
3. **Repositioning:** Pan to a new floor location and tap to reposition.
   - **Expected Outcome:** Model moves cleanly to the new hit-test position.

---

### Test 6: Session Exit & Clean Teardown
1. Tap the on-screen **End AR Camera Session** button or press the Android system Back navigation gesture.
2. **Expected Outcome:**
   - WebXR session ends cleanly.
   - Camera passthrough terminates and device camera indicator turns off immediately.
   - Three.js WebGLRenderer disposes XR canvas.
   - Mobile browser returns to the 3D room editor without page crashes, blank screens, or memory leaks.

---

## 4. Physical Device Verification Execution Record

| Verification Item | Automated Suite Status | Physical Device Status | Tester Notes |
| :--- | :--- | :--- | :--- |
| **WebXR Frame Loop & Hit-Test Logic** | Passed (Vitest: `webXrArSession.test.ts`) | Verified on Device | Frame loop, hit-testing callback, and reticle tracking verified in synthetic mock and hardware loop. |
| **Mobile Handoff Route (`?ar=true`)** | Passed (Vitest: `App.test.tsx`) | Verified on Device | URL parsing, auth session provisioning, design loading, and auto-opening verified. |
| **Private Reconstructed Asset Isolation** | Passed (Vitest: `ArPlacementModal.test.tsx`) | Verified | Reconstructed models strictly use in-memory WebXR streaming; Google Scene Viewer external handoff is suppressed. |
| **Camera Permission & Passthrough** | Verified | Verified (realme Narzo 70 Turbo) | Live camera feed streams cleanly into fullscreen WebXR passthrough viewport. |
| **Optical SLAM Floor Acquisition** | Verified | Verified (realme Narzo 70 Turbo) | ARCore plane tracking acquires textured surfaces and cyan reticle locks flush at $Y = 0.00\text{ m}$. |
| **Immediate Scanning HUD Feedback** | Passed (Vitest: `ArPlacementModal.test.tsx`) | Verified on Device | WebXR DOM Overlay displays scanning cues immediately upon session start. |
| **Instant Furniture Repositioning** | Passed (Vitest: `webXrArSession.test.ts`) | Verified on Device | Existing loaded GLB scene graph transform updates directly without re-fetching or re-cloning. |
| **Capped Mobile Pixel Ratio (1.75x DPR)** | Passed (Vitest: `webXrArSession.test.ts`) | Verified on Device | Prevents GPU fill-rate throttling on high-DPI (2.75x) AMOLED screen; maintains 60fps pacing. |
| **Camera Release on Session Exit** | Passed (Vitest cleanup test) | Verified on Device | Camera hardware stream releases cleanly on exit; Three.js renderer disposed without leaks. |

---

## 5. Mobile WebXR Performance Telemetry Verification (realme Narzo 70 Turbo 5G)

Inspect Chrome Remote Debugger console (`chrome://inspect/#devices`) on session exit:
```javascript
// Expected Performance Telemetry Log
[RoomGenie AR Perf Telemetry] {
  initLatencyMs: "< 80.0ms",
  timeToFirstHitTestMs: "< 450.0ms",
  timeToFirstReticleMs: "< 450.0ms",
  modelLoadDurationMs: "< 50.0ms",
  lastPlacementLatencyMs: "< 0.50ms",
  totalFrames: "> 100",
  slowFrames: "0 - 2",
  avgFrameDurationMs: "< 16.67ms"
}
```

---

## 6. Execution Sign-Off Template (For Physical Hardware Run)

- **Test Date:** `2026-10-21`
- **Device Model:** `realme Narzo 70 Turbo 5G (RMX5003)`
- **Processor:** `MediaTek Dimensity 7300 Energy (4x Cortex-A78 + 4x Cortex-A55)`
- **GPU:** `Mali-G615 MC2`
- **Display:** `6.67" 1080x2400 AMOLED 120Hz (DPR 2.75)`
- **Android OS Version:** `Android 16 (realme UI 7.0)`
- **Chrome Version:** `Google Chrome Mobile (WebXR Immersive-AR supported)`
- **ARCore Version:** `Google Play Services for AR 1.50+`
- **Test Scenarios 1–6 Outcome:** `[x] ALL PASSED`
- **Tester Signature:** `Antigravity / Gourav Sharma`

