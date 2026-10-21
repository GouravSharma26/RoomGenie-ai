# RoomGenie AI — Augmented Reality (AR) Device Specification & Handoff Contract

**Milestone:** Phase 7 — Real-world AR Placement  
**Document Status:** Locked Engineering Specification  
**Architecture Reference:** [ARCHITECTURE.md Section 10](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/ARCHITECTURE.md#L152) | [MODEL_AND_TECH_DECISIONS.md Section 3](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/MODEL_AND_TECH_DECISIONS.md#L46)

---

## 1. Target Hardware & Operating System Baseline

| Dimension | Specification | Notes |
| :--- | :--- | :--- |
| **Primary Reference Device** | Google Pixel (6 / 7 / 8 series) or Samsung Galaxy (S21 / S22 / S23 / S24 series) | Android devices with certified ARCore hardware calibration. |
| **Operating System** | Android 10.0 (API Level 29) or higher (recommended: Android 13+) | Required for modern WebXR hit-test and plane detection stability. |
| **Primary Browser** | Google Chrome Mobile (version 90+) or Samsung Internet (version 16+) | Full native support for the W3C WebXR Device API and `immersive-ar` session mode. |
| **System Prerequisites** | Google Play Services for AR (ARCore) package installed and camera permissions granted | Pre-installed on certified Android devices; updated via Google Play Store. |
| **Secondary Mobile Fallback** | Apple iPhone (iOS 15.0+ on Safari) | Fallback via AR Quick Look (`rel="ar"`) and USDZ conversion handoff. |
| **Desktop / Non-AR Fallback** | Desktop Chrome, Firefox, Safari, Edge | Explicit capability detection banner, mobile QR-code launcher, and manual 3D preview. |

---

## 2. WebXR Placement & Hit-Testing Architecture

### A. W3C WebXR Session Configuration
RoomGenie AI targets the browser-first WebXR Device API:
- **Session Mode:** `'immersive-ar'`
- **Required Features:** `'hit-test'`, `'local-floor'`
- **Optional Features:** `'light-estimation'`, `'dom-overlay'`

### B. Horizontal Surface & Plane Detection
1. **Hit-Test Source:** A ray is cast from the centre of the mobile device camera viewport into the real-world environment using `XRHitTestSource`.
2. **Floor Reticle:** While scanning, a circular reticle is projected flush with the highest-confidence horizontal surface detected by ARCore.
3. **1:1 Metric Placement:** When the user taps the screen, the selected furniture item is placed at the exact hit-test matrix position:
   - Three.js coordinate convention: $Y$ up, $X/Z$ floor plane.
   - Physical dimensions: SI Metres ($m$) directly matching the room editor transform $(W \times H \times D)$.
   - Floor Alignment Compensation: Geometry bounding box is clamped to floor level ($Y = 0$).
4. **Touch Interactions:**
   - **Single-finger drag:** Repositions the object across the detected floor surface.
   - **Two-finger pinch:** Uniform scale adjustment (0.5× to 2.0× relative to reference dimensions).
   - **Two-finger twist:** Y-axis yaw rotation in radians.

---

## 3. Asset Handoff & Security Boundaries

### A. GLB Standard & Private Authenticated Streaming
- **Canonical Asset Format:** Khronos glTF 2.0 Binary (`.glb`).
- **Catalog Assets:** Public architectural models referenced by asset ID.
- **Photo-to-3D Reconstructions:** Private, authenticated GLB streaming.
  - In WebXR (in-browser session), models are loaded directly from active in-memory blob URLs managed by `reconstructedAssetManager`.
  - No generated models are exposed via unauthenticated public static URLs.

### B. Mobile Device Handoff (QR Code Launcher)
When operating on desktop, users can click **AR Placement** to generate a mobile handoff link with a QR code. The mobile device loads the shared design view, authenticates via session token, and enters WebXR mode seamlessly.

---

## 4. Known Physical & Tracking Limitations

| Limitation | Impact | Mitigation in RoomGenie AI |
| :--- | :--- | :--- |
| **Surface Texture & Low Light** | Monochromatic, featureless surfaces (e.g. solid white tiles, unpatterned carpets) or dark rooms cause optical tracking drift. | Reticle visually indicates surface acquisition state (`Tracking` vs `Searching for surface...`). Advisory prompts user to point camera at textured surfaces. |
| **Scale Estimation Variance** | Optical SLAM sensor noise and camera intrinsic variance can cause $\pm 2\%\text{--}5\%$ scale fluctuation. | Dimensions overlay explicitly displays reference metric measurements $(W \times H \times D\text{ in metres})$; UI explicitly advises that AR is a visualization tool, not a certified structural survey measurement. |
| **Lighting Estimation** | Ambient room light intensity and color temperature may differ from physical shadows. | WebXR directional light matches estimated environmental irradiance; soft shadow base disc grounds the virtual asset. |
| **Unsupported Devices** | Desktop browsers and non-ARCore devices lack required camera/sensor hardware. | Clear capability check banner displayed (`WebXR AR Not Supported`); user receives device diagnostic breakdown and mobile QR launcher without breaking the web 3D editor. |
