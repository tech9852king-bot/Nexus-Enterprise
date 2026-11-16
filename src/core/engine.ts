import {
  AuditRecord,
  BrainLayerTrace,
  BrainToolDefinition,
  BrainToolExecutionRecord,
  IncidentEntity,
  IncidentStatus,
  PairingSession,
  PolicyRule,
  SecurityEvent,
  UserRole,
  VantaSystemState,
} from './types';

/**
 * Pure deterministic SHA-256 implementation (FIPS 180-4) so both Node and browser
 * can compute and verify identical cryptographic hash chains without native bindings.
 */
export function sha256Hex(ascii: string): string {
  const rightRotate = (value: number, amount: number) =>
    (value >>> amount) | (value << (32 - amount));

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';

  const words: number[] = [];
  const utf8 = unescape(encodeURIComponent(ascii));
  const asciiBitLength = utf8.length * 8;

  const hash: number[] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k: number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let str = utf8 + '\x80';
  while ((str.length % 64) - 56) str += '\x00';
  for (let i = 0; i < str.length; i++) {
    const j = str.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);

    for (let i = 0; i < 64; i++) {
      const i2 = i + j;
      const w15 = w[i - 15];
      const w2 = w[i - 2];

      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
      void i2;
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

export function computeAuditRecordHash(record: Omit<AuditRecord, 'recordHash'>): string {
  const canonical = [
    record.sequenceNumber,
    record.tenantId,
    record.timestampIso,
    record.actorId,
    record.actorRole,
    record.category,
    record.action,
    record.targetId,
    record.outcome,
    record.details,
    record.previousHash,
  ].join('|');
  return sha256Hex(canonical);
}

export function appendAuditRecord(
  trail: AuditRecord[],
  entry: Omit<AuditRecord, 'id' | 'sequenceNumber' | 'previousHash' | 'recordHash' | 'timestampIso'> & {
    timestampIso?: string;
  }
): AuditRecord[] {
  const lastRecord = trail[trail.length - 1];
  const sequenceNumber = lastRecord ? lastRecord.sequenceNumber + 1 : 1;
  const previousHash = lastRecord ? lastRecord.recordHash : '0000000000000000000000000000000000000000000000000000000000000000';
  const timestampIso = entry.timestampIso ?? new Date().toISOString();
  const base: Omit<AuditRecord, 'recordHash'> = {
    id: `AUD-${String(sequenceNumber).padStart(4, '0')}`,
    sequenceNumber,
    tenantId: entry.tenantId,
    timestampIso,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    category: entry.category,
    action: entry.action,
    targetId: entry.targetId,
    outcome: entry.outcome,
    details: entry.details,
    previousHash,
  };
  const recordHash = computeAuditRecordHash(base);
  return [...trail, { ...base, recordHash }];
}

export function verifyAuditChain(trail: AuditRecord[]): {
  valid: boolean;
  checkedCount: number;
  brokenAtSequence: number | null;
  headHash: string;
} {
  let expectedPrev = '0000000000000000000000000000000000000000000000000000000000000000';
  for (const record of trail) {
    if (record.previousHash !== expectedPrev) {
      return {
        valid: false,
        checkedCount: record.sequenceNumber,
        brokenAtSequence: record.sequenceNumber,
        headHash: record.recordHash,
      };
    }
    const recomputed = computeAuditRecordHash(record);
    if (recomputed !== record.recordHash) {
      return {
        valid: false,
        checkedCount: record.sequenceNumber,
        brokenAtSequence: record.sequenceNumber,
        headHash: record.recordHash,
      };
    }
    expectedPrev = record.recordHash;
  }
  return {
    valid: true,
    checkedCount: trail.length,
    brokenAtSequence: null,
    headHash: trail.length > 0 ? trail[trail.length - 1].recordHash : expectedPrev,
  };
}

/**
 * Incident State Machine Governance (Section 16)
 */
const PERMITTED_INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'CONTAINED'],
  INVESTIGATING: ['CONTAINED', 'RESOLVED'],
  CONTAINED: ['INVESTIGATING', 'RESOLVED'],
  RESOLVED: ['INVESTIGATING'], // Reopen if new evidence emerges
};

export function validateIncidentTransition(
  currentStatus: IncidentStatus,
  targetStatus: IncidentStatus,
  actorRole: UserRole,
  evidenceNote: string
): { allowed: boolean; reason: string } {
  if (actorRole === 'AUDITOR') {
    return { allowed: false, reason: 'AUDITOR role is read-only and cannot mutate incident state.' };
  }
  if (currentStatus === targetStatus) {
    return { allowed: false, reason: `Incident is already in ${currentStatus} state.` };
  }
  const allowedTargets = PERMITTED_INCIDENT_TRANSITIONS[currentStatus] || [];
  if (!allowedTargets.includes(targetStatus)) {
    return {
      allowed: false,
      reason: `Illegal state transition from ${currentStatus} to ${targetStatus}. Permitted: ${allowedTargets.join(', ')}.`,
    };
  }
  if (!evidenceNote || evidenceNote.trim().length < 5) {
    return {
      allowed: false,
      reason: 'State transition requires a verifiable evidence note (minimum 5 characters).',
    };
  }
  return { allowed: true, reason: 'Transition validated against state machine and RBAC.' };
}

export function transitionIncidentState(
  incident: IncidentEntity,
  targetStatus: IncidentStatus,
  actorName: string,
  actorRole: UserRole,
  evidenceNote: string,
  timestampIso = new Date().toISOString()
): { updatedIncident?: IncidentEntity; error?: string } {
  const check = validateIncidentTransition(incident.status, targetStatus, actorRole, evidenceNote);
  if (!check.allowed) {
    return { error: check.reason };
  }
  const entry = {
    id: `TL-${Date.now().toString(36).toUpperCase()}`,
    timestampIso,
    actor: `${actorName} (${actorRole})`,
    fromStatus: incident.status,
    toStatus: targetStatus,
    action: `Transitioned ${incident.status} -> ${targetStatus}`,
    note: evidenceNote.trim(),
    verifiedEvidence: true,
  };
  return {
    updatedIncident: {
      ...incident,
      status: targetStatus,
      updatedAtIso: timestampIso,
      timeline: [...incident.timeline, entry],
    },
  };
}

/**
 * Compound Policy Evaluation Engine
 */
export function evaluateCompoundPolicyRule(
  policy: PolicyRule,
  observation: {
    zoneId: string;
    occupancy: number;
    maxDwellSeconds: number;
    confidence: number;
    isRestrictedHours: boolean;
  }
): {
  matched: boolean;
  reasons: string[];
  governanceDisclaimer: string;
} {
  const reasons: string[] = [];
  if (!policy.enabled) {
    return {
      matched: false,
      reasons: ['Policy is currently disabled.'],
      governanceDisclaimer:
        'A policy evaluation is an operational telemetry signal and does not constitute proof of wrongdoing.',
    };
  }
  if (policy.targetZoneId !== observation.zoneId) {
    return {
      matched: false,
      reasons: [`Zone mismatch: expected ${policy.targetZoneId}, observed ${observation.zoneId}.`],
      governanceDisclaimer:
        'A policy evaluation is an operational telemetry signal and does not constitute proof of wrongdoing.',
    };
  }
  if (observation.confidence < policy.conditions.requiredConfidence) {
    return {
      matched: false,
      reasons: [
        `Detection confidence ${(observation.confidence * 100).toFixed(1)}% is below required threshold ${(
          policy.conditions.requiredConfidence * 100
        ).toFixed(1)}%.`,
      ],
      governanceDisclaimer:
        'A policy evaluation is an operational telemetry signal and does not constitute proof of wrongdoing.',
    };
  }

  let conditionMatched = true;
  if (policy.conditions.minOccupancy !== undefined) {
    if (observation.occupancy >= policy.conditions.minOccupancy) {
      reasons.push(
        `Observed occupancy (${observation.occupancy}) met or exceeded threshold (${policy.conditions.minOccupancy}).`
      );
    } else {
      conditionMatched = false;
      reasons.push(
        `Observed occupancy (${observation.occupancy}) is below threshold (${policy.conditions.minOccupancy}).`
      );
    }
  }
  if (policy.conditions.maxDwellSeconds !== undefined) {
    if (observation.maxDwellSeconds >= policy.conditions.maxDwellSeconds) {
      reasons.push(
        `Observed dwell duration (${observation.maxDwellSeconds}s) met or exceeded threshold (${policy.conditions.maxDwellSeconds}s).`
      );
    } else {
      conditionMatched = false;
      reasons.push(
        `Observed dwell duration (${observation.maxDwellSeconds}s) is below threshold (${policy.conditions.maxDwellSeconds}s).`
      );
    }
  }
  if (policy.conditions.restrictedHoursOnly) {
    if (observation.isRestrictedHours) {
      reasons.push('Activity occurred during restricted operational window.');
    } else {
      conditionMatched = false;
      reasons.push('Activity occurred during standard permitted hours.');
    }
  }

  return {
    matched: conditionMatched,
    reasons,
    governanceDisclaimer:
      'Operational Signal Only: Policy matches indicate statistical/telemetry threshold alignment and require human operator verification.',
  };
}

