# VantaVisionAI V14.0 — Phase Zero Deep Forensic Source Audit & Non-Regression Register

## 1. Baseline Cryptographic Checkpoint (Pre-V14 Transformation)
All baseline source files were inspected and hashed via `sha256sum` prior to V14.0 modular expansion:

| File Path | Baseline SHA-256 Hash | Baseline Role |
| :--- | :--- | :--- |
| `package.json` | `f434af1e8750f5b51f1f2549c1d8d11c5a454c998a83094e53556cf7d1d0fc7a` | Dependencies & scripts (`tsx server.ts`, `node:test`) |
| `server.ts` | `c394739d6deb6be856d9028c1319d27274416a2d8c20d6633f012490b95cbe1d` | Canonical Express + SSE + Gemini 4 backend |
| `src/App.tsx` | `ab8560690cfa208e8e1a1e228cdafc2b1d3b6096dbad37134fcc57fae6b35795` | Command Center shell, 3-zone header, sidebar, SSE client |
| `src/core/types.ts` | `eb9e017c366231df192f84b00b8c9e8814933acf064a8460760e16db825b2524` | Shared TypeScript contracts |
| `src/core/engine.ts` | `2329223761b54f1be5abb3a55a405dc4e84ead1506ecf3b039bbd902d443c244` | SHA-256 audit chain, state machine, 25 tools, 9-layer Brain |
| `src/core/engine.test.ts` | `4099e09c63d0fc8ea672ef62cfc76f75a65ed6f8704e74a64e4addbec9be23f9` | Node test suite (6 core suites) |
| `src/components/CameraWorkspace.tsx` | `dc104942550c354937bec243f6b0a74b25b2efd4ccecc8adfbfe127d06c24826` | Camera grid, `getUserMedia`, `videoRef`, `streamRef`, `canvasRef` |
| `src/components/BrainAndAleanaWorkspace.tsx` | `737820b8a3e1fcb141938ce707c13a956be04c226c7f033128dc96ea70491555` | Vanta Brain, 25 tools UI, ALEANA bilingual voice HUD |
| `src/components/OperationsAndPoliciesWorkspace.tsx` | `7cf6b7331d71e766f56af80258f80c5c839f1381f82eacac8f7a18f132e44f83` | Incidents state machine, policy engine & simulator, event stream |
| `src/components/MultiDeviceAndTwinWorkspace.tsx` | `97e3caee103e00b275bc69deb897f236f9c0b30d1f13a1f910dc48249ecc9cc2` | Fleet QR pairing, Digital Twin spatial SVG, Forensic scrubber |
| `src/components/AuditAndBlueprintWorkspace.tsx` | `7fbab649bc53b87c3fc3231c6fdfa26f3099a32ad8ad13d5dca49085f2ba4609` | SHA-256 audit table & Phase 0 capability matrix |

---

## 2. Forensic Capability Classification (Pre-V14 vs. V14 Target)

| Capability Domain | Pre-V14 Classification | Forensic Evidence | V14.0 Evolution Target |
| :--- | :--- | :--- | :--- |
| **Camera Stream Lifecycle (`getUserMedia`)** | `Fully implemented` | `CameraWorkspace.tsx` (`videoRef`, `streamRef`, `canvasRef`, 1/2/4/6/9 grid) | **Strictly Preserved** + extended with Focus Mode, Model Readiness diagnostics, and non-blocking Vision 2.0 overlays. |
| **Vision Intelligence & Object Tracking** | `Partially implemented / Simulated` | Static bounding boxes with sinusoidal offset; lacked IoU/Centroid tracker & NMS | **Upgraded to Vision 2.0**: Class-aware NMS (`applyClassAwareNMS`), Centroid + IoU object tracking (`updateObjectTracks`), velocity/direction vectors, and structured Scene Summaries. |
| **9-Stage Event Correlation Pipeline** | `Partially implemented` | Direct camera telemetry -> event creation without deduplication/cooldown stages | **Upgraded to 9-Stage Correlation Pipeline**: `Vision Metadata → Detection → Track → Motion → Zone → Correlation → Policy → Incident Candidate → Workflow` with cooldown deduplication. |
| **Vanta Brain 9-Layer & 25-Tool Registry** | `Fully implemented` | `engine.ts` (`BRAIN_TOOLS_REGISTRY`, `runNineLayerBrainPipeline`) + `server.ts` (`gemini-4-hydrogen`) | **Upgraded to Brain 3.0 & Copilot 3.0**: Bounded execution planner, explicit epistemic evidence breakdown (`Verified Fact`, `Calculated Value`, `Estimate`, `Model Interpretation`), and Memory Governance. |
| **ALEANA Bilingual Voice System** | `Fully implemented` | `BrainAndAleanaWorkspace.tsx` (Web Speech API + Hinglish/Hindi/English + Barge-in) | **Upgraded to ALEANA 3.0**: Provider-independent voice diagnostics, stale-response cancellation guard, and voice latency tracking. |
| **Autonomous Workflow Engine** | `Missing` | Individual tools existed, but multi-step approval-gated workflows were absent | **Implemented in V14.0**: 4 multi-step Autonomous Workflows with Human Approval Boundary for consequential actions. |
| **System Observability & Data Governance** | `Partially implemented` | Basic FPS/latency metrics; lacked correlation IDs, frame-skip counters, and retention matrix | **Implemented in V14.0**: Unified Observability & Diagnostics layer + explicit Data Governance & Privacy retention controls. |

---

## 3. Non-Regression Feature-Preservation Register (Section 2)

| ID | Feature Name | Source File | Preserved Elements & Contracts | Regression Verification |
| :--- | :--- | :--- | :--- | :--- |
| `NR-01` | Camera Stream & Lifecycle | `src/components/CameraWorkspace.tsx` | `getUserMedia`, `videoRef`, `streamRef`, `canvasRef`, `startAuthorizedWebcam`, `stopWebcam`, 1/2/4/6/9 grid, fullscreen toggle | Verified via DOM & screenshot inspection |
| `NR-02` | SHA-256 Audit Ledger | `src/core/engine.ts` | `sha256Hex`, `computeAuditRecordHash`, `appendAuditRecord`, `verifyAuditChain` | Verified via `node:test` (`engine.test.ts`) |
| `NR-03` | Incident State Machine | `src/core/engine.ts` | `validateIncidentTransition`, `transitionIncidentState` (`OPEN → INVESTIGATING → CONTAINED → RESOLVED`) | Verified via `node:test` (`engine.test.ts`) |
| `NR-04` | 25-Tool Brain Registry | `src/core/engine.ts` | All 25 tool definitions (`T01`–`T25`) and `executeBrainTool` RBAC enforcement | Verified via `node:test` (`engine.test.ts`) |
| `NR-05` | Real-Time SSE Cloud Sync | `server.ts` & `src/App.tsx` | `/api/sync/stream` EventSource broadcasting `syncRevision` | Verified in browser (`CLOUD SYNC: LIVE SSE STREAM`) |
| `NR-06` | Multi-Device QR Pairing | `src/core/engine.ts` | `createDevicePairingSession` & `/api/devices/pair` | Verified via `node:test` & UI |
| `NR-07` | Digital Twin & Forensic Scrubber | `src/components/MultiDeviceAndTwinWorkspace.tsx` | `viewBox="0 0 200 100"` spatial map, occupancy multiplier, 12-window scrubber | Verified in Chromium (`1440x900` & `390x844`) |
