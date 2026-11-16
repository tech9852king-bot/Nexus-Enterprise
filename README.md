# VantaVisionAI V11.0 — Vanta Nexus Intelligent Command Center

## 1. Product Overview & Vision
**VantaVisionAI (Codename: Vanta Nexus, Version 11.0.0)** is an AI-First Security & Infrastructure Intelligence Operating System connecting physical facility zones, computer vision camera endpoints, cross-platform devices, operational incident workflows, Digital Twin representations, the **9-Layer Vanta Brain reasoning engine**, and the **ALEANA bilingual voice intelligence system**.

## 2. Truthful Capability Classification & Readiness Matrix

| Capability Module | Status | Readiness Level | Evidence & Implementation |
| :--- | :--- | :--- | :--- |
| **Vanta Command Center UI & Design System** | `VERIFIED` | Level 4 — Integration Verified | `src/App.tsx`, `src/index.css` (`Plus Jakarta Sans` + `JetBrains Mono`, Dual-Theme `@custom-variant dark`) |
| **Vanta Brain (9-Layer Intelligence Engine)** | `VERIFIED` | Level 4 — Integration Verified | `src/core/engine.ts` (`runNineLayerBrainPipeline`) + `server.ts` (`gemini-4-hydrogen` server-side synthesis) |
| **25-Tool Governed Brain Ecosystem** | `TESTED` | Level 4 — Integration Verified | `BRAIN_TOOLS_REGISTRY` (25 typed tools with RBAC & SHA-256 audit logging) |
| **ALEANA Bilingual Voice System** | `VERIFIED` | Level 4 — Integration Verified | `src/components/BrainAndAleanaWorkspace.tsx` (English, हिन्दी, Hinglish, Barge-In interruption, Web Speech API) |
| **Camera Command & Vision Workspace** | `VERIFIED` | Level 4 — Integration Verified | `src/components/CameraWorkspace.tsx` (1/2/4/6/9 matrix layouts, authorized local webcam + labeled simulated telemetry) |
| **Multi-Device Cloud Sync & QR Pairing** | `VERIFIED` | Level 4 — Integration Verified | `server.ts` (`/api/sync/stream` SSE broadcaster, short-lived QR pairing tokens) |
| **Incident State Machine & Policy Engine** | `TESTED` | Level 4 — Integration Verified | `src/core/engine.ts` (`validateIncidentTransition`, `evaluateCompoundPolicyRule`) |
| **Operational Digital Twin & Forensic Replay** | `VERIFIED` | Level 4 — Integration Verified | `src/components/MultiDeviceAndTwinWorkspace.tsx` (Live spatial graph + metadata timeline scrubber) |
| **Cryptographic SHA-256 Audit Ledger** | `TESTED` | Level 5 — Release Candidate | `sha256Hex`, `verifyAuditChain` verified via `node:test` in `src/core/engine.test.ts` |

## 3. Real vs. Simulated Data Disclosure
- **Simulated Telemetry Feeds**: Pre-configured facility cameras (`CAM-01` through `CAM-04`) are explicitly labeled `SIMULATED TELEMETRY STREAM` and render deterministic 640px bounding-box and zone overlays.
- **Measured Live Webcam Feed**: Operators can click **Authorize Local Webcam** in the Camera Workspace to bind a real browser `MediaStream` (`navigator.mediaDevices.getUserMedia`), which switches provenance to `MEASURED`.
- **Forensic Metadata Replay**: The Forensic Scrubber replays structured detection counts and throughput checkpoints; it explicitly discloses that metadata replay does not reconstruct raw video.
- **Zero-Biometric Privacy Guarantee**: Facial recognition and cross-camera biometric identity matching are strictly prohibited and absent.

## 4. Architecture & Technology Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Lucide Icons.
- **Backend**: Node.js + Express (`server.ts`) running via `tsx`, serving REST endpoints (`/api/*`), Server-Sent Events (`/api/sync/stream`) for real-time multi-device cloud synchronization, and server-side `@google/genai` (`gemini-4-hydrogen`).
- **Persistence**: Atomic JSON state persistence (`.vanta-state.json`) with SHA-256 cryptographic audit chain verification.

## 5. Local Setup, Execution & Testing
```bash
# Install dependencies
npm install

# Run fast-feedback unit tests (node:test via tsx)
npx --yes tsx --test src/core/engine.test.ts

# Start full-stack server + Vite on port 3000
npm run dev

# Type-check & production build
npm run lint
npm run build
```

## 6. Environment Variables (`.env.example`)
- `GEMINI_API_KEY`: Server-side API key for `@google/genai` (`gemini-4-hydrogen`). Never exposed to client code.
- `APP_URL`: Runtime service URL.
