import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck2,
  Filter,
  Play,
  Shield,
  Sliders,
} from 'lucide-react';
import {
  IncidentStatus,
  SeverityLevel,
  VantaSystemState,
} from '../core/types';

interface OperationsAndPoliciesWorkspaceProps {
  state: VantaSystemState;
  onTransitionIncident: (
    incidentId: string,
    targetStatus: IncidentStatus,
    note: string
  ) => Promise<{ error?: string }>;
  onTogglePolicy: (policyId: string) => Promise<{ error?: string }>;
  onEvaluatePolicy: (
    policyId: string,
    params: {
      occupancy: number;
      maxDwellSeconds: number;
      confidence: number;
      isRestrictedHours: boolean;
    }
  ) => Promise<{
    matched: boolean;
    reasons: string[];
    governanceDisclaimer: string;
  } | null>;
}

export const OperationsAndPoliciesWorkspace: React.FC<
  OperationsAndPoliciesWorkspaceProps
> = ({ state, onTransitionIncident, onTogglePolicy, onEvaluatePolicy }) => {
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>(
    state.incidents[0]?.id || 'INC-2041'
  );
  const [evidenceNote, setEvidenceNote] = useState<string>(
    'Verified camera telemetry and dispatched field operator to inspect zone.'
  );
  const [transitionFeedback, setTransitionFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [eventSeverityFilter, setEventSeverityFilter] = useState<
    'ALL' | SeverityLevel
  >('ALL');

  // Policy simulator state
  const [simPolicyId, setSimPolicyId] = useState<string>(
    state.policies[0]?.id || 'POL-01'
  );
  const [simOccupancy, setSimOccupancy] = useState<number>(3);
  const [simDwell, setSimDwell] = useState<number>(145);
  const [simConfidence, setSimConfidence] = useState<number>(0.94);
  const [simRestrictedHours, setSimRestrictedHours] = useState<boolean>(true);
  const [simResult, setSimResult] = useState<{
    matched: boolean;
    reasons: string[];
    governanceDisclaimer: string;
  } | null>(null);

  const selectedIncident =
    state.incidents.find((i) => i.id === selectedIncidentId) ||
    state.incidents[0];

  const handleStateTransition = async (targetStatus: IncidentStatus) => {
    if (!selectedIncident) return;
    setTransitionFeedback(null);
    const res = await onTransitionIncident(
      selectedIncident.id,
      targetStatus,
      evidenceNote
    );
    if (res.error) {
      setTransitionFeedback({ type: 'error', message: res.error });
    } else {
      setTransitionFeedback({
        type: 'success',
        message: `Incident ${selectedIncident.id} transitioned to ${targetStatus} and recorded in SHA-256 audit ledger.`,
      });
    }
  };

  const handleRunPolicyEval = async () => {
    const res = await onEvaluatePolicy(simPolicyId, {
      occupancy: simOccupancy,
      maxDwellSeconds: simDwell,
      confidence: simConfidence,
      isRestrictedHours: simRestrictedHours,
    });
    if (res) {
      setSimResult(res);
    }
  };

  const filteredEvents =
    eventSeverityFilter === 'ALL'
      ? state.events
      : state.events.filter((e) => e.severity === eventSeverityFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Incident Command, Event Stream & Explainable Policy Engine
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Enforced state-machine workflow (OPEN → INVESTIGATING → CONTAINED → RESOLVED) · Mandatory evidence notes · RBAC role: {state.tenant.role}
          </p>
        </div>
      </div>

      {/* Incident Command & State Machine Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Incidents List */}
        <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Active & Historical Incidents ({state.incidents.length})
            </h3>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {state.incidents.filter((i) => i.status !== 'RESOLVED').length} Unresolved
            </span>
          </div>

          <div className="space-y-3">
            {state.incidents.map((inc) => {
              const isSelected = inc.id === selectedIncident?.id;
              return (
                <button
                  key={inc.id}
                  type="button"
                  onClick={() => {
                    setSelectedIncidentId(inc.id);
                    setTransitionFeedback(null);
                  }}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    isSelected
                      ? 'border-sky-500 bg-sky-500/5 dark:bg-sky-500/10'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    <span>
                      {inc.id} · SEVERITY: {inc.severity}
                    </span>
                    <span
                      className={
                        inc.status === 'RESOLVED'
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          : 'text-amber-600 dark:text-amber-400 font-semibold'
                      }
                    >
                      STATUS: {inc.status}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-1">
                    {inc.title}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                    Zone: {inc.zoneName} · Cameras: {inc.cameraIds.join(', ')}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Incident State Machine & Evidence Timeline */}
        {selectedIncident && (
          <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    INCIDENT INSPECTOR · {selectedIncident.id} · CURRENT STATE:{' '}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {selectedIncident.status}
                    </strong>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-1">
                    {selectedIncident.title}
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-500">
                  Playbook: {selectedIncident.recommendedPlaybook}
                </span>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <div>
                  <strong className="text-slate-800 dark:text-slate-200">
                    Root Cause Hypothesis (Inferred):{' '}
                  </strong>
                  {selectedIncident.rootCauseHypothesis}
                </div>
                <div className="font-mono">
                  Assigned Operator: {selectedIncident.assignedTo} · Correlated Events:{' '}
                  {selectedIncident.relatedEventIds.join(', ')}
                </div>
              </div>

              {/* State Transition Form */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3">
                <label
                  htmlFor="incident-evidence-note"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Mandatory Verification / Evidence Note (Required by Section 16 State Machine)
                </label>
                <input
                  id="incident-evidence-note"
                  type="text"
                  value={evidenceNote}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  placeholder="Enter verifiable evidence note (min 5 chars)..."
                />

                <div className="flex flex-wrap items-center gap-2">
                  {(
                    ['INVESTIGATING', 'CONTAINED', 'RESOLVED'] as IncidentStatus[]
                  ).map((target) => (
                    <button
                      key={target}
                      type="button"
                      onClick={() => handleStateTransition(target)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-slate-800 dark:text-sky-300 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                    >
                      Transition → {target}
                    </button>
                  ))}
                </div>

                {transitionFeedback && (
                  <div
                    role="status"
                    className={`text-xs font-medium p-2.5 rounded-lg border ${
                      transitionFeedback.type === 'error'
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {transitionFeedback.message}
                  </div>
                )}
              </div>

              {/* Incident Audit Timeline */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Verified State Transition History ({selectedIncident.timeline.length})
                </div>
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {selectedIncident.timeline.map((entry) => (
                    <div
                      key={entry.id}
                      className="py-2 border-b border-slate-100 dark:border-slate-800/80 text-xs font-mono tabular-nums"
                    >
                      <div className="flex items-center justify-between text-slate-500">
                        <span>
                          {entry.action} · Actor: {entry.actor}
                        </span>
                        <span>{new Date(entry.timestampIso).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-slate-800 dark:text-slate-200 font-sans mt-0.5">
                        {entry.note}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Explainable Policy Engine + Live Testbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Configured Compound Security Policies ({state.policies.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Policy matches represent operational signals requiring human verification — never automatic proof of wrongdoing.
            </p>
          </div>

          <div className="space-y-3">
            {state.policies.map((pol) => (
              <div
                key={pol.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1 max-w-xl">
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    {pol.id} · ZONE: {pol.targetZoneName} · SEVERITY: {pol.severityOnMatch} · 24H MATCHES:{' '}
                    {pol.matchCount24h}
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pol.name}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {pol.description}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onTogglePolicy(pol.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    pol.enabled
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {pol.enabled ? 'Policy: Enabled' : 'Policy: Disabled'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Policy Explainability Testbench */}
        <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-500" />
                Compound Policy Explainability Simulator
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Test threshold parameters and inspect explainable match reasoning.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label
                  htmlFor="sim-policy-select"
                  className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Target Policy Rule
                </label>
                <select
                  id="sim-policy-select"
                  value={simPolicyId}
                  onChange={(e) => setSimPolicyId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  {state.policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} — {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="sim-occ-input"
                    className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Simulated Occupancy
                  </label>
                  <input
                    id="sim-occ-input"
                    type="number"
                    value={simOccupancy}
                    onChange={(e) => setSimOccupancy(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sim-dwell-input"
                    className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Dwell Duration (sec)
                  </label>
                  <input
                    id="sim-dwell-input"
                    type="number"
                    value={simDwell}
                    onChange={(e) => setSimDwell(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleRunPolicyEval}
                className="w-full py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
              >
                Evaluate Policy Rule
              </button>
            </div>

            {simResult && (
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs space-y-1.5">
                <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  RESULT: {simResult.matched ? 'SIGNAL MATCHED' : 'NO THRESHOLD MATCH'}
                </div>
                <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 space-y-1">
                  {simResult.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <div className="text-slate-500 italic pt-1 border-t border-slate-200 dark:border-slate-800">
                  {simResult.governanceDisclaimer}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Event Intelligence Stream */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Verified Telemetry & Security Event Stream ({filteredEvents.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Each event preserves source camera ID, provenance classification, confidence, and SHA-256 frame hash.
            </p>
          </div>

          <div
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            role="group"
            aria-label="Filter events by severity"
          >
            {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setEventSeverityFilter(sev)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  eventSeverityFilter === sev
                    ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono">
                <th className="py-2.5 px-3">EVENT ID</th>
                <th className="py-2.5 px-3">CAMERA / ZONE</th>
                <th className="py-2.5 px-3">CATEGORY · SEVERITY</th>
                <th className="py-2.5 px-3">SUMMARY</th>
                <th className="py-2.5 px-3 text-right">PROVENANCE · CONFIDENCE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredEvents.map((ev) => (
                <tr
                  key={ev.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3 px-3 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {ev.id}
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300">
                    {ev.cameraId} · {ev.zoneName}
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300">
                    {ev.category} · {ev.severity}
                  </td>
                  <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                    {ev.summary}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {ev.provenance} · {(ev.confidence * 100).toFixed(0)}% ·{' '}
                    {ev.evidenceMetadata.frameHash.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
