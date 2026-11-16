import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAIN_TOOLS_REGISTRY,
  appendAuditRecord,
  applyClassAwareNMS,
  buildCorrelationPipelineStages,
  buildSceneIntelligenceSummary,
  computeIoU,
  createDevicePairingSession,
  createInitialVantaState,
  detectQueryLanguage,
  evaluateCompoundPolicyRule,
  executeAutonomousWorkflow,
  executeBrainTool,
  manageConversationMemory,
  runNineLayerBrainPipeline,
  sha256Hex,
  transitionIncidentState,
  updateObjectTracks,
  validateIncidentTransition,
  verifyAuditChain,
} from './engine';

test('SHA-256 hash chain verifies valid records and detects tampering', () => {
  const state = createInitialVantaState();
  const initialCheck = verifyAuditChain(state.auditTrail);
  assert.equal(initialCheck.valid, true);
  assert.equal(initialCheck.checkedCount, 3);

  const appended = appendAuditRecord(state.auditTrail, {
    tenantId: state.tenant.tenantId,
    actorId: 'USR-ARCH-01',
    actorRole: 'ADMIN',
    category: 'CLOUD_SYNC',
    action: 'MULTI_DEVICE_SYNC_CHECK',
    targetId: 'DEV-AND-01',
    outcome: 'SUCCESS',
    details: 'Synchronized revision #15 across nodes.',
  });
  const afterAppendCheck = verifyAuditChain(appended);
  assert.equal(afterAppendCheck.valid, true);
  assert.equal(afterAppendCheck.checkedCount, 4);

  // Simulate tampering on record #2
  const tampered = appended.map((r, idx) =>
    idx === 1 ? { ...r, details: 'Tampered payload' } : r
  );
  const tamperedCheck = verifyAuditChain(tampered);
  assert.equal(tamperedCheck.valid, false);
  assert.equal(tamperedCheck.brokenAtSequence, 2);
});

test('Incident state machine enforces valid transitions, evidence notes, and RBAC', () => {
  const state = createInitialVantaState();
  const openIncident = state.incidents.find((i) => i.status === 'OPEN')!;

  // Illegal jump directly from OPEN to RESOLVED without containment/investigation
  const illegalJump = validateIncidentTransition('OPEN', 'RESOLVED', 'ADMIN', 'Attempting direct close');
  assert.equal(illegalJump.allowed, false);

  // Auditor role is read-only
  const auditorBlocked = validateIncidentTransition('OPEN', 'INVESTIGATING', 'AUDITOR', 'Auditor note here');
  assert.equal(auditorBlocked.allowed, false);

  // Missing evidence note rejected
  const shortNote = validateIncidentTransition('OPEN', 'INVESTIGATING', 'ADMIN', 'ok');
  assert.equal(shortNote.allowed, false);

  // Valid transition OPEN -> INVESTIGATING -> RESOLVED
  const step1 = transitionIncidentState(
    openIncident,
    'INVESTIGATING',
    'Aarav Mehta',
    'ADMIN',
    'Inspected CAM-02 bounding box telemetry and dispatched security escort.'
  );
  assert.ok(step1.updatedIncident);
  assert.equal(step1.updatedIncident.status, 'INVESTIGATING');

  const step2 = transitionIncidentState(
    step1.updatedIncident,
    'RESOLVED',
    'Aarav Mehta',
    'ADMIN',
    'Verified technician badge and closed maintenance window.'
  );
  assert.ok(step2.updatedIncident);
  assert.equal(step2.updatedIncident.status, 'RESOLVED');
  assert.equal(step2.updatedIncident.timeline.length, 3);
});

test('Compound policy evaluator explains matches and includes governance disclaimer', () => {
  const state = createInitialVantaState();
  const vaultPolicy = state.policies.find((p) => p.id === 'POL-01')!;

  const matchResult = evaluateCompoundPolicyRule(vaultPolicy, {
    zoneId: 'ZN-02',
    occupancy: 2,
    maxDwellSeconds: 150,
    confidence: 0.94,
    isRestrictedHours: true,
  });
  assert.equal(matchResult.matched, true);
  assert.ok(matchResult.governanceDisclaimer.includes('Operational Signal Only'));

  const lowConfidenceResult = evaluateCompoundPolicyRule(vaultPolicy, {
    zoneId: 'ZN-02',
    occupancy: 2,
    maxDwellSeconds: 150,
    confidence: 0.6,
    isRestrictedHours: true,
  });
  assert.equal(lowConfidenceResult.matched, false);
});

test('Brain tool registry contains all 25 required tools and enforces RBAC + audit logging', () => {
  assert.equal(BRAIN_TOOLS_REGISTRY.length, 25);

  const state = createInitialVantaState();
  const { record, updatedState } = executeBrainTool(state, 'get_system_status', {});
  assert.equal(record.status, 'EXECUTED');
  assert.equal(updatedState.auditTrail.length, state.auditTrail.length + 1);
  assert.equal(verifyAuditChain(updatedState.auditTrail).valid, true);

  // Test RBAC denial when AUDITOR attempts consequential tool resolve_incident
  const auditorState = {
    ...updatedState,
    tenant: { ...updatedState.tenant, role: 'AUDITOR' as const },
  };
  const denied = executeBrainTool(auditorState, 'resolve_incident', { incidentId: 'INC-2041' });
  assert.equal(denied.record.status, 'DENIED');
});

