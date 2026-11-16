# VantaVisionAI V11.0 — System & Intelligence Architecture (`ARCHITECTURE.md`)

## 1. Domain Boundaries & Canonical Authority
VantaVisionAI V11.0 enforces a single canonical backend (`server.ts`) paired with a shared, pure domain core (`src/core/types.ts` and `src/core/engine.ts`):

1. **Presentation Layer (`src/App.tsx`, `src/components/*`)**:
   - Enforces the 3-Zone Top Bar Contract, independent vertical scrolling sidebar, Dual-Theme (`@custom-variant dark`), and tabular numeral discipline (`font-mono tabular-nums`).
2. **Real-Time Cloud Synchronization (`/api/sync/stream`)**:
   - Server-Sent Events broadcast every state revision (`syncRevision`) across connected desktop, tablet, and mobile clients instantaneously.
3. **Vanta Brain 9-Layer Control Plane (`runNineLayerBrainPipeline`)**:
   - Layer 1: Intent Intelligence (Query + Language Detection: `en`, `hi`, `hinglish`)
   - Layer 2: Context Intelligence (Tenant & Site Isolation)
   - Layer 3: Data Intelligence (Canonical State Retrieval)
   - Layer 4: Vision Intelligence (640px Non-Biometric Telemetry Assessment)
   - Layer 5: Temporal Intelligence (Event Sequence Correlation)
   - Layer 6: Policy & Risk Intelligence (Explainable Threshold Evaluation)
   - Layer 7: Reasoning & Orchestration (25-Tool Registry Execution)
   - Layer 8: Explanation Intelligence (Provenance & Uncertainty Separation)
   - Layer 9: Governance Intelligence (RBAC Enforcement & SHA-256 Audit Block Appending)
4. **ALEANA Bilingual Voice System**:
   - Shares `CONV-PRIMARY` context and tool registry with Vanta Brain.
   - Supports Push-to-Talk, Barge-In interruption (`speechSynthesis.cancel()`), and English / Hindi / Hinglish responses.
5. **Cryptographic Audit Ledger (`sha256Hex`, `verifyAuditChain`)**:
   - Every state transition and tool invocation records `previousHash` and `recordHash` using FIPS 180-4 SHA-256.
