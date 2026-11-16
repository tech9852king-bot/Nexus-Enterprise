import React, { useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  FileCode2,
  Lock,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { verifyAuditChain } from '../core/engine';
import { FeatureStatus, VantaSystemState } from '../core/types';

interface AuditAndBlueprintWorkspaceProps {
  state: VantaSystemState;
  onRefreshAudit: () => Promise<void>;
}

const CAPABILITY_MATRIX: {
  domain: string;
  capability: string;
  status: FeatureStatus;
  readinessLevel: string;
  evidence: string;
}[] = [
  {
    domain: '01. Command Center & Design System',
    capability: '3-Zone Top Bar, Collapsible Sidebar, Dual-Theme (@custom-variant dark), Tabular Numerals',
    status: 'VERIFIED',
    readinessLevel: 'LEVEL 4 — INTEGRATION VERIFIED',
    evidence: 'src/index.css, src/App.tsx, Plus Jakarta Sans + JetBrains Mono',
  },
  {
    domain: '02. Vanta Brain 9-Layer Engine',
    capability: 'Intent, Context, Data, Vision, Temporal, Policy, Orchestration, Explanation, Governance layers',
    status: 'VERIFIED',
    readinessLevel: 'LEVEL 4 — INTEGRATION VERIFIED',
    evidence: 'src/core/engine.ts (runNineLayerBrainPipeline) + server.ts (gemini-4-hydrogen)',
  },
  {
    domain: '03. 25-Tool Governed Ecosystem',
    capability: '25 typed tools across System, Camera/Device, Event/Incident, Policy, and Governance with RBAC',
    status: 'TESTED',
    readinessLevel: 'LEVEL 4 — INTEGRATION VERIFIED',
    evidence: 'BRAIN_TOOLS_REGISTRY (25 tools) + node:test suite in src/core/engine.test.ts',
  },
  {
    domain: '04. ALEANA Bilingual Voice System',
    capability: 'English, Hindi (हिन्दी), and Hinglish conversational pipeline with Barge-In interruption',
    status: 'VERIFIED',
    readinessLevel: 'LEVEL 4 — INTEGRATION VERIFIED',
    evidence: 'src/components/BrainAndAleanaWorkspace.tsx + shared CONV-PRIMARY context',
  },
  {
    domain: '05. Camera & Vision Workspace',
    capability: '1/2/4/6/9 matrix views, 640px bounding-box overlay, authorized local webcam + simulated stream labels',
    status: 'VERIFIED',
    readinessLevel: 'LEVEL 4 — INTEGRATION VERIFIED',
    evidence: 'src/components/CameraWorkspace.tsx + /api/cameras/:id/telemetry',
  },
  {
    domain: '06. Multi-Device Cloud Sync & QR Pairing',
    capability: 'Real-time SSE cloud sync (/api/sync/stream), short-lived QR tokens, cross-platform fleet registry',
    status: 'VERIFIED',
    readinessLevel: 'LEVEL 4 — INTEGRATION VERIFIED',
    evidence: 'server.ts SSE broadcaster + createDevicePairingSession',
  },
  {
    domain: '07. Incident State Machine & Policy Engine',
    capability: 'OPEN → INVESTIGATING → CONTAINED → RESOLVED state validation + explainable policy simulator',
    status: 'TESTED',
    readinessLevel: 'LEVEL 4 — INTEGRATION VERIFIED',
    evidence: 'validateIncidentTransition + evaluateCompoundPolicyRule tested in engine.test.ts',
  },
  {
    domain: '08. Cryptographic SHA-256 Audit Ledger',
    capability: 'FIPS 180-4 SHA-256 hash chain linking every state mutation and Brain tool call',
    status: 'TESTED',
    readinessLevel: 'LEVEL 5 — RELEASE CANDIDATE',
    evidence: 'sha256Hex + verifyAuditChain tamper-detection test in engine.test.ts',
  },
];

export const AuditAndBlueprintWorkspace: React.FC<
  AuditAndBlueprintWorkspaceProps
> = ({ state, onRefreshAudit }) => {
  const [activeSubTab, setActiveSubTab] = useState<'AUDIT' | 'BLUEPRINT'>('AUDIT');
  const [verifying, setVerifying] = useState(false);

  const chainCheck = verifyAuditChain(state.auditTrail);

  const handleVerifyClick = async () => {
    setVerifying(true);
    try {
      await onRefreshAudit();
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-tab Switcher */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Cryptographic Audit Center & Phase 0 Engineering Blueprint
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Immutable SHA-256 hash-chain verification · Capability Readiness Matrix · Architecture Governance
          </p>
        </div>

        <div
          className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
          role="group"
          aria-label="Audit and Blueprint view selector"
        >
          <button
            type="button"
            onClick={() => setActiveSubTab('AUDIT')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeSubTab === 'AUDIT'
                ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            SHA-256 Audit Ledger ({state.auditTrail.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('BLUEPRINT')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeSubTab === 'BLUEPRINT'
                ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Phase 0 Blueprint & Readiness Matrix
          </button>
        </div>
      </div>

      {activeSubTab === 'AUDIT' ? (
        <div className="space-y-6">
          {/* Chain Verification Banner */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>
                  HASH CHAIN INTEGRITY: {chainCheck.valid ? 'VERIFIED INTACT' : 'TAMPER DETECTED'} ·{' '}
                  {chainCheck.checkedCount} BLOCKS VERIFIED
                </span>
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                HEAD SHA-256: {chainCheck.headHash}
              </div>
            </div>

            <button
              type="button"
              onClick={handleVerifyClick}
              disabled={verifying}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-slate-800 dark:text-sky-300 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
              {verifying ? 'Verifying Chain...' : 'Re-Verify Cryptographic Hash Chain'}
            </button>
          </div>

          {/* Audit Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono">
                    <th className="py-2.5 px-3">SEQ / ID</th>
                    <th className="py-2.5 px-3">ACTOR · ROLE</th>
                    <th className="py-2.5 px-3">CATEGORY · ACTION</th>
                    <th className="py-2.5 px-3">DETAILS</th>
                    <th className="py-2.5 px-3 text-right">PREV HASH → RECORD SHA-256</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {[...state.auditTrail].reverse().map((rec) => (
                    <tr
                      key={rec.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-3 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        #{rec.sequenceNumber} · {rec.id}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300">
                        {rec.actorId} · {rec.actorRole}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300">
                        {rec.category} · {rec.action} ({rec.outcome})
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 max-w-md">
                        {rec.details}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {rec.previousHash.slice(0, 8)}… → {rec.recordHash.slice(0, 12)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Capability Readiness & Truthful Status Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Phase 0 Product & Technical Blueprint — Verified Capability Matrix
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Truthful engineering classification per Section 1 & Section 32 of the Vanta Engineering Constitution.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-mono">
                    <th className="py-2.5 px-3">ARCHITECTURAL DOMAIN</th>
                    <th className="py-2.5 px-3">IMPLEMENTED CAPABILITY</th>
                    <th className="py-2.5 px-3">STATUS</th>
                    <th className="py-2.5 px-3">READINESS LEVEL</th>
                    <th className="py-2.5 px-3">VERIFICATION EVIDENCE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {CAPABILITY_MATRIX.map((row) => (
                    <tr key={row.domain}>
                      <td className="py-3 px-3 font-semibold text-slate-900 dark:text-slate-100">
                        {row.domain}
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                        {row.capability}
                      </td>
                      <td className="py-3 px-3 font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                        {row.status}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300">
                        {row.readinessLevel}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-500 dark:text-slate-400">
                        {row.evidence}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Architecture Decision Records Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-4 space-y-2">
              <div className="text-xs font-mono text-sky-500 font-semibold">
                ADR-001 · CANONICAL FULL-STACK RUNTIME
              </div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Express + TypeScript Canonical Server with SSE Cloud Sync
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Single canonical backend authority (`server.ts`) managing state persistence (`.vanta-state.json`), RBAC validation, Server-Sent Events (`/api/sync/stream`), and server-only `@google/genai` execution on port 3000.
              </p>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-4 space-y-2">
              <div className="text-xs font-mono text-sky-500 font-semibold">
                ADR-002 · UNIFIED BRAIN × ALEANA CONTEXT
              </div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Shared 9-Layer Pipeline & 25-Tool Registry
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Text queries to Vanta Brain and voice interactions via ALEANA share `CONV-PRIMARY`, execute the same 25 RBAC-governed tools, and support English, Hindi, and Hinglish seamlessly.
              </p>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-4 space-y-2">
              <div className="text-xs font-mono text-sky-500 font-semibold">
                ADR-003 · CRYPTOGRAPHIC AUDIT & PRIVACY
              </div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                FIPS 180-4 SHA-256 Hash Chain & Zero-Biometric CV
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Every incident transition, policy mutation, device pairing, and Brain tool invocation is linked in a verifiable SHA-256 hash chain. Computer vision is strictly bounded to non-biometric 640px object/dwell telemetry.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