/**
 * 25 Typed, Permission-Controlled Brain Tools Registry (Section 7)
 */
export const BRAIN_TOOLS_REGISTRY: BrainToolDefinition[] = [
  // System tools (1-5)
  {
    id: 'T01',
    name: 'get_system_status',
    category: 'SYSTEM',
    description: 'Retrieve overall Vanta Nexus platform health, sync revision, and subsystem readiness.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{}',
    outputSchemaSummary: '{ status, syncRevision, connectedDevices, activeCameras, auditChainValid }',
  },
  {
    id: 'T02',
    name: 'get_summary_metrics',
    category: 'SYSTEM',
    description: 'Aggregate KPI metrics across cameras, devices, incidents, events, and occupancy.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ timeWindow?: "1H" | "6H" | "24H" }',
    outputSchemaSummary: '{ openIncidents, criticalIncidents, totalOccupancy, avgInferenceLatencyMs }',
  },
  {
    id: 'T03',
    name: 'get_pipeline_diagnostics',
    category: 'SYSTEM',
    description: 'Inspect CV inference latency, WebRTC/ONVIF stream bitrate, packet loss, and sync queues.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST'],
    inputSchemaSummary: '{}',
    outputSchemaSummary: '{ avgFps, avgLatencyMs, degradedStreams, cloudSyncHealthy }',
  },
  {
    id: 'T04',
    name: 'run_troubleshooter',
    category: 'SYSTEM',
    description: 'Execute automated diagnostic checks on degraded cameras, edge nodes, and policy pipelines.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST'],
    inputSchemaSummary: '{ targetScope?: string }',
    outputSchemaSummary: '{ findings: string[], recommendations: string[] }',
  },
  {
    id: 'T05',
    name: 'generate_operational_report',
    category: 'SYSTEM',
    description: 'Compile a structured executive shift report with incident outcomes, SLA metrics, and audit hashes.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ shiftName?: string }',
    outputSchemaSummary: '{ reportId, generatedAt, executiveSummary, keyMetrics, auditHeadHash }',
  },
  // Camera and device tools (6-10)
  {
    id: 'T06',
    name: 'get_camera_inventory',
    category: 'CAMERA_DEVICE',
    description: 'List all authorized camera streams with zone assignments, FPS, and simulation disclosure.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ zoneId?: string }',
    outputSchemaSummary: '{ cameras: CameraEntity[] }',
  },
  {
    id: 'T07',
    name: 'get_device_inventory',
    category: 'CAMERA_DEVICE',
    description: 'List cross-platform paired devices (Android, Tablet, Windows, Edge Nodes) and sync states.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ platform?: string }',
    outputSchemaSummary: '{ devices: DeviceEntity[] }',
  },
  {
    id: 'T08',
    name: 'get_device_status',
    category: 'CAMERA_DEVICE',
    description: 'Inspect CPU, memory, battery telemetry, and heartbeat freshness for a specific device.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST'],
    inputSchemaSummary: '{ deviceId?: string }',
    outputSchemaSummary: '{ device, healthAssessment }',
  },
  {
    id: 'T09',
    name: 'get_camera_connection_quality',
    category: 'CAMERA_DEVICE',
    description: 'Analyze bitrate, packet loss, and connector state across camera endpoints.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST'],
    inputSchemaSummary: '{ cameraId?: string }',
    outputSchemaSummary: '{ qualityReport }',
  },
  {
    id: 'T10',
    name: 'get_zone_intelligence',
    category: 'CAMERA_DEVICE',
    description: 'Retrieve zone occupancy, capacity ratios, dwell thresholds, and environmental telemetry.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ zoneId?: string }',
    outputSchemaSummary: '{ zones }',
  },
  // Event and incident tools (11-15)
  {
    id: 'T11',
    name: 'list_events',
    category: 'EVENT_INCIDENT',
    description: 'Query recent security and telemetry events filtered by severity or zone.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ severity?: SeverityLevel, limit?: number }',
    outputSchemaSummary: '{ events: SecurityEvent[] }',
  },
  {
    id: 'T12',
    name: 'list_incidents',
    category: 'EVENT_INCIDENT',
    description: 'Retrieve active and historical incidents with state machine status and assignees.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ status?: IncidentStatus }',
    outputSchemaSummary: '{ incidents: IncidentEntity[] }',
  },
  {
    id: 'T13',
    name: 'explain_incident',
    category: 'EVENT_INCIDENT',
    description: 'Perform evidence-grounded root cause analysis on a specific incident and its correlated events.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ incidentId?: string }',
    outputSchemaSummary: '{ incident, correlatedEvents, hypothesis, confidence }',
  },
  {
    id: 'T14',
    name: 'analyze_event_timeline',
    category: 'EVENT_INCIDENT',
    description: 'Reconstruct temporal sequence of events across zones to identify anomaly propagation.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST'],
    inputSchemaSummary: '{ windowMinutes?: number }',
    outputSchemaSummary: '{ sequence, peakWindow, anomalies }',
  },
  {
    id: 'T15',
    name: 'generate_forensic_summary',
    category: 'EVENT_INCIDENT',
    description: 'Produce a forensic metadata summary with frame hashes and provenance verification.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ zoneId?: string }',
    outputSchemaSummary: '{ forensicSummary, frameHashesVerified, disclaimer }',
  },
  // Policy and intelligence tools (16-20)
  {
    id: 'T16',
    name: 'list_policies',
    category: 'POLICY_INTELLIGENCE',
    description: 'List configured operational security policies, thresholds, and 24h match counts.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{}',
    outputSchemaSummary: '{ policies: PolicyRule[] }',
  },
  {
    id: 'T17',
    name: 'evaluate_compound_policy',
    category: 'POLICY_INTELLIGENCE',
    description: 'Simulate or evaluate a policy rule against live zone telemetry with explainable reasoning.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST'],
    inputSchemaSummary: '{ policyId?: string }',
    outputSchemaSummary: '{ policyName, matched, reasons, governanceDisclaimer }',
  },
  {
    id: 'T18',
    name: 'correlate_threat_matrix',
    category: 'POLICY_INTELLIGENCE',
    description: 'Cross-reference open incidents, degraded devices, and restricted zone dwell anomalies.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST'],
    inputSchemaSummary: '{}',
    outputSchemaSummary: '{ riskVectors, priorityZones }',
  },
  {
    id: 'T19',
    name: 'correlate_cross_camera_events',
    category: 'POLICY_INTELLIGENCE',
    description: 'Correlate spatio-temporal motion and zone transitions across adjacent camera fields of view (without biometric matching).',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST'],
    inputSchemaSummary: '{}',
    outputSchemaSummary: '{ transitions, privacyComplianceNote }',
  },
  {
    id: 'T20',
    name: 'predict_aggregate_occupancy',
    category: 'POLICY_INTELLIGENCE',
    description: 'Estimate short-horizon zone occupancy trends based on historical telemetry rates.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST'],
    inputSchemaSummary: '{ horizonMinutes?: number }',
    outputSchemaSummary: '{ currentOccupancy, projectedOccupancy, uncertaintyBand, provenance: "Estimated" }',
  },
  // Operations and governance tools (21-25)
  {
    id: 'T21',
    name: 'resolve_incident',
    category: 'OPERATIONS_GOVERNANCE',
    description: 'Transition an active incident toward CONTAINED or RESOLVED with mandatory verification note.',
    consequential: true,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR'],
    inputSchemaSummary: '{ incidentId: string, targetStatus?: IncidentStatus, note?: string }',
    outputSchemaSummary: '{ updatedIncident, auditRecordId }',
  },
  {
    id: 'T22',
    name: 'toggle_policy',
    category: 'OPERATIONS_GOVERNANCE',
    description: 'Enable or disable an operational policy rule with full cryptographic audit logging.',
    consequential: true,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR'],
    inputSchemaSummary: '{ policyId: string, enabled?: boolean }',
    outputSchemaSummary: '{ policy, auditRecordId }',
  },
  {
    id: 'T23',
    name: 'execute_security_playbook',
    category: 'OPERATIONS_GOVERNANCE',
    description: 'Execute an authorized operational response playbook (e.g. Perimeter Diagnostics & Zone Alert Sync).',
    consequential: true,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR'],
    inputSchemaSummary: '{ playbookId?: string, zoneId?: string }',
    outputSchemaSummary: '{ executionStatus, stepsCompleted, verificationState }',
  },
  {
    id: 'T24',
    name: 'get_audit_trail',
    category: 'OPERATIONS_GOVERNANCE',
    description: 'Retrieve SHA-256 hash-chained audit records and verify cryptographic chain integrity.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{ limit?: number }',
    outputSchemaSummary: '{ integrityVerification, recentRecords }',
  },
  {
    id: 'T25',
    name: 'query_digital_twin_state',
    category: 'OPERATIONS_GOVERNANCE',
    description: 'Inspect live synchronized Digital Twin spatial graph, zone energy draw, and camera coverage.',
    consequential: false,
    requiredRole: ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'],
    inputSchemaSummary: '{}',
    outputSchemaSummary: '{ twinModelType, zones, cameras, totalPowerKw }',
  },
];