test('9-layer Vanta Brain pipeline executes tools, epistemic breakdown, and supports English, Hindi, and Hinglish', () => {
  assert.equal(detectQueryLanguage('Show me unresolved incidents'), 'en');
  assert.equal(detectQueryLanguage('Abhi kitne cameras aur incidents active hain dikhao'), 'hinglish');
  assert.equal(detectQueryLanguage('सक्रिय घटनाओं की रिपोर्ट दिखाएं'), 'hi');

  const state = createInitialVantaState();
  const result = runNineLayerBrainPipeline(
    state,
    'Abhi kitne incidents active hain aur camera status kya hai?',
    'VOICE_ALEANA'
  );
  assert.equal(result.detectedLanguage, 'hinglish');
  assert.equal(result.layerTraces.length, 9);
  assert.ok(result.toolExecutions.length >= 1);
  assert.equal(result.epistemicBreakdown.length, 4);
  assert.ok(result.directAnswer.includes('Vanta Nexus Status'));
});

test('Multi-device QR pairing session generates signed payload and deterministic SHA-256', () => {
  const session = createDevicePairingSession('TENANT-VANTA-01', 'Patrol Tablet Alpha', 'Tablet Command');
  assert.equal(session.status, 'PENDING');
  assert.equal(session.pairingCode.length, 6);
  assert.ok(session.qrPayload.startsWith('vantanexus://pair?'));
  assert.equal(sha256Hex('vanta').length, 64);
});

test('Vision 2.0 Class-Aware NMS, Centroid/IoU Tracking, and Non-Biometric Scene Summary', () => {
  const iouIdentical = computeIoU(
    { x: 10, y: 10, width: 20, height: 20 },
    { x: 10, y: 10, width: 20, height: 20 }
  );
  assert.equal(iouIdentical, 1);

  const nmsResult = applyClassAwareNMS(
    [
      { id: 'D1', label: 'person', confidence: 0.95, x: 20, y: 30, width: 15, height: 35, dwellSeconds: 10, zoneId: 'ZN-01' },
      { id: 'D2', label: 'person', confidence: 0.82, x: 21, y: 31, width: 15, height: 35, dwellSeconds: 10, zoneId: 'ZN-01' },
      { id: 'D3', label: 'vehicle', confidence: 0.91, x: 20, y: 30, width: 15, height: 35, dwellSeconds: 5, zoneId: 'ZN-01' },
    ],
    0.5,
    0.5
  );
  // Overlapping 'person' D2 suppressed, 'vehicle' D3 retained due to class-aware NMS
  assert.equal(nmsResult.length, 2);

  const state = createInitialVantaState();
  const cam1 = state.cameras[0];
  const updatedTracks = updateObjectTracks(state.activeTracks || [], cam1.activeDetections, cam1.id, cam1.zoneId);
  assert.ok(updatedTracks.length >= 4);
  assert.ok(updatedTracks.every((t) => t.isBiometric === false));

  const summary = buildSceneIntelligenceSummary(cam1, updatedTracks);
  assert.equal(summary.cameraId, 'CAM-01');
  assert.ok(summary.safetyGuarantee.includes('Zero-Biometric Enforcement'));
});

test('9-Stage Event Correlation Pipeline and Autonomous Workflow Human Approval Boundary', () => {
  const state = createInitialVantaState();
  const stages = buildCorrelationPipelineStages(state);
  assert.equal(stages.length, 9);
  assert.equal(stages[0].stageName, 'Vision Metadata');
  assert.equal(stages[8].stageName, 'Authorized Workflow');

  // Read-only workflow WF-01 completes immediately without human approval gate
  const wf1Res = executeAutonomousWorkflow(state, 'WF-01', false);
  assert.equal(wf1Res.workflow?.status, 'COMPLETED');

  // Consequential workflow WF-04 requires human approval when approvedByHuman = true
  const wf4Approved = executeAutonomousWorkflow(wf1Res.updatedState, 'WF-04', true);
  assert.equal(wf4Approved.workflow?.status, 'COMPLETED');

  // AUDITOR role cannot execute workflows
  const auditorState = {
    ...state,
    tenant: { ...state.tenant, role: 'AUDITOR' as const },
  };
  const blocked = executeAutonomousWorkflow(auditorState, 'WF-01', false);
  assert.ok(blocked.error?.includes('AUDITOR'));
});

test('Conversation Memory Governance resets conversation while preserving audit ledger', () => {
  const state = createInitialVantaState();
  const resetState = manageConversationMemory(state, 'RESET_CONVERSATION');
  assert.equal(resetState.conversations.length, 1);
  assert.equal(resetState.memoryGovernance?.conversationTurnCount, 1);
  assert.ok(resetState.memoryGovernance?.lastPurgedIso);
  assert.equal(verifyAuditChain(resetState.auditTrail).valid, true);

  const retentionUpdated = manageConversationMemory(resetState, 'UPDATE_RETENTION', 90);
  assert.equal(retentionUpdated.memoryGovernance?.retentionPeriodDays, 90);
});

