# VantaVisionAI V15.0 — Enterprise Interface + Real-Time Vision Intelligence Platform
**Codename:** VANTA NEXUS — Command Center Reconstruction (`V15.0.0`)

## 1. Product Overview & Architecture
VantaVisionAI V15.0 is an enterprise-grade visual intelligence and infrastructure command platform combining:
- **Persistent Left-Sidebar Command Center Architecture**: A responsive enterprise shell (`h-screen overflow-hidden flex flex-col`) featuring a compact Global Top Header (with zero duplicated workspace navigation links), a persistent collapsible Left Navigation Sidebar (`256px` expanded / `72px` collapsed on desktop & tablet, plus an accessible slide-over Mobile Drawer on `<768px`), and an independent scrollable Main Content Workspace.
- **Genuine Model-Driven Real-Time Object Detection Pipeline**: Modular browser-side computer vision inference powered by `@tensorflow/tfjs` and `@tensorflow-models/coco-ssd` (`lite_mobilenet_v2`), featuring a bounded `FrameInferenceScheduler` (`LOW_RESOURCE`, `BALANCED`, `HIGH_PERFORMANCE`), video readiness validation, prediction normalization, configurable confidence & class filtering, class-aware Non-Maximum Suppression (NMS), aspect-ratio-aware canvas overlay coordinate mapping, and multi-frame IoU/centroid object tracking (`TRK-*`).
- **Strict Provenance Separation**: Live model-inferred detections (`REAL_MODEL`) and optional simulated demo overlays (`SIMULATED_DEMO`) are explicitly separated in data structures, UI controls, event generation rules, and Vanta Brain reasoning. Unmeasured metrics truthfully display `N/A` or `NOT CONNECTED`.
- **9-Layer Vanta Brain & Bilingual ALEANA Voice Intelligence**: Permission-checked 25-tool registry, 4-part epistemic breakdown (`[VERIFIED_FACT]`, `[INFERENCE]`, `[PREDICTION]`, `[RECOMMENDATION]`), deterministic detection-to-event rule evaluation with cooldown deduplication, and explicit browser speech capability detection (`SpeechRecognition` & `speechSynthesis`).
- **Tamper-Evident SHA-256 Cryptographic Audit Ledger**: Every state mutation, tool execution, incident transition, device pairing, and workflow action appends a hash-chained SHA-256 audit block.

## 2. Repository Structure
- `/src/App.tsx` — V15.0 Persistent Enterprise Shell (Global Top Header, Collapsible Left Navigation Sidebar, Mobile Slide-Over Drawer, Independent Main Workspace, and 8-Card Command Overview).
- `/src/core/types.ts` — Canonical TypeScript contracts for V15.0 Vision Pipeline (`NormalizedDetection`, `DetectionFilterConfig`, `MeasuredVisionTelemetry`, `DetectionEventRule`), Vanta Brain, Incidents, Devices, and Audit Trail.
- `/src/core/visionPipeline.ts` — Modular Vision AI Provider (`TfjsCocoSsdProvider`), `validateVideoReadiness`, `validateAndNormalizePredictions`, `filterPredictionsByConfig`, `applyNormalizedClassAwareNMS`, `mapBoxToCanvasCoordinates`, `updateCameraObjectTracks`, `FrameInferenceScheduler`, and `evaluateDetectionEventRules`.
- `/src/core/engine.ts` — Canonical state engine, 9-layer Vanta Brain pipeline, 25-tool registry, SHA-256 hash chain verifier, incident state machine, and compound policy evaluator.
- `/src/core/engine.test.ts` — Automated unit and integration test suite (`node:test`) covering V14.0 and V15.0 requirements.
- `/src/components/CameraWorkspace.tsx` — Preserved WebRTC `getUserMedia` camera lifecycle + real TensorFlow.js COCO-SSD inference engine, canvas bounding-box overlay, performance profile selector, class/confidence filters, and truthful telemetry HUD.
- `/src/components/BrainAndAleanaWorkspace.tsx` — 9-Layer Vanta Brain console, 25-tool executor, bilingual ALEANA voice HUD with capability disclosure, and autonomous workflow approval boundary.
- `/src/components/OperationsAndPoliciesWorkspace.tsx` — Incident state machine, 9-stage event correlation pipeline, and compound policy rule evaluator.
- `/src/components/MultiDeviceAndTwinWorkspace.tsx` — Multi-device QR pairing & Digital Twin zone replay.
- `/src/components/AuditAndBlueprintWorkspace.tsx` — SHA-256 audit chain verifier & forensic system blueprint.
- `/server.ts` — Express API + Vite middleware server with real-time Server-Sent Events (`/api/sync/stream`) and persistent state hydration.
- `/.backup-v14/` — Complete pre-V15.0 source backup and `BASELINE_SHA256.txt` checksum manifest.

## 3. Setup, Verification & Testing
```bash
# Run unit and integration test suite (15 test suites covering V14 + V15.0)
npx tsx --test src/core/engine.test.ts

# Type-check codebase
npm run lint

# Build production bundle
npm run build

# Start full-stack Express + Vite server on port 3000
npm run dev
```