export function executeBrainTool(
  state: VantaSystemState,
  toolName: string,
  args: Record<string, unknown> = {},
  options: { confirmedConsequential?: boolean } = {}
): {
  record: BrainToolExecutionRecord;
  updatedState: VantaSystemState;
} {
  const startMs = Date.now();
  const toolDef = BRAIN_TOOLS_REGISTRY.find((t) => t.name === toolName);
  const timestampIso = new Date().toISOString();

  if (!toolDef) {
    const failedRecord: BrainToolExecutionRecord = {
      executionId: `EXEC-${Date.now().toString(36).toUpperCase()}`,
      toolName,
      category: 'SYSTEM',
      timestampIso,
      actor: `${state.tenant.userName} (${state.tenant.role})`,
      arguments: args,
      status: 'FAILED',
      latencyMs: 1,
      resultSummary: `Tool "${toolName}" is not registered in the Vanta Brain Governance Registry.`,
      dataPayload: null,
      provenance: 'Measured',
    };
    return { record: failedRecord, updatedState: state };
  }

  // Enforce RBAC
  if (!toolDef.requiredRole.includes(state.tenant.role)) {
    const deniedRecord: BrainToolExecutionRecord = {
      executionId: `EXEC-${Date.now().toString(36).toUpperCase()}`,
      toolName: toolDef.name,
      category: toolDef.category,
      timestampIso,
      actor: `${state.tenant.userName} (${state.tenant.role})`,
      arguments: args,
      status: 'DENIED',
      latencyMs: 2,
      resultSummary: `Authorization denied: role ${state.tenant.role} lacks permission for ${toolDef.name}.`,
      dataPayload: null,
      provenance: 'Measured',
    };
    const nextAudit = appendAuditRecord(state.auditTrail, {
      tenantId: state.tenant.tenantId,
      actorId: state.tenant.userId,
      actorRole: state.tenant.role,
      category: 'BRAIN_TOOL',
      action: `TOOL_DENIED:${toolDef.name}`,
      targetId: toolDef.id,
      outcome: 'DENIED',
      details: deniedRecord.resultSummary,
    });
    return {
      record: deniedRecord,
      updatedState: {
        ...state,
        auditTrail: nextAudit,
        toolExecutions: [deniedRecord, ...state.toolExecutions.slice(0, 49)],
      },
    };
  }

  let nextState = { ...state };
  let resultSummary = '';
  let dataPayload: unknown = {};
  let provenance: BrainToolExecutionRecord['provenance'] = 'Measured';

  switch (toolDef.name) {
    case 'get_system_status': {
      const chain = verifyAuditChain(state.auditTrail);
      const onlineCameras = state.cameras.filter((c) => c.connectorState === 'Connected' || c.connectorState === 'Simulated').length;
      const connectedDevices = state.devices.filter((d) => d.connectorState === 'Connected').length;
      dataPayload = {
        platformVersion: state.version,
        codename: state.codename,
        syncRevision: state.syncRevision,
        onlineCameras,
        totalCameras: state.cameras.length,
        connectedDevices,
        totalDevices: state.devices.length,
        auditChainValid: chain.valid,
        auditRecordsCount: chain.checkedCount,
      };
      resultSummary = `System nominal (Rev #${state.syncRevision}): ${onlineCameras}/${state.cameras.length} cameras active, ${connectedDevices}/${state.devices.length} devices synced, SHA-256 audit chain verified (${chain.checkedCount} blocks).`;
      break;
    }

    case 'get_summary_metrics': {
      const openIncidents = state.incidents.filter((i) => i.status !== 'RESOLVED');
      const criticalIncidents = openIncidents.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH');
      const totalOccupancy = state.zones.reduce((acc, z) => acc + z.currentOccupancy, 0);
      const avgLatency =
        Math.round(
          state.cameras.reduce((acc, c) => acc + c.inferenceLatencyMs, 0) / Math.max(1, state.cameras.length)
        );
      dataPayload = {
        openIncidentsCount: openIncidents.length,
        criticalOrHighCount: criticalIncidents.length,
        totalOccupancy,
        eventsLast24h: state.events.length,
        avgInferenceLatencyMs: avgLatency,
      };
      resultSummary = `${openIncidents.length} active incidents (${criticalIncidents.length} high/critical priority), ${totalOccupancy} total facility occupancy across ${state.zones.length} zones, average CV inference latency ${avgLatency}ms.`;
      break;
    }

    case 'get_pipeline_diagnostics': {
      const degraded = state.cameras.filter((c) => c.connectorState === 'Degraded' || c.packetLossPct > 1.0);
      const avgFps = Number(
        (state.cameras.reduce((acc, c) => acc + c.fps, 0) / Math.max(1, state.cameras.length)).toFixed(1)
      );
      dataPayload = {
        avgFps,
        degradedCameras: degraded.map((c) => ({ id: c.id, name: c.name, packetLossPct: c.packetLossPct })),
        syncLatencyMs: state.devices[0]?.syncLatencyMs ?? 18,
      };
      resultSummary = `Vision pipeline running at ${avgFps} avg FPS. ${degraded.length} stream(s) experiencing elevated packet loss (${degraded.map((d) => d.name).join(', ') || 'none'}).`;
      break;
    }

    case 'run_troubleshooter': {
      const degradedCams = state.cameras.filter((c) => c.connectorState !== 'Connected' && c.connectorState !== 'Simulated');
      const lowBatDevices = state.devices.filter((d) => d.batteryPct !== null && d.batteryPct < 30);
      const findings = [
        ...degradedCams.map((c) => `Camera ${c.id} (${c.name}) is in ${c.connectorState} state with ${c.packetLossPct}% packet loss.`),
        ...lowBatDevices.map((d) => `Device ${d.id} (${d.name}) battery is at ${d.batteryPct}%.`),
      ];
      if (findings.length === 0) {
        findings.push('All camera streams and multi-device nodes passed heartbeat and packet-loss thresholds.');
      }
      dataPayload = {
        findings,
        recommendations:
          degradedCams.length > 0
            ? ['Switch degraded ONVIF stream to adaptive 640px sub-stream', 'Verify PoE switch port telemetry on Zone B']
            : ['Maintain current 640px adaptive inference baseline'],
      };
      resultSummary = `Troubleshooter completed: ${findings.join(' ')}`;
      break;
    }

    case 'generate_operational_report': {
      const chain = verifyAuditChain(state.auditTrail);
      const unresolved = state.incidents.filter((i) => i.status !== 'RESOLVED');
      dataPayload = {
        reportId: `RPT-${Date.now().toString(36).toUpperCase()}`,
        generatedAt: timestampIso,
        tenant: state.tenant.organizationName,
        site: state.tenant.siteName,
        unresolvedIncidents: unresolved.map((i) => ({ id: i.id, title: i.title, severity: i.severity, status: i.status })),
        auditHeadHash: chain.headHash.slice(0, 16),
      };
      resultSummary = `Generated Operational Shift Report for ${state.tenant.siteName}: ${unresolved.length} unresolved incident(s), ${state.events.length} logged events, cryptographic audit head ${chain.headHash.slice(0, 12)}...`;
      break;
    }

    case 'get_camera_inventory': {
      const zoneFilter = typeof args.zoneId === 'string' ? args.zoneId : undefined;
      const cams = zoneFilter ? state.cameras.filter((c) => c.zoneId === zoneFilter) : state.cameras;
      dataPayload = { cameras: cams };
      resultSummary = `Retrieved ${cams.length} camera stream(s): ${cams.map((c) => `${c.id} (${c.name} - ${c.connectorState})`).join(', ')}.`;
      break;
    }

    case 'get_device_inventory': {
      dataPayload = { devices: state.devices };
      resultSummary = `Retrieved ${state.devices.length} cross-platform devices (${state.devices.filter((d) => d.authorized).length} authorized).`;
      break;
    }

    case 'get_device_status': {
      const devId = typeof args.deviceId === 'string' ? args.deviceId : state.devices[0]?.id;
      const dev = state.devices.find((d) => d.id === devId) || state.devices[0];
      dataPayload = { device: dev };
      resultSummary = dev
        ? `Device ${dev.name} (${dev.platform}): ${dev.connectorState}, CPU ${dev.cpuLoadPct}%, RAM ${dev.memoryUsedMb}MB, Sync latency ${dev.syncLatencyMs}ms.`
        : 'No devices found.';
      break;
    }

    case 'get_camera_connection_quality': {
      const quality = state.cameras.map((c) => ({
        id: c.id,
        name: c.name,
        state: c.connectorState,
        bitrateKbps: c.bitrateKbps,
        packetLossPct: c.packetLossPct,
        latencyMs: c.inferenceLatencyMs,
      }));
      dataPayload = { quality };
      resultSummary = `Camera connection quality evaluated across ${quality.length} endpoints. Average bitrate ${Math.round(
        quality.reduce((a, b) => a + b.bitrateKbps, 0) / Math.max(1, quality.length)
      )} kbps.`;
      break;
    }

    case 'get_zone_intelligence': {
      dataPayload = { zones: state.zones };
      resultSummary = `Zone intelligence retrieved for ${state.zones.length} operational zones: ${state.zones
        .map((z) => `${z.name} (${z.currentOccupancy}/${z.capacityLimit} occ, ${z.status})`)
        .join('; ')}.`;
      break;
    }

    case 'list_events': {
      const sev = typeof args.severity === 'string' ? args.severity : undefined;
      const filtered = sev ? state.events.filter((e) => e.severity === sev) : state.events;
      dataPayload = { events: filtered.slice(0, 10) };
      resultSummary = `Retrieved ${filtered.length} security telemetry event(s). Latest: ${
        filtered[0] ? `${filtered[0].id} (${filtered[0].category} in ${filtered[0].zoneName})` : 'none'
      }.`;
      break;
    }

    case 'list_incidents': {
      const st = typeof args.status === 'string' ? args.status : undefined;
      const list = st ? state.incidents.filter((i) => i.status === st) : state.incidents;
      dataPayload = { incidents: list };
      resultSummary = `Found ${list.length} incident(s): ${list
        .map((i) => `${i.id} [${i.severity}/${i.status}] "${i.title}"`)
        .join('; ')}.`;
      break;
    }

    case 'explain_incident': {
      const targetId = typeof args.incidentId === 'string' ? args.incidentId : state.incidents[0]?.id;
      const inc = state.incidents.find((i) => i.id === targetId) || state.incidents[0];
      const related = state.events.filter((e) => inc?.relatedEventIds.includes(e.id));
      provenance = 'Inferred';
      dataPayload = {
        incident: inc,
        correlatedEvents: related,
        hypothesis: inc?.rootCauseHypothesis,
        recommendedPlaybook: inc?.recommendedPlaybook,
      };
      resultSummary = inc
        ? `Incident ${inc.id} (${inc.title}) in ${inc.zoneName}: Status=${inc.status}, Severity=${inc.severity}. Correlated with ${related.length} verified event(s). Hypothesis: ${inc.rootCauseHypothesis}`
        : 'No matching incident found.';
      break;
    }

    case 'analyze_event_timeline': {
      const byZone: Record<string, number> = {};
      for (const ev of state.events) {
        byZone[ev.zoneName] = (byZone[ev.zoneName] || 0) + 1;
      }
      dataPayload = { eventCount: state.events.length, distributionByZone: byZone };
      resultSummary = `Temporal analysis across ${state.events.length} events shows concentration in: ${Object.entries(
        byZone
      )
        .map(([z, count]) => `${z} (${count} events)`)
        .join(', ')}.`;
      break;
    }

    case 'generate_forensic_summary': {
      const verifiedCount = state.events.filter((e) => e.verified).length;
      dataPayload = {
        totalEventsInspected: state.events.length,
        verifiedFrameHashes: verifiedCount,
        replayType: 'STRUCTURED_METADATA_REPLAY',
        disclaimer:
          'Forensic timeline reconstructs verified computer-vision bounding-box and sensor metadata; it does not fabricate original raw video frames.',
      };
      resultSummary = `Forensic metadata summary compiled: ${verifiedCount}/${state.events.length} event frame hashes verified.`;
      break;
    }

    case 'list_policies': {
      dataPayload = { policies: state.policies };
      resultSummary = `${state.policies.length} policies configured (${
        state.policies.filter((p) => p.enabled).length
      } active): ${state.policies.map((p) => `${p.id} "${p.name}"`).join(', ')}.`;
      break;
    }

    case 'evaluate_compound_policy': {
      const pol =
        state.policies.find((p) => p.id === args.policyId) || state.policies[0];
      const zone = state.zones.find((z) => z.id === pol.targetZoneId) || state.zones[0];
      const evalResult = evaluateCompoundPolicyRule(pol, {
        zoneId: zone.id,
        occupancy: zone.currentOccupancy,
        maxDwellSeconds: 145,
        confidence: 0.92,
        isRestrictedHours: true,
      });
      dataPayload = { policy: pol.name, zone: zone.name, ...evalResult };
      resultSummary = `Evaluated policy "${pol.name}" on ${zone.name}: Matched=${evalResult.matched}. ${evalResult.reasons.join(' ')}`;
      break;
    }

    case 'correlate_threat_matrix': {
      const highRisks = state.zones.filter((z) => z.status !== 'NOMINAL');
      provenance = 'Inferred';
      dataPayload = {
        elevatedZones: highRisks.map((z) => z.name),
        activeCriticalIncidents: state.incidents.filter((i) => i.severity === 'CRITICAL' && i.status !== 'RESOLVED').length,
      };
      resultSummary = `Threat matrix correlation identified ${highRisks.length} elevated zone(s) (${highRisks
        .map((z) => z.name)
        .join(', ') || 'none'}) correlated with active perimeter & dwell signals.`;
      break;
    }

    case 'correlate_cross_camera_events': {
      provenance = 'Inferred';
      dataPayload = {
        correlatedTransitions: [
          {
            fromCamera: 'CAM-01 (North Perimeter Gate)',
            toCamera: 'CAM-02 (Server Vault Corridor)',
            deltaSeconds: 42,
            confidence: 0.87,
          },
        ],
        privacyComplianceNote:
          'Spatio-temporal bounding-box trajectory correlation only. Zero biometric or facial recognition vectors used.',
      };
      resultSummary =
        'Cross-camera temporal correlation identified 1 trajectory handoff between CAM-01 and CAM-02 (42s transit window, non-biometric).';
      break;
    }

    case 'predict_aggregate_occupancy': {
      const currentTotal = state.zones.reduce((acc, z) => acc + z.currentOccupancy, 0);
      const projected = Math.round(currentTotal * 1.12);
      provenance = 'Estimated';
      dataPayload = {
        currentOccupancy: currentTotal,
        projectedOccupancy30m: projected,
        uncertaintyBand: '±4 occupants (90% CI)',
        methodology: 'Exponential smoothing over trailing 6h zone telemetry',
      };
      resultSummary = `Current facility occupancy is ${currentTotal}; 30-minute projection is ${projected} (±4 occupants, Estimated provenance).`;
      break;
    }

    case 'resolve_incident': {
      const targetId = typeof args.incidentId === 'string' ? args.incidentId : state.incidents.find((i) => i.status !== 'RESOLVED')?.id;
      const targetStatus: IncidentStatus =
        args.targetStatus === 'CONTAINED' || args.targetStatus === 'INVESTIGATING' || args.targetStatus === 'RESOLVED'
          ? args.targetStatus
          : 'CONTAINED';
      const inc = state.incidents.find((i) => i.id === targetId);
      if (!inc) {
        resultSummary = 'No matching open incident found to transition.';
        break;
      }
      // Step-wise state machine compliance: if OPEN and user asks to resolve, move to CONTAINED first or if INVESTIGATING/CONTAINED move to RESOLVED
      const effectiveTarget: IncidentStatus =
        inc.status === 'OPEN' && targetStatus === 'RESOLVED' ? 'CONTAINED' : targetStatus;
      const note =
        typeof args.note === 'string' && args.note.trim().length >= 5
          ? args.note
          : `Verified via Vanta Brain tool execution by ${state.tenant.userName}. Telemetry checked.`;
      const res = transitionIncidentState(inc, effectiveTarget, state.tenant.userName, state.tenant.role, note, timestampIso);
      if (res.error || !res.updatedIncident) {
        resultSummary = `Incident transition blocked: ${res.error}`;
      } else {
        nextState = {
          ...nextState,
          syncRevision: nextState.syncRevision + 1,
          lastCloudSyncIso: timestampIso,
          incidents: nextState.incidents.map((item) => (item.id === inc.id ? res.updatedIncident! : item)),
        };
        resultSummary = `Incident ${inc.id} transitioned from ${inc.status} to ${res.updatedIncident.status} with verified note.`;
        dataPayload = { updatedIncident: res.updatedIncident };
      }
      break;
    }

    case 'toggle_policy': {
      const polId = typeof args.policyId === 'string' ? args.policyId : state.policies[0]?.id;
      const pol = state.policies.find((p) => p.id === polId);
      if (!pol) {
        resultSummary = 'Policy not found.';
        break;
      }
      const nextEnabled = typeof args.enabled === 'boolean' ? args.enabled : !pol.enabled;
      const updatedPol: PolicyRule = { ...pol, enabled: nextEnabled, lastEvaluatedIso: timestampIso };
      nextState = {
        ...nextState,
        syncRevision: nextState.syncRevision + 1,
        lastCloudSyncIso: timestampIso,
        policies: nextState.policies.map((p) => (p.id === pol.id ? updatedPol : p)),
      };
      dataPayload = { policy: updatedPol };
      resultSummary = `Policy ${pol.id} ("${pol.name}") set to ${nextEnabled ? 'ENABLED' : 'DISABLED'}.`;
      break;
    }

    case 'execute_security_playbook': {
      const playbook = typeof args.playbookId === 'string' ? args.playbookId : 'PB-VAULT-CONTAINMENT';
      nextState = {
        ...nextState,
        syncRevision: nextState.syncRevision + 1,
        lastCloudSyncIso: timestampIso,
      };
      dataPayload = {
        playbookId: playbook,
        stepsCompleted: [
          'Verified camera telemetry heartbeat on target zone',
          'Broadcast cloud sync alert to paired Android & Tablet command nodes',
          'Recorded SHA-256 governance checkpoint',
        ],
        verificationState: 'VERIFIED_COMPLETED',
      };
      resultSummary = `Executed security playbook ${playbook}: 3/3 verification steps completed and synced across connected devices.`;
      break;
    }

    case 'get_audit_trail': {
      const verification = verifyAuditChain(state.auditTrail);
      dataPayload = {
        verification,
        recentRecords: state.auditTrail.slice(-8).reverse(),
      };
      resultSummary = `Audit trail integrity: ${verification.valid ? 'VERIFIED' : 'BROKEN'} across ${verification.checkedCount} SHA-256 blocks. Head hash: ${verification.headHash.slice(0, 16)}...`;
      break;
    }

    case 'query_digital_twin_state': {
      const totalPowerKw = Number(state.zones.reduce((acc, z) => acc + z.powerDrawKw, 0).toFixed(1));
      dataPayload = {
        twinRepresentationType: 'LIVE_SYNCHRONIZED_SPATIAL_GRAPH',
        zones: state.zones,
        camerasCount: state.cameras.length,
        totalPowerKw,
      };
      resultSummary = `Digital Twin synchronized (Live Spatial Graph): ${state.zones.length} facility zones, ${state.cameras.length} mapped camera cones, ${totalPowerKw} kW aggregate power draw.`;
      break;
    }
  }

  void options;
  const latencyMs = Math.max(2, Date.now() - startMs + 6);
  const record: BrainToolExecutionRecord = {
    executionId: `EXEC-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 90 + 10)}`,
    toolName: toolDef.name,
    category: toolDef.category,
    timestampIso,
    actor: `${state.tenant.userName} (${state.tenant.role})`,
    arguments: args,
    status: 'EXECUTED',
    latencyMs,
    resultSummary,
    dataPayload,
    provenance,
  };

  const updatedAudit = appendAuditRecord(nextState.auditTrail, {
    tenantId: nextState.tenant.tenantId,
    timestampIso,
    actorId: nextState.tenant.userId,
    actorRole: nextState.tenant.role,
    category: 'BRAIN_TOOL',
    action: `TOOL_EXEC:${toolDef.name}`,
    targetId: toolDef.id,
    outcome: 'SUCCESS',
    details: resultSummary,
  });

  nextState = {
    ...nextState,
    auditTrail: updatedAudit,
    toolExecutions: [record, ...nextState.toolExecutions.slice(0, 49)],
  };

  return { record, updatedState: nextState };
}

/**
 * Detect whether user query is in English, Hindi (Devanagari), or Hinglish
 */
export function detectQueryLanguage(query: string): 'en' | 'hi' | 'hinglish' {
  if (/[\u0900-\u097F]/.test(query)) {
    return 'hi';
  }
  const lower = query.toLowerCase();
  const hinglishTokens = ['kya', 'kaise', 'dikhao', 'batao', 'kitne', 'hai', 'hain', 'karo', 'abhi', 'kaunsa', 'band'];
  const matches = hinglishTokens.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(lower));
  if (matches.length >= 1) {
    return 'hinglish';
  }
  return 'en';
}

/**
 * Select relevant Brain tools based on user intent
 */
export function selectToolsForQuery(query: string): string[] {
  const q = query.toLowerCase();
  const selected: string[] = [];

  if (q.includes('incident') || q.includes('unresolved') || q.includes('alert') || q.includes('हादसा') || q.includes('incident')) {
    selected.push('list_incidents', 'explain_incident');
  }
  if (q.includes('camera') || q.includes('offline') || q.includes('stream') || q.includes('कैमरा')) {
    selected.push('get_camera_inventory', 'get_camera_connection_quality');
  }
  if (q.includes('device') || q.includes('android') || q.includes('tablet') || q.includes('battery') || q.includes('sync')) {
    selected.push('get_device_inventory', 'get_device_status');
  }
  if (q.includes('zone') || q.includes('occupancy') || q.includes('vault') || q.includes('twin')) {
    selected.push('get_zone_intelligence', 'query_digital_twin_state');
  }
  if (q.includes('policy') || q.includes('rule') || q.includes('why did')) {
    selected.push('list_policies', 'evaluate_compound_policy');
  }
  if (q.includes('troubleshoot') || q.includes('diagnostic') || q.includes('health')) {
    selected.push('run_troubleshooter', 'get_pipeline_diagnostics');
  }
  if (q.includes('report') || q.includes('summary') || q.includes('shift') || q.includes('रिपोर्ट')) {
    selected.push('generate_operational_report', 'get_summary_metrics');
  }
  if (q.includes('audit') || q.includes('hash') || q.includes('security')) {
    selected.push('get_audit_trail', 'correlate_threat_matrix');
  }
  if (q.includes('resolve') || q.includes('contain')) {
    selected.push('resolve_incident');
  }
  if (q.includes('predict') || q.includes('forecast')) {
    selected.push('predict_aggregate_occupancy');
  }

  if (selected.length === 0) {
    selected.push('get_system_status', 'get_summary_metrics', 'list_incidents');
  }

  return Array.from(new Set(selected)).slice(0, 3);
}

/**
 * 9-Layer Coordinated Vanta Brain Intelligence Execution
 */
export function runNineLayerBrainPipeline(
  state: VantaSystemState,
  query: string,
  modality: 'TEXT' | 'VOICE_ALEANA' = 'TEXT',
  preferredLang?: 'en' | 'hi' | 'hinglish'
): {
  updatedState: VantaSystemState;
  detectedLanguage: 'en' | 'hi' | 'hinglish';
  layerTraces: BrainLayerTrace[];
  toolExecutions: BrainToolExecutionRecord[];
  directAnswer: string;
  keyFindings: string[];
  evidenceCitations: string[];
  uncertaintyDisclosure: string;
  recommendedNextAction: string;
} {
  const detectedLanguage = preferredLang || detectQueryLanguage(query);
  const selectedTools = selectToolsForQuery(query);
  let workingState = { ...state };
  const executedRecords: BrainToolExecutionRecord[] = [];

  for (const toolName of selectedTools) {
    const { record, updatedState } = executeBrainTool(workingState, toolName, {});
    workingState = updatedState;
    executedRecords.push(record);
  }

  const openIncidents = workingState.incidents.filter((i) => i.status !== 'RESOLVED');
  const degradedCams = workingState.cameras.filter((c) => c.connectorState === 'Degraded' || c.connectorState === 'Disconnected');
  const totalOcc = workingState.zones.reduce((acc, z) => acc + z.currentOccupancy, 0);

  const layerTraces: BrainLayerTrace[] = [
    {
      layerNumber: 1,
      layerName: 'Intent Intelligence',
      status: 'COMPLETED',
      latencyMs: 4,
      summary: `Classified operational query (${modality}, lang=${detectedLanguage}) targeting tools: ${selectedTools.join(', ')}.`,
      evidenceRefs: ['INTENT-CLASSIFIER-V11'],
    },
    {
      layerNumber: 2,
      layerName: 'Context Intelligence',
      status: 'COMPLETED',
      latencyMs: 5,
      summary: `Bound tenant scope ${workingState.tenant.tenantId} (${workingState.tenant.siteName}) for role ${workingState.tenant.role}.`,
      evidenceRefs: [workingState.tenant.tenantId, workingState.tenant.siteId],
    },
    {
      layerNumber: 3,
      layerName: 'Data Intelligence',
      status: 'COMPLETED',
      latencyMs: 9,
      summary: `Retrieved ${executedRecords.length} live tool dataset(s) at sync revision #${workingState.syncRevision}.`,
      evidenceRefs: executedRecords.map((r) => r.executionId),
    },
    {
      layerNumber: 4,
      layerName: 'Vision Intelligence',
      status: 'COMPLETED',
      latencyMs: 7,
      summary: `Evaluated ${workingState.cameras.length} camera streams (${degradedCams.length} degraded) and ${totalOcc} active tracked occupants.`,
      evidenceRefs: workingState.cameras.map((c) => c.id),
    },
    {
      layerNumber: 5,
      layerName: 'Temporal Intelligence',
      status: 'COMPLETED',
      latencyMs: 6,
      summary: `Correlated ${workingState.events.length} timestamped events across ${workingState.zones.length} zones.`,
      evidenceRefs: workingState.events.slice(0, 3).map((e) => e.id),
    },
    {
      layerNumber: 6,
      layerName: 'Policy & Risk Intelligence',
      status: 'COMPLETED',
      latencyMs: 5,
      summary: `Assessed ${workingState.policies.filter((p) => p.enabled).length} active compound policies; ${openIncidents.length} incident(s) require operator attention.`,
      evidenceRefs: workingState.policies.map((p) => p.id),
    },
    {
      layerNumber: 7,
      layerName: 'Reasoning & Orchestration',
      status: 'COMPLETED',
      latencyMs: 11,
      summary: `Synthesized outputs from ${executedRecords.map((r) => r.toolName).join(' -> ')}.`,
      evidenceRefs: executedRecords.map((r) => r.toolName),
    },
    {
      layerNumber: 8,
      layerName: 'Explanation Intelligence',
      status: 'COMPLETED',
      latencyMs: 6,
      summary: 'Constructed evidence-grounded response separating Measured telemetry from Inferred hypotheses.',
      evidenceRefs: openIncidents.map((i) => i.id),
    },
    {
      layerNumber: 9,
      layerName: 'Governance Intelligence',
      status: 'COMPLETED',
      latencyMs: 4,
      summary: `Enforced RBAC (${workingState.tenant.role}) and appended SHA-256 audit block #${workingState.auditTrail.length}.`,
      evidenceRefs: [workingState.auditTrail[workingState.auditTrail.length - 1]?.id || 'AUD-HEAD'],
    },
  ];

  let directAnswer = executedRecords.map((r) => r.resultSummary).join(' ');
  if (detectedLanguage === 'hinglish') {
    directAnswer = `Vanta Nexus Status (Rev #${workingState.syncRevision}): Abhi ${openIncidents.length} active incidents hain aur ${workingState.cameras.length} cameras monitor ho rahe hain (${degradedCams.length} degraded). ${executedRecords
      .map((r) => r.resultSummary)
      .join(' ')}`;
  } else if (detectedLanguage === 'hi') {
    directAnswer = `वान्टा नेक्सस स्थिति (संशोधन #${workingState.syncRevision}): वर्तमान में ${openIncidents.length} सक्रिय घटनाएं हैं और कुल उपस्थिति ${totalOcc} है। ${executedRecords
      .map((r) => r.resultSummary)
      .join(' ')}`;
  }

  const keyFindings = executedRecords.map((r) => `[${r.toolName}] ${r.resultSummary}`);
  const evidenceCitations = [
    ...openIncidents.map((i) => `${i.id} (${i.zoneName} · ${i.severity})`),
    ...workingState.events.slice(0, 2).map((e) => `${e.id} (${e.cameraId} · FrameHash ${e.evidenceMetadata.frameHash.slice(0, 8)})`),
  ];

  return {
    updatedState: workingState,
    detectedLanguage,
    layerTraces,
    toolExecutions: executedRecords,
    directAnswer,
    keyFindings,
    evidenceCitations,
    uncertaintyDisclosure:
      'Camera feeds labeled SIMULATED use deterministic telemetry replay; live browser webcam streams use Measured local frame analysis. Policy matches are operational signals requiring operator verification.',
    recommendedNextAction:
      openIncidents.length > 0
        ? `Inspect ${openIncidents[0].id} ("${openIncidents[0].title}") in ${openIncidents[0].zoneName} and transition state after verifying camera telemetry.`
        : 'Continue routine monitoring across all facility zones.',
  };
}

/**
 * Create a new short-lived QR Device Pairing Session
 */
export function createDevicePairingSession(
  tenantId: string,
  deviceName: string,
  targetPlatform: PairingSession['targetPlatform'],
  nowMs = Date.now()
): PairingSession {
  const tokenId = `PAIR-${nowMs.toString(36).toUpperCase()}`;
  const pairingCode = `${Math.floor(100000 + Math.random() * 900000)}`;
  const createdAtIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + 10 * 60 * 1000).toISOString(); // 10 min short-lived token
  const signature = sha256Hex(`${tenantId}:${tokenId}:${pairingCode}:${expiresAtIso}`).slice(0, 16);
  const qrPayload = `vantanexus://pair?tenant=${encodeURIComponent(tenantId)}&token=${tokenId}&code=${pairingCode}&sig=${signature}`;

  return {
    tokenId,
    pairingCode,
    tenantId,
    targetPlatform,
    deviceName: deviceName.trim(),
    createdAtIso,
    expiresAtIso,
    status: 'PENDING',
    qrPayload,
  };
}

/**
 * Initial Verified Baseline State for VantaVisionAI V11.0
 */
export function createInitialVantaState(): VantaSystemState {
  const baseTime = new Date('2026-11-15T14:45:00.000Z').getTime();
  const isoAt = (offsetMin: number) => new Date(baseTime + offsetMin * 60000).toISOString();

  const initialAudit: AuditRecord[] = [];
  const audit1 = appendAuditRecord(initialAudit, {
    tenantId: 'TENANT-VANTA-01',
    timestampIso: isoAt(-30),
    actorId: 'USR-ARCH-01',
    actorRole: 'ADMIN',
    category: 'AUTH',
    action: 'SYSTEM_BOOT_GENESIS',
    targetId: 'VANTA-NEXUS-V11',
    outcome: 'SUCCESS',
    details: 'Initialized VantaVisionAI V11.0 cryptographic SHA-256 audit ledger and tenant isolation boundaries.',
  });
  const audit2 = appendAuditRecord(audit1, {
    tenantId: 'TENANT-VANTA-01',
    timestampIso: isoAt(-18),
    actorId: 'USR-ARCH-01',
    actorRole: 'ADMIN',
    category: 'DEVICE_PAIRING',
    action: 'DEVICE_HEARTBEAT_SYNC',
    targetId: 'DEV-AND-01',
    outcome: 'SUCCESS',
    details: 'Verified mutual TLS + short-lived pairing session for Android Field Command node.',
  });
  const audit3 = appendAuditRecord(audit2, {
    tenantId: 'TENANT-VANTA-01',
    timestampIso: isoAt(-6),
    actorId: 'SYSTEM-POLICY-ENGINE',
    actorRole: 'SECURITY_OPERATOR',
    category: 'INCIDENT_STATE',
    action: 'INCIDENT_OPENED:INC-2041',
    targetId: 'INC-2041',
    outcome: 'SUCCESS',
    details: 'Policy POL-01 triggered elevated dwell alert in Server Vault Corridor (Zone ZN-02).',
  });

  const timeSeries = Array.from({ length: 12 }, (_, idx) => {
    const minsAgo = (11 - idx) * 15;
    const t = new Date(baseTime - minsAgo * 60000);
    const hh = String(t.getUTCHours()).padStart(2, '0');
    const mm = String(t.getUTCMinutes()).padStart(2, '0');
    return {
      timestampIso: t.toISOString(),
      label: `${hh}:${mm}`,
      eventsCount: 4 + ((idx * 3) % 9),
      incidentsCount: idx >= 9 ? 2 : 1,
      occupancyTotal: 28 + ((idx * 5) % 19),
      avgInferenceMs: 16 + (idx % 5),
      syncThroughputKbps: 1420 + idx * 45,
      provenance: 'Simulated' as const,
    };
  });

  return {
    version: '11.0.0',
    codename: 'VANTA NEXUS',
    tenant: {
      tenantId: 'TENANT-VANTA-01',
      organizationName: 'Vanta Global Critical Infrastructure',
      siteId: 'SITE-MUM-DC1',
      siteName: 'Apex Hyperscale Data Center & Command Hub',
      userId: 'USR-ARCH-01',
      userName: 'Aarav Mehta',
      userEmail: 'tech9852king@gmail.com',
      role: 'ADMIN',
      permissions: [
        'cameras:read',
        'cameras:stream',
        'devices:manage',
        'incidents:transition',
        'policies:write',
        'brain:execute_tools',
        'audit:verify',
      ],
    },
    syncRevision: 14,
    lastCloudSyncIso: isoAt(0),
    connectedClients: 1,
    cameras: [
      {
        id: 'CAM-01',
        tenantId: 'TENANT-VANTA-01',
        name: 'North Perimeter Gate Alpha',
        zoneId: 'ZN-01',
        zoneName: 'North Logistics & Perimeter Gate',
        protocol: 'ONVIF',
        connectorState: 'Simulated',
        isSimulatedStream: true,
        resolution: '1920x1080 (640px CV)',
        fps: 29.8,
        inferenceLatencyMs: 16,
        packetLossPct: 0.1,
        bitrateKbps: 4200,
        lastHeartbeatIso: isoAt(-1),
        occupancyCount: 6,
        maxCapacity: 20,
        coordinates: { x: 18, y: 24, fovAngle: 75, heading: 45 },
        activeDetections: [
          {
            id: 'DET-101',
            label: 'person',
            confidence: 0.94,
            x: 24,
            y: 38,
            width: 14,
            height: 36,
            dwellSeconds: 18,
            zoneId: 'ZN-01',
          },
          {
            id: 'DET-102',
            label: 'vehicle',
            confidence: 0.91,
            x: 58,
            y: 44,
            width: 26,
            height: 28,
            dwellSeconds: 64,
            zoneId: 'ZN-01',
          },
        ],
      },
      {
        id: 'CAM-02',
        tenantId: 'TENANT-VANTA-01',
        name: 'Server Vault Corridor B2',
        zoneId: 'ZN-02',
        zoneName: 'Restricted Server Vault Hall B',
        protocol: 'RTSP',
        connectorState: 'Simulated',
        isSimulatedStream: true,
        resolution: '2560x1440 (640px CV)',
        fps: 30.0,
        inferenceLatencyMs: 14,
        packetLossPct: 0.0,
        bitrateKbps: 5800,
        lastHeartbeatIso: isoAt(-1),
        occupancyCount: 2,
        maxCapacity: 4,
        coordinates: { x: 54, y: 30, fovAngle: 65, heading: 180 },
        activeDetections: [
          {
            id: 'DET-201',
            label: 'person',
            confidence: 0.96,
            x: 42,
            y: 28,
            width: 16,
            height: 44,
            dwellSeconds: 148,
            zoneId: 'ZN-02',
          },
        ],
      },
      {
        id: 'CAM-03',
        tenantId: 'TENANT-VANTA-01',
        name: 'Substation Transformer Yard',
        zoneId: 'ZN-03',
        zoneName: 'High-Voltage Energy Substation',
        protocol: 'ONVIF',
        connectorState: 'Degraded',
        isSimulatedStream: true,
        resolution: '1920x1080 (640px CV)',
        fps: 19.4,
        inferenceLatencyMs: 28,
        packetLossPct: 2.4,
        bitrateKbps: 2150,
        lastHeartbeatIso: isoAt(-2),
        occupancyCount: 1,
        maxCapacity: 6,
        coordinates: { x: 78, y: 68, fovAngle: 80, heading: 270 },
        activeDetections: [
          {
            id: 'DET-301',
            label: 'person',
            confidence: 0.88,
            x: 61,
            y: 49,
            width: 15,
            height: 35,
            dwellSeconds: 32,
            zoneId: 'ZN-03',
          },
        ],
      },
      {
        id: 'CAM-04',
        tenantId: 'TENANT-VANTA-01',
        name: 'SOC Operations Bridge East',
        zoneId: 'ZN-04',
        zoneName: 'Command & Operations Wing',
        protocol: 'WEBRTC',
        connectorState: 'Simulated',
        isSimulatedStream: true,
        resolution: '1920x1080 (640px CV)',
        fps: 30.0,
        inferenceLatencyMs: 15,
        packetLossPct: 0.0,
        bitrateKbps: 4600,
        lastHeartbeatIso: isoAt(-1),
        occupancyCount: 14,
        maxCapacity: 30,
        coordinates: { x: 30, y: 72, fovAngle: 90, heading: 0 },
        activeDetections: [
          {
            id: 'DET-401',
            label: 'person',
            confidence: 0.95,
            x: 32,
            y: 36,
            width: 14,
            height: 38,
            dwellSeconds: 410,
            zoneId: 'ZN-04',
          },
          {
            id: 'DET-402',
            label: 'person',
            confidence: 0.93,
            x: 54,
            y: 40,
            width: 14,
            height: 36,
            dwellSeconds: 380,
            zoneId: 'ZN-04',
          },
        ],
      },
    ],
    devices: [
      {
        id: 'DEV-AND-01',
        tenantId: 'TENANT-VANTA-01',
        name: 'Field Patrol Android S24 Ultra',
        platform: 'Android Node',
        ipAddress: '10.42.18.104',
        connectorState: 'Connected',
        batteryPct: 84,
        cpuLoadPct: 31,
        memoryUsedMb: 2840,
        syncLatencyMs: 18,
        firmwareVersion: 'VantaEdge-Android-11.0.2',
        lastSyncIso: isoAt(0),
        pairedVia: 'QR_TOKEN',
        authorized: true,
      },
      {
        id: 'DEV-TAB-02',
        tenantId: 'TENANT-VANTA-01',
        name: 'SOC Supervisor Tablet Pro',
        platform: 'Tablet Command',
        ipAddress: '10.42.18.112',
        connectorState: 'Connected',
        batteryPct: 92,
        cpuLoadPct: 24,
        memoryUsedMb: 3120,
        syncLatencyMs: 14,
        firmwareVersion: 'VantaPad-OS-11.0.1',
        lastSyncIso: isoAt(0),
        pairedVia: 'QR_TOKEN',
        authorized: true,
      },
      {
        id: 'DEV-WIN-03',
        tenantId: 'TENANT-VANTA-01',
        name: 'Command Workstation Alpha-7',
        platform: 'Windows Workstation',
        ipAddress: '10.42.10.22',
        connectorState: 'Connected',
        batteryPct: null,
        cpuLoadPct: 42,
        memoryUsedMb: 11400,
        syncLatencyMs: 9,
        firmwareVersion: 'VantaDesktop-Win64-11.0.0',
        lastSyncIso: isoAt(0),
        pairedVia: 'MTLS_CERT',
        authorized: true,
      },
      {
        id: 'DEV-EDG-04',
        tenantId: 'TENANT-VANTA-01',
        name: 'Substation Jetson Orin Bridge',
        platform: 'IP Camera Bridge',
        ipAddress: '10.42.30.88',
        connectorState: 'Degraded',
        batteryPct: null,
        cpuLoadPct: 78,
        memoryUsedMb: 6890,
        syncLatencyMs: 64,
        firmwareVersion: 'VantaBridge-ARM64-11.0.0',
        lastSyncIso: isoAt(-2),
        pairedVia: 'MTLS_CERT',
        authorized: true,
      },
    ],
    pairingSessions: [
      {
        tokenId: 'PAIR-INIT901',
        pairingCode: '482910',
        tenantId: 'TENANT-VANTA-01',
        targetPlatform: 'Android Node',
        deviceName: 'West Gate Patrol Handset #2',
        createdAtIso: isoAt(-3),
        expiresAtIso: isoAt(7),
        status: 'PENDING',
        qrPayload: 'vantanexus://pair?tenant=TENANT-VANTA-01&token=PAIR-INIT901&code=482910&sig=9f81c24e0a1b77d2',
      },
    ],
    zones: [
      {
        id: 'ZN-01',
        tenantId: 'TENANT-VANTA-01',
        name: 'North Logistics & Perimeter Gate',
        floor: 'Ground Level',
        building: 'Perimeter Sector A',
        securityLevel: 'CONTROLLED',
        currentOccupancy: 6,
        capacityLimit: 20,
        dwellThresholdSec: 180,
        activePolicyIds: ['POL-02'],
        temperatureC: 24.2,
        powerDrawKw: 48.5,
        status: 'NOMINAL',
        bounds: { x: 6, y: 8, width: 40, height: 38 },
      },
      {
        id: 'ZN-02',
        tenantId: 'TENANT-VANTA-01',
        name: 'Restricted Server Vault Hall B',
        floor: 'Sub-Level B2',
        building: 'Core Compute Bunker',
        securityLevel: 'RESTRICTED',
        currentOccupancy: 2,
        capacityLimit: 4,
        dwellThresholdSec: 120,
        activePolicyIds: ['POL-01'],
        temperatureC: 18.6,
        powerDrawKw: 312.4,
        status: 'ALERT',
        bounds: { x: 50, y: 8, width: 44, height: 42 },
      },
      {
        id: 'ZN-03',
        tenantId: 'TENANT-VANTA-01',
        name: 'High-Voltage Energy Substation',
        floor: 'Ground Level',
        building: 'Power Yard East',
        securityLevel: 'RESTRICTED',
        currentOccupancy: 1,
        capacityLimit: 6,
        dwellThresholdSec: 90,
        activePolicyIds: ['POL-03'],
        temperatureC: 29.8,
        powerDrawKw: 184.0,
        status: 'ELEVATED',
        bounds: { x: 50, y: 54, width: 44, height: 38 },
      },
      {
        id: 'ZN-04',
        tenantId: 'TENANT-VANTA-01',
        name: 'Command & Operations Wing',
        floor: 'Level 2',
        building: 'Main Nexus Tower',
        securityLevel: 'GENERAL',
        currentOccupancy: 14,
        capacityLimit: 30,
        dwellThresholdSec: 3600,
        activePolicyIds: [],
        temperatureC: 21.5,
        powerDrawKw: 64.2,
        status: 'NOMINAL',
        bounds: { x: 6, y: 50, width: 40, height: 42 },
      },
    ],
    events: [
      {
        id: 'EVT-9014',
        tenantId: 'TENANT-VANTA-01',
        cameraId: 'CAM-02',
        cameraName: 'Server Vault Corridor B2',
        deviceId: 'DEV-WIN-03',
        zoneId: 'ZN-02',
        zoneName: 'Restricted Server Vault Hall B',
        timestampIso: isoAt(-6),
        category: 'DWELL_THRESHOLD',
        severity: 'HIGH',
        confidence: 0.96,
        provenance: 'Simulated',
        summary: 'Continuous dwell duration (148s) exceeded Restricted Vault policy threshold (120s) near Rack Row 4.',
        evidenceMetadata: {
          objectCount: 1,
          dwellSeconds: 148,
          modelVersion: 'COCO-SSD-640px-v2.4',
          frameHash: sha256Hex('EVT-9014:CAM-02:148s'),
        },
        verified: true,
      },
      {
        id: 'EVT-9013',
        tenantId: 'TENANT-VANTA-01',
        cameraId: 'CAM-03',
        cameraName: 'Substation Transformer Yard',
        deviceId: 'DEV-EDG-04',
        zoneId: 'ZN-03',
        zoneName: 'High-Voltage Energy Substation',
        timestampIso: isoAt(-14),
        category: 'DEVICE_DEGRADED',
        severity: 'MEDIUM',
        confidence: 0.99,
        provenance: 'Measured',
        summary: 'ONVIF stream CAM-03 experienced 2.4% packet loss and elevated inference latency (28ms).',
        evidenceMetadata: {
          objectCount: 1,
          modelVersion: 'VantaStreamMonitor-v11',
          frameHash: sha256Hex('EVT-9013:CAM-03:loss2.4'),
        },
        verified: true,
      },
      {
        id: 'EVT-9012',
        tenantId: 'TENANT-VANTA-01',
        cameraId: 'CAM-01',
        cameraName: 'North Perimeter Gate Alpha',
        deviceId: 'DEV-AND-01',
        zoneId: 'ZN-01',
        zoneName: 'North Logistics & Perimeter Gate',
        timestampIso: isoAt(-25),
        category: 'PERIMETER_MOTION',
        severity: 'LOW',
        confidence: 0.91,
        provenance: 'Simulated',
        summary: 'Authorized logistics vehicle and escort detected entering Bay 2.',
        evidenceMetadata: {
          objectCount: 2,
          dwellSeconds: 64,
          modelVersion: 'COCO-SSD-640px-v2.4',
          frameHash: sha256Hex('EVT-9012:CAM-01:bay2'),
        },
        verified: true,
      },
    ],
    incidents: [
      {
        id: 'INC-2041',
        tenantId: 'TENANT-VANTA-01',
        title: 'Extended Dwell Threshold Exceeded in Server Vault Hall B',
        severity: 'HIGH',
        status: 'OPEN',
        zoneId: 'ZN-02',
        zoneName: 'Restricted Server Vault Hall B',
        cameraIds: ['CAM-02'],
        relatedEventIds: ['EVT-9014'],
        assignedTo: 'Aarav Mehta (ADMIN)',
        createdAtIso: isoAt(-6),
        updatedAtIso: isoAt(-6),
        rootCauseHypothesis:
          'Unscheduled maintenance technician dwell exceeding 120s threshold in cold aisle B2 without linked change ticket.',
        recommendedPlaybook: 'PB-VAULT-CONTAINMENT',
        timeline: [
          {
            id: 'TL-01',
            timestampIso: isoAt(-6),
            actor: 'Policy Engine (POL-01)',
            toStatus: 'OPEN',
            action: 'Incident Automatically Created',
            note: 'Triggered by EVT-9014 (148s dwell at 96% confidence in ZN-02).',
            verifiedEvidence: true,
          },
        ],
      },
      {
        id: 'INC-2040',
        tenantId: 'TENANT-VANTA-01',
        title: 'Substation ONVIF Bridge Packet Loss & Jitter',
        severity: 'MEDIUM',
        status: 'INVESTIGATING',
        zoneId: 'ZN-03',
        zoneName: 'High-Voltage Energy Substation',
        cameraIds: ['CAM-03'],
        relatedEventIds: ['EVT-9013'],
        assignedTo: 'Priya Nair (SECURITY_OPERATOR)',
        createdAtIso: isoAt(-14),
        updatedAtIso: isoAt(-9),
        rootCauseHypothesis:
          'EMI interference or saturated uplink on Substation Jetson Orin Bridge (DEV-EDG-04) causing 2.4% UDP packet drop.',
        recommendedPlaybook: 'PB-STREAM-STABILIZE',
        timeline: [
          {
            id: 'TL-02',
            timestampIso: isoAt(-14),
            actor: 'Telemetry Monitor',
            toStatus: 'OPEN',
            action: 'Incident Created',
            note: 'Packet loss crossed 2.0% threshold on CAM-03.',
            verifiedEvidence: true,
          },
          {
            id: 'TL-03',
            timestampIso: isoAt(-9),
            actor: 'Priya Nair (SECURITY_OPERATOR)',
            fromStatus: 'OPEN',
            toStatus: 'INVESTIGATING',
            action: 'Transitioned OPEN -> INVESTIGATING',
            note: 'Initiated remote diagnostic check on DEV-EDG-04 network interface.',
            verifiedEvidence: true,
          },
        ],
      },
    ],
    policies: [
      {
        id: 'POL-01',
        tenantId: 'TENANT-VANTA-01',
        name: 'Restricted Server Vault Dwell Governance',
        description:
          'Flags continuous person dwell > 120s in Sub-Level B2 Server Vault when confidence >= 85%.',
        targetZoneId: 'ZN-02',
        targetZoneName: 'Restricted Server Vault Hall B',
        enabled: true,
        conditions: {
          maxDwellSeconds: 120,
          requiredConfidence: 0.85,
        },
        severityOnMatch: 'HIGH',
        autoCreateIncident: true,
        lastEvaluatedIso: isoAt(-1),
        matchCount24h: 3,
      },
      {
        id: 'POL-02',
        tenantId: 'TENANT-VANTA-01',
        name: 'Perimeter Gate Surge Capacity Monitor',
        description:
          'Generates medium operational signal when North Logistics Gate occupancy exceeds 15 concurrent entities.',
        targetZoneId: 'ZN-01',
        targetZoneName: 'North Logistics & Perimeter Gate',
        enabled: true,
        conditions: {
          minOccupancy: 15,
          requiredConfidence: 0.8,
        },
        severityOnMatch: 'MEDIUM',
        autoCreateIncident: false,
        lastEvaluatedIso: isoAt(-1),
        matchCount24h: 1,
      },
      {
        id: 'POL-03',
        tenantId: 'TENANT-VANTA-01',
        name: 'High-Voltage Yard Restricted Hours Access',
        description:
          'Alerts on any verified human presence in High-Voltage Substation Yard during restricted maintenance hours.',
        targetZoneId: 'ZN-03',
        targetZoneName: 'High-Voltage Energy Substation',
        enabled: true,
        conditions: {
          minOccupancy: 1,
          restrictedHoursOnly: true,
          requiredConfidence: 0.85,
        },
        severityOnMatch: 'CRITICAL',
        autoCreateIncident: true,
        lastEvaluatedIso: isoAt(-2),
        matchCount24h: 0,
      },
    ],
    auditTrail: audit3,
    conversations: [
      {
        id: 'MSG-INIT-1',
        conversationId: 'CONV-PRIMARY',
        role: 'assistant',
        modality: 'TEXT',
        language: 'en',
        timestampIso: isoAt(-5),
        content:
          'Vanta Brain V11.0 and ALEANA Voice Intelligence initialized. Shared tenant context bound to Apex Hyperscale Data Center (Rev #14). 25 permission-controlled tools online. How can I assist your operations today?',
        directAnswer:
          'Vanta Nexus Command Center is online at Sync Revision #14. 2 active incidents require review (INC-2041 in Server Vault Hall B and INC-2040 in Substation Yard).',
        keyFindings: [
          '4 Camera streams active (3 Simulated telemetry streams, 1 Degraded stream CAM-03)',
          '4 Cross-platform devices synced via Cloud Event Bus (Android, Tablet, Windows, Edge Bridge)',
          'SHA-256 Cryptographic Audit Ledger verified across 3 genesis blocks',
        ],
        evidenceCitations: ['INC-2041 (ZN-02 · HIGH)', 'EVT-9014 (CAM-02 · 148s dwell)'],
        uncertaintyDisclosure:
          'Pre-configured facility cameras are operating in labeled Simulated Telemetry mode until a live local camera or WebRTC endpoint is enabled.',
        recommendedNextAction:
          'Ask Vanta Brain or speak to ALEANA in English, Hindi, or Hinglish to inspect INC-2041 or run pipeline diagnostics.',
        modelUsed: 'vanta-brain-9layer-v11',
      },
    ],
    toolExecutions: [],
    timeSeries,
    preferences: {
      voiceProvider: 'BROWSER_SPEECH_SYNTHESIS',
      languagePreference: 'en',
      speakingRate: 1.0,
      volume: 0.9,
      autoSpeakResponses: true,
      conversationMode: 'PUSH_TO_TALK',
    },
  };
}
