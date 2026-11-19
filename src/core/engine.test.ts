import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAIN_TOOLS_REGISTRY,
  appendAuditRecord,
  applyClassAwareNMS,
  buildCorrelationPipelineStages,
  buildDefaultBrainAiDiagnostics,
  buildSceneIntelligenceSummary,
  classifyGeminiError,
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
  validateAndHydrateSystemState,
  validateIncidentTransition,
  verifyAuditChain,
} from './engine';
import {
  ALL_COCO_SSD_CLASSES,
  DEFAULT_DETECTION_FILTER_CONFIG,
  FrameInferenceScheduler,
  TfjsCocoSsdProvider,
  applyNormalizedClassAwareNMS,
  evaluateDetectionEventRules,
  executeFullDetectionPipelinePass,
  filterPredictionsByConfig,
  mapBoxToCanvasCoordinates,
  normalizedToBoundingBoxes,
  updateCameraObjectTracks,
  validateAndNormalizePredictions,
  validateVideoReadiness,
} from './visionPipeline';
import type { NormalizedDetection } from './types';

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

test('Conversation Memory Governance resets conversation while preserving audit ledger and audits retention updates', () => {
  const state = createInitialVantaState();
  const resetState = manageConversationMemory(state, 'RESET_CONVERSATION');
  assert.equal(resetState.conversations.length, 1);
  assert.equal(resetState.memoryGovernance?.conversationTurnCount, 1);
  assert.ok(resetState.memoryGovernance?.lastPurgedIso);
  assert.equal(verifyAuditChain(resetState.auditTrail).valid, true);

  const preRetentionAuditLen = resetState.auditTrail.length;
  const retentionUpdated = manageConversationMemory(resetState, 'UPDATE_RETENTION', 90);
  assert.equal(retentionUpdated.memoryGovernance?.retentionPeriodDays, 90);
  assert.equal(retentionUpdated.auditTrail.length, preRetentionAuditLen + 1);
  assert.equal(verifyAuditChain(retentionUpdated.auditTrail).valid, true);
});

/* ============================================================================
   PART K — V15.0 VISION PIPELINE, TRACKING, COORDINATE MAPPING & EVENT TESTS
   ============================================================================ */

test('V15.0 Video readiness validation rejects null, unready, paused, or zero-dimension video elements', () => {
  assert.equal(validateVideoReadiness(null).ready, false);
  assert.equal(
    validateVideoReadiness({
      readyState: 1,
      videoWidth: 1280,
      videoHeight: 720,
      paused: false,
      ended: false,
    }).ready,
    false
  );
  assert.equal(
    validateVideoReadiness({
      readyState: 4,
      videoWidth: 0,
      videoHeight: 720,
      paused: false,
      ended: false,
    }).ready,
    false
  );
  assert.equal(
    validateVideoReadiness({
      readyState: 4,
      videoWidth: 1280,
      videoHeight: 720,
      paused: true,
      ended: false,
    }).ready,
    false
  );

  const valid = validateVideoReadiness({
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    paused: false,
    ended: false,
  });
  assert.equal(valid.ready, true);
  assert.equal(valid.width, 1280);
  assert.equal(valid.height, 720);
});

test('V15.0 Prediction validation, normalization, confidence/class filtering, and NMS', () => {
  // Empty prediction list
  const empty = validateAndNormalizePredictions([], {
    cameraId: 'CAM-01',
    sourceFrameWidth: 1000,
    sourceFrameHeight: 500,
    provenance: 'REAL_MODEL',
    modelId: 'tfjs-coco-ssd',
    modelVersion: '2.2.3',
    inferenceId: 'INF-EMPTY',
  });
  assert.equal(empty.validDetections.length, 0);
  assert.equal(empty.rejectedCount, 0);

  // Mixed valid and malformed predictions
  const mixed = validateAndNormalizePredictions(
    [
      { class: 'person', score: 0.91, bbox: [100, 50, 200, 300] },
      { class: 'laptop', score: 0.78, bbox: [400, 200, 150, 100] },
      { class: '', score: 0.85, bbox: [10, 10, 50, 50] }, // malformed empty class
      { class: 'person', score: 1.5, bbox: [10, 10, 50, 50] }, // malformed score > 1
      { class: 'car', score: 0.8, bbox: [10, 10, -20, 50] }, // malformed negative width
      null,
    ],
    {
      cameraId: 'CAM-01',
      sourceFrameWidth: 1000,
      sourceFrameHeight: 500,
      provenance: 'REAL_MODEL',
      modelId: 'tfjs-coco-ssd',
      modelVersion: '2.2.3',
      inferenceId: 'INF-MIXED',
    }
  );
  assert.equal(mixed.validDetections.length, 2);
  assert.equal(mixed.rejectedCount, 4);
  assert.equal(mixed.validDetections[0].boundingBox.x, 10);
  assert.equal(mixed.validDetections[0].boundingBox.y, 10);
  assert.equal(mixed.validDetections[0].boundingBox.width, 20);
  assert.equal(mixed.validDetections[0].boundingBox.height, 60);

  // Filter by confidence and class while preserving rawConfidence
  const filtered = filterPredictionsByConfig(mixed.validDetections, {
    ...DEFAULT_DETECTION_FILTER_CONFIG,
    globalMinConfidence: 0.85,
    enabledClasses: ['person'],
  });
  assert.equal(filtered.displayDetections.length, 1);
  assert.equal(filtered.displayDetections[0].className, 'person');
  assert.equal(filtered.displayDetections[0].rawConfidence, 0.91);

  // Class-aware NMS suppresses overlapping boxes of same class but keeps different class
  const overlapping = validateAndNormalizePredictions(
    [
      { class: 'person', score: 0.95, bbox: [100, 100, 200, 300] },
      { class: 'person', score: 0.81, bbox: [105, 102, 200, 300] },
      { class: 'backpack', score: 0.88, bbox: [100, 100, 200, 300] },
    ],
    {
      cameraId: 'CAM-01',
      sourceFrameWidth: 1000,
      sourceFrameHeight: 1000,
      provenance: 'REAL_MODEL',
      modelId: 'tfjs-coco-ssd',
      modelVersion: '2.2.3',
      inferenceId: 'INF-NMS',
    }
  ).validDetections;

  const afterNms = applyNormalizedClassAwareNMS(overlapping, 0.45);
  assert.equal(afterNms.length, 2);
});

test('V15.0 Canvas coordinate mapping handles aspect-ratio letterbox offsets accurately', () => {
  const detection = validateAndNormalizePredictions(
    [{ class: 'person', score: 0.92, bbox: [320, 180, 640, 360] }],
    {
      cameraId: 'CAM-01',
      sourceFrameWidth: 1280,
      sourceFrameHeight: 720,
      provenance: 'REAL_MODEL',
      modelId: 'tfjs-coco-ssd',
      modelVersion: '2.2.3',
      inferenceId: 'INF-MAP',
    }
  ).validDetections[0];

  // Same 16:9 aspect ratio canvas (640x360) -> exact 0.5x scaling, zero letterbox offset
  const mappedExact = mapBoxToCanvasCoordinates(detection.boundingBox, {
    sourceWidth: 1280,
    sourceHeight: 720,
    canvasWidth: 640,
    canvasHeight: 360,
    objectFit: 'contain',
  });
  assert.equal(mappedExact.x, 160);
  assert.equal(mappedExact.y, 90);
  assert.equal(mappedExact.width, 320);
  assert.equal(mappedExact.height, 180);

  // Taller 4:3 container (640x480) displaying 16:9 video with contain -> vertical letterbox offset of 60px
  const mappedLetterbox = mapBoxToCanvasCoordinates(detection.boundingBox, {
    sourceWidth: 1280,
    sourceHeight: 720,
    canvasWidth: 640,
    canvasHeight: 480,
    objectFit: 'contain',
  });
  assert.equal(mappedLetterbox.x, 160);
  assert.equal(mappedLetterbox.y, 150); // 60px top offset + 90px
  assert.equal(mappedLetterbox.width, 320);
  assert.equal(mappedLetterbox.height, 180);
});

test('V15.0 Object tracking maintains stable track IDs across frames and expires stale tracks', () => {
  const frame1Det = validateAndNormalizePredictions(
    [{ class: 'person', score: 0.9, bbox: [200, 200, 100, 200] }],
    {
      cameraId: 'CAM-01',
      sourceFrameWidth: 1000,
      sourceFrameHeight: 1000,
      provenance: 'REAL_MODEL',
      modelId: 'tfjs-coco-ssd',
      modelVersion: '2.2.3',
      inferenceId: 'INF-T1',
      timestampIso: '2026-11-16T00:00:01.000Z',
    }
  ).validDetections;

  const tracks1 = updateCameraObjectTracks([], frame1Det, 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T00:00:01.000Z',
    maxMissedFrames: 2,
  });
  assert.equal(tracks1.length, 1);
  const trackId = tracks1[0].trackId;

  // Frame 2: slight movement -> same trackId preserved
  const frame2Det = validateAndNormalizePredictions(
    [{ class: 'person', score: 0.93, bbox: [210, 205, 100, 200] }],
    {
      cameraId: 'CAM-01',
      sourceFrameWidth: 1000,
      sourceFrameHeight: 1000,
      provenance: 'REAL_MODEL',
      modelId: 'tfjs-coco-ssd',
      modelVersion: '2.2.3',
      inferenceId: 'INF-T2',
      timestampIso: '2026-11-16T00:00:02.000Z',
    }
  ).validDetections;

  const tracks2 = updateCameraObjectTracks(tracks1, frame2Det, 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T00:00:02.000Z',
    maxMissedFrames: 2,
  });
  assert.equal(tracks2.length, 1);
  assert.equal(tracks2[0].trackId, trackId);
  assert.equal(tracks2[0].persistenceFrames, 2);
  assert.equal(tracks2[0].dwellSeconds, 2);

  // Frame 3, 4, 5 with empty detections -> track expires after maxMissedFrames (2)
  const miss1 = updateCameraObjectTracks(tracks2, [], 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T00:00:03.000Z',
    maxMissedFrames: 2,
  });
  assert.equal(miss1.length, 1);

  const miss2 = updateCameraObjectTracks(miss1, [], 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T00:00:04.000Z',
    maxMissedFrames: 2,
  });
  assert.equal(miss2.length, 1);

  const miss3 = updateCameraObjectTracks(miss2, [], 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T00:00:05.000Z',
    maxMissedFrames: 2,
  });
  assert.equal(miss3.length, 0);
});

test('V15.0 FrameInferenceScheduler prevents overlapping inference and enforces cadence', async () => {
  const scheduler = new FrameInferenceScheduler('BALANCED'); // 166ms interval (~6 FPS)
  assert.equal(scheduler.getMinIntervalMs(), 166);
  scheduler.start();

  let executed = 0;
  const r1 = await scheduler.tryScheduleFrame(1000, async () => {
    executed += 1;
  });
  assert.equal(r1.executed, true);
  assert.equal(executed, 1);

  // Calling 100ms later should be throttled (skipped)
  const r2 = await scheduler.tryScheduleFrame(1100, async () => {
    executed += 1;
  });
  assert.equal(r2.executed, false);
  assert.equal(r2.reason, 'CADENCE_THROTTLED');
  assert.equal(scheduler.getStats().skippedFrames, 1);

  // Calling at 1300ms (>= 166ms elapsed) executes
  const r3 = await scheduler.tryScheduleFrame(1300, async () => {
    executed += 1;
  });
  assert.equal(r3.executed, true);
  assert.equal(scheduler.getStats().processedFrames, 2);

  // Pause prevents execution
  scheduler.pause();
  const r4 = await scheduler.tryScheduleFrame(2000, async () => {
    executed += 1;
  });
  assert.equal(r4.executed, false);
  assert.equal(r4.reason, 'SCHEDULER_STOPPED_OR_PAUSED');
});

test('V15.0 TfjsCocoSsdProvider lifecycle handles initialization, detection, failure, and disposal', async () => {
  const mockProvider = new TfjsCocoSsdProvider(async () => ({
    detect: async () => [
      { class: 'person', score: 0.94, bbox: [50, 60, 120, 240] },
    ],
    dispose: () => {},
  }));

  assert.equal(mockProvider.getStatus(), 'UNINITIALIZED');
  const initRes = await mockProvider.initialize();
  assert.equal(initRes.status, 'READY');
  assert.equal(mockProvider.getStatus(), 'READY');
  assert.ok(mockProvider.getModelMetadata().initTimeMs !== null);

  const detResult = await mockProvider.detect(
    { width: 640, height: 360 } as any,
    'CAM-01'
  );
  assert.equal(detResult.rawPredictions.length, 1);
  assert.equal(detResult.rawPredictions[0].class, 'person');

  mockProvider.dispose();
  assert.equal(mockProvider.getStatus(), 'DISPOSED');

  // Test error handling when model loader fails
  const failingProvider = new TfjsCocoSsdProvider(async () => {
    throw new Error('WebGL context lost');
  });
  const failRes = await failingProvider.initialize();
  assert.equal(failRes.status, 'ERROR');
  assert.equal(failingProvider.getStatus(), 'ERROR');
  assert.ok(failRes.error?.includes('WebGL context lost'));
});

test('V15.0 Deterministic detection event rules generate deduplicated events with cooldown and feed Vanta Brain', () => {
  const state = createInitialVantaState();
  const realDetections = validateAndNormalizePredictions(
    [{ class: 'person', score: 0.93, bbox: [100, 100, 180, 320] }],
    {
      cameraId: 'CAM-01',
      sourceFrameWidth: 1280,
      sourceFrameHeight: 720,
      provenance: 'REAL_MODEL',
      modelId: 'tfjs-coco-ssd',
      modelVersion: '2.2.3',
      inferenceId: 'INF-EVT-1',
      timestampIso: '2026-11-16T00:00:10.000Z',
    }
  ).validDetections;

  // Frame 1 + Frame 2 so persistenceFrames >= 2 and dwellSeconds >= 2
  const tracksFrame1 = updateCameraObjectTracks([], realDetections, 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T00:00:10.000Z',
  });
  const tracksFrame2 = updateCameraObjectTracks(tracksFrame1, realDetections, 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T00:00:12.000Z',
  });

  const genEvents1 = evaluateDetectionEventRules(
    tracksFrame2,
    realDetections,
    state.detectionEventRules || [],
    state.events,
    {
      tenantId: state.tenant.tenantId,
      cameraId: 'CAM-01',
      cameraName: 'CAM-01 — North Gate Biometric & Parcel Vestibule',
      deviceId: 'DEV-EDGE-01',
      zoneId: 'ZN-01',
      zoneName: 'Zone A — Main Sovereign Lobby',
      nowIso: '2026-11-16T00:00:12.000Z',
    }
  );
  assert.ok(genEvents1.length >= 1);
  assert.equal(genEvents1[0].provenance, 'Measured');

  // Calling again 2 seconds later within cooldown window suppresses duplicate event
  const genEventsDuplicate = evaluateDetectionEventRules(
    tracksFrame2,
    realDetections,
    state.detectionEventRules || [],
    [...genEvents1, ...state.events],
    {
      tenantId: state.tenant.tenantId,
      cameraId: 'CAM-01',
      cameraName: 'CAM-01 — North Gate Biometric & Parcel Parcel Vestibule',
      deviceId: 'DEV-EDGE-01',
      zoneId: 'ZN-01',
      zoneName: 'Zone A — Main Sovereign Lobby',
      nowIso: '2026-11-16T00:00:14.000Z',
    }
  );
  assert.equal(genEventsDuplicate.length, 0);

  // Vanta Brain uses genuine detection evidence when answering object detection queries
  const stateWithRealDetections = {
    ...state,
    latestNormalizedDetections: realDetections,
    measuredVisionTelemetry: {
      ...state.measuredVisionTelemetry!,
      modelStatus: 'READY' as const,
      inferenceLatencyMs: 19,
      processedFrames: 5,
    },
  };
  const brainRes = runNineLayerBrainPipeline(
    stateWithRealDetections,
    'What objects are currently detected on the cameras?',
    'TEXT'
  );
  assert.ok(brainRes.directAnswer.includes('1 genuine model-inferred detection'));
  assert.ok(brainRes.directAnswer.includes('person'));
});

test('V15.1 Reliability: Concurrent model initialization shares single load, disposed provider blocks reuse, and simulated detections never claim verified=true', async () => {
  let loaderCallCount = 0;
  const concurrentProvider = new TfjsCocoSsdProvider(async () => {
    loaderCallCount += 1;
    await new Promise((r) => setTimeout(r, 25));
    return {
      detect: async () => [{ class: 'person', score: 0.91, bbox: [10, 20, 100, 200] }],
      dispose: () => {},
    };
  });

  // Two concurrent initialize() calls must await the same promise and invoke loader only once
  const [resA, resB] = await Promise.all([
    concurrentProvider.initialize(),
    concurrentProvider.initialize(),
  ]);
  assert.equal(loaderCallCount, 1);
  assert.equal(resA.status, 'READY');
  assert.equal(resB.status, 'READY');

  // Once disposed, provider cannot be reused for initialize() or detect()
  concurrentProvider.dispose();
  assert.equal(concurrentProvider.getStatus(), 'DISPOSED');
  const afterDisposeInit = await concurrentProvider.initialize();
  assert.equal(afterDisposeInit.status, 'DISPOSED');
  assert.ok(afterDisposeInit.error?.includes('disposed'));

  const afterDisposeDetect = await concurrentProvider.detect(
    { width: 640, height: 360 } as any,
    'CAM-01'
  );
  assert.ok(afterDisposeDetect.error?.includes('DISPOSED'));

  // Camera isolation: tracks from CAM-01 are never mutated or merged into CAM-02
  const cam1Det = validateAndNormalizePredictions(
    [{ class: 'person', score: 0.92, bbox: [100, 100, 100, 200] }],
    {
      cameraId: 'CAM-01',
      sourceFrameWidth: 1000,
      sourceFrameHeight: 1000,
      provenance: 'REAL_MODEL',
      modelId: 'tfjs-coco-ssd',
      modelVersion: '2.2.3',
      inferenceId: 'INF-C1',
      timestampIso: '2026-11-16T01:00:00.000Z',
    }
  ).validDetections;
  const cam1Tracks = updateCameraObjectTracks([], cam1Det, 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T01:00:00.000Z',
  });
  const afterCam2Empty = updateCameraObjectTracks(cam1Tracks, [], 'CAM-02', 'ZN-02', {
    nowIso: '2026-11-16T01:00:01.000Z',
  });
  assert.equal(afterCam2Empty.length, 1);
  assert.equal(afterCam2Empty[0].cameraId, 'CAM-01');
  assert.equal(afterCam2Empty[0].occludedFrames, 0);

  // Event verification integrity: SIMULATED_DEMO detections produce verified=false & provenance='Simulated'
  const state = createInitialVantaState();
  const simDetections = validateAndNormalizePredictions(
    [{ class: 'person', score: 0.95, bbox: [100, 100, 180, 320] }],
    {
      cameraId: 'CAM-01',
      sourceFrameWidth: 1280,
      sourceFrameHeight: 720,
      provenance: 'SIMULATED_DEMO',
      modelId: 'sim-fixture',
      modelVersion: '1.0.0',
      inferenceId: 'INF-SIM-1',
      timestampIso: '2026-11-16T01:00:10.000Z',
    }
  ).validDetections;
  const simTracks1 = updateCameraObjectTracks([], simDetections, 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T01:00:10.000Z',
  });
  const simTracks2 = updateCameraObjectTracks(simTracks1, simDetections, 'CAM-01', 'ZN-01', {
    nowIso: '2026-11-16T01:00:13.000Z',
  });
  const simEvents = evaluateDetectionEventRules(
    simTracks2,
    simDetections,
    state.detectionEventRules || [],
    [],
    {
      tenantId: state.tenant.tenantId,
      cameraId: 'CAM-01',
      cameraName: 'CAM-01',
      deviceId: 'DEV-EDGE-01',
      zoneId: 'ZN-01',
      zoneName: 'Zone A',
      nowIso: '2026-11-16T01:00:13.000Z',
    }
  );
  assert.ok(simEvents.length >= 1);
  assert.equal(simEvents[0].provenance, 'Simulated');
  assert.equal(simEvents[0].verified, false);
});

test('V16.0 Vision Pipeline: All 80 COCO-SSD classes enabled by default and executeFullDetectionPipelinePass returns stage-by-stage diagnostics', () => {
  assert.ok(ALL_COCO_SSD_CLASSES.length >= 80);
  assert.equal(DEFAULT_DETECTION_FILTER_CONFIG.enabledClasses.length, ALL_COCO_SSD_CLASSES.length);
  assert.ok(DEFAULT_DETECTION_FILTER_CONFIG.enabledClasses.includes('bottle'));
  assert.ok(DEFAULT_DETECTION_FILTER_CONFIG.enabledClasses.includes('keyboard'));
  assert.ok(DEFAULT_DETECTION_FILTER_CONFIG.enabledClasses.includes('mouse'));
  assert.ok(DEFAULT_DETECTION_FILTER_CONFIG.enabledClasses.includes('cup'));

  const state = createInitialVantaState();
  assert.equal(state.detectionFilterConfig?.enabledClasses.length, ALL_COCO_SSD_CLASSES.length);

  const rawPredictions = [
    { class: 'person', score: 0.92, bbox: [100, 100, 200, 400] as [number, number, number, number] },
    { class: 'person', score: 0.87, bbox: [105, 102, 198, 396] as [number, number, number, number] }, // Overlapping -> suppressed by NMS
    { class: 'bottle', score: 0.65, bbox: [420, 200, 45, 120] as [number, number, number, number] },
    { class: 'cup', score: 0.22, bbox: [500, 220, 40, 50] as [number, number, number, number] }, // Filtered by displayMinConfidence (0.35)
    { class: 'chair', score: 0.80, bbox: [10, 10, -20, 100] as [number, number, number, number] }, // Invalid negative width -> rejected
  ];

  const pass = executeFullDetectionPipelinePass(
    rawPredictions,
    {
      cameraId: 'CAM-01',
      sourceFrameWidth: 1280,
      sourceFrameHeight: 720,
      provenance: 'REAL_MODEL',
      modelId: 'tfjs-coco-ssd',
      modelVersion: '2.2.3',
      inferenceId: 'INF-V16-01',
      timestampIso: '2026-11-18T12:00:00.000Z',
    },
    DEFAULT_DETECTION_FILTER_CONFIG
  );

  assert.equal(pass.diagnostics.rawPredictionsCount, 5);
  assert.equal(pass.diagnostics.validPredictionsCount, 4);
  assert.equal(pass.diagnostics.rejectedPredictionsCount, 1);
  assert.equal(pass.diagnostics.classFilteredCount, 0);
  assert.equal(pass.diagnostics.confidenceFilteredCount, 1);
  assert.equal(pass.diagnostics.nmsSuppressedCount, 1);
  assert.equal(pass.diagnostics.finalDisplayedCount, 2);
  assert.equal(pass.nmsDetections.length, 2);
});

test('V16.0 Model Provider: Bounded retry with exponential backoff prevents uncontrolled loops, manual retry resets backoff, and zero-dimension frames are rejected', async () => {
  let attempts = 0;
  const failingProvider = new TfjsCocoSsdProvider(async () => {
    attempts += 1;
    if (attempts <= 3) {
      throw new Error(`Simulated model load failure #${attempts}`);
    }
    return {
      detect: async () => [{ class: 'person', score: 0.94, bbox: [20, 30, 120, 240] }],
      dispose: () => {},
    };
  });

  // Attempt 1 fails -> sets backoff window
  const r1 = await failingProvider.initialize();
  assert.equal(r1.status, 'ERROR');
  assert.equal(r1.errorCategory, 'MODEL_INIT_FAILED');
  assert.equal(attempts, 1);

  // Automatic retry during backoff window is blocked without invoking loader
  const rBackoff = await failingProvider.initialize();
  assert.equal(rBackoff.status, 'ERROR');
  assert.equal(rBackoff.errorCategory, 'RETRY_BACKOFF_ACTIVE');
  assert.equal(attempts, 1);

  // Manual retry overrides backoff and runs attempt #2
  const r2 = await failingProvider.retryInitialize();
  assert.equal(r2.status, 'ERROR');
  assert.equal(attempts, 2);

  // Another manual retry runs attempt #3 (which fails) and then attempt #4 (which succeeds!)
  const r3 = await failingProvider.retryInitialize();
  assert.equal(r3.status, 'ERROR');
  assert.equal(attempts, 3);

  const r4 = await failingProvider.retryInitialize();
  assert.equal(r4.status, 'READY');
  assert.equal(attempts, 4);

  // Zero-dimension frame must be rejected cleanly with INVALID_FRAME_DIMENSIONS
  const badFrameRes = await failingProvider.detect({ width: 0, height: 0 } as any, 'CAM-01');
  assert.equal(badFrameRes.rawPredictions.length, 0);
  assert.equal(badFrameRes.errorCategory, 'INVALID_FRAME_DIMENSIONS');
});

test('V16.0 Brain & Provenance Governance: Gemini error classification, camera/detection query diagnostics, and seeded device/event integrity', () => {
  const defaultMissingKey = buildDefaultBrainAiDiagnostics(false);
  assert.equal(defaultMissingKey.status, 'GEMINI UNAVAILABLE');
  assert.equal(defaultMissingKey.lastErrorCategory, 'API_KEY_MISSING');
  assert.equal(defaultMissingKey.modelName, 'gemini-4-hydrogen');

  const invalidKey = classifyGeminiError(new Error('401 API_KEY_INVALID unauthorized'));
  assert.equal(invalidKey.status, 'AUTHENTICATION ERROR');
  assert.equal(invalidKey.errorCategory, 'API_KEY_REJECTED');

  const quotaErr = classifyGeminiError(new Error('429 RESOURCE_EXHAUSTED quota exceeded'));
  assert.equal(quotaErr.status, 'QUOTA EXCEEDED');
  assert.equal(quotaErr.errorCategory, 'QUOTA_EXCEEDED');

  const modelErr = classifyGeminiError(new Error('404 model not found'));
  assert.equal(modelErr.status, 'MODEL ERROR');
  assert.equal(modelErr.errorCategory, 'MODEL_UNAVAILABLE');

  // Seeded state integrity: demo devices must never claim 'Connected' without real pairing, and simulated events must have verified=false
  const state = createInitialVantaState();
  for (const dev of state.devices) {
    assert.notEqual(dev.connectorState, 'Connected', `Seeded device ${dev.id} must not claim Connected`);
  }
  for (const evt of state.events) {
    if (evt.provenance === 'Simulated') {
      assert.equal(evt.verified, false, `Simulated event ${evt.id} must not be verified=true`);
    }
  }

  // Hinglish diagnostic query about why camera detection is not working
  const hinglishResp = runNineLayerBrainPipeline(
    state,
    'camera on karne pe kuch bhi detect nahi kar raha hai',
    'TEXT'
  );
  assert.equal(hinglishResp.detectedLanguage, 'hinglish');
  assert.ok(hinglishResp.directAnswer.includes('0 REAL_MODEL detections'));
  assert.ok(hinglishResp.toolExecutions.some((t) => t.toolName === 'get_pipeline_diagnostics'));
  assert.ok(hinglishResp.toolExecutions.some((t) => t.toolName === 'get_camera_inventory'));
});

test('V16.0 State Hydration & Corruption Recovery: validateAndHydrateSystemState recovers corrupted payloads, repairs tampered audit chains, and upgrades legacy class filters', () => {
  // 1. Null or malformed payload falls back cleanly to initial state
  const fallback = validateAndHydrateSystemState(null, { apiKeyConfigured: false });
  assert.equal(fallback.recoveredFromCorruption, true);
  assert.equal(verifyAuditChain(fallback.state.auditTrail).valid, true);

  // 2. Tampered audit chain is detected on boot, recovered to valid genesis chain, and records STATE_AUDIT_RECOVERY_FROM_CORRUPTION
  const baseState = createInitialVantaState();
  const tamperedCandidate = {
    ...baseState,
    detectionFilterConfig: {
      ...DEFAULT_DETECTION_FILTER_CONFIG,
      enabledClasses: ['person', 'car'], // Legacy 2-class subset (< 80)
    },
    devices: baseState.devices.map((d) =>
      d.id === 'DEV-AND-01' ? { ...d, connectorState: 'Connected' } : d
    ),
    auditTrail: baseState.auditTrail.map((r, idx) =>
      idx === 1 ? { ...r, details: 'Corrupted on disk' } : r
    ),
  };

  const hydrated = validateAndHydrateSystemState(tamperedCandidate, {
    apiKeyConfigured: true,
  });
  assert.equal(hydrated.recoveredFromCorruption, true);
  assert.equal(verifyAuditChain(hydrated.state.auditTrail).valid, true);
  assert.ok(
    hydrated.state.auditTrail.some(
      (a) => a.action === 'STATE_AUDIT_RECOVERY_FROM_CORRUPTION'
    )
  );
  // Legacy enabledClasses upgraded to full 80+ COCO-SSD classes
  assert.equal(
    hydrated.state.detectionFilterConfig?.enabledClasses.length,
    ALL_COCO_SSD_CLASSES.length
  );
  // Seeded demo device normalized back to 'Simulated'
  const devAnd01 = hydrated.state.devices.find((d) => d.id === 'DEV-AND-01');
  assert.equal(devAnd01?.connectorState, 'Simulated');

  // 3. Runtime mutations (upgradeLegacyClassFilter: false) preserve intentional custom class subsets and classified Gemini error diagnostics
  const runtimeState = validateAndHydrateSystemState(
    {
      ...baseState,
      detectionFilterConfig: {
        ...DEFAULT_DETECTION_FILTER_CONFIG,
        enabledClasses: ['person', 'car', 'laptop'],
      },
      brainAiDiagnostics: {
        status: 'AUTHENTICATION ERROR',
        geminiConfigured: true,
        modelName: 'gemini-4-hydrogen',
        fallbackModelName: 'vanta-brain-9layer-v16-fallback',
        lastErrorCategory: 'API_KEY_REJECTED',
        lastErrorMessage: 'API key rejected by upstream.',
        lastCheckedIso: '2026-11-19T00:00:00.000Z',
        lastResponseLatencyMs: 42,
        usingFallback: true,
      },
    },
    {
      apiKeyConfigured: true,
      upgradeLegacyClassFilter: false,
    }
  );
  assert.deepEqual(runtimeState.state.detectionFilterConfig?.enabledClasses, [
    'person',
    'car',
    'laptop',
  ]);
  assert.equal(
    runtimeState.state.brainAiDiagnostics?.status,
    'AUTHENTICATION ERROR'
  );
  assert.equal(
    runtimeState.state.brainAiDiagnostics?.lastErrorCategory,
    'API_KEY_REJECTED'
  );
});

test('22. UPIE V3.0 Adversarial Validation: evaluateCompoundPolicyRule rejects NaN/non-finite inputs, executeBrainTool tolerates null args, and updateCameraObjectTracks ignores malformed detections without crashing', () => {
  const state = createInitialVantaState();
  const policy = state.policies[0];

  // 1. NaN confidence or occupancy must never bypass policy thresholds
  const nanConfEval = evaluateCompoundPolicyRule(policy, {
    zoneId: policy.targetZoneId,
    occupancy: 5,
    maxDwellSeconds: 200,
    confidence: Number.NaN,
    isRestrictedHours: true,
  });
  assert.equal(nanConfEval.matched, false);
  assert.ok(nanConfEval.reasons[0].includes('Invalid policy observation parameters'));

  const negOccEval = evaluateCompoundPolicyRule(policy, {
    zoneId: policy.targetZoneId,
    occupancy: -1,
    maxDwellSeconds: 200,
    confidence: 0.95,
    isRestrictedHours: true,
  });
  assert.equal(negOccEval.matched, false);

  // 2. executeBrainTool safely handles null or array args without throwing TypeError
  const nullArgsExec = executeBrainTool(
    state,
    'get_camera_inventory',
    null as unknown as Record<string, unknown>
  );
  assert.equal(nullArgsExec.record.status, 'EXECUTED');
  assert.ok(nullArgsExec.record.resultSummary.includes('Retrieved'));

  // 3. updateCameraObjectTracks and normalizedToBoundingBoxes ignore malformed detection objects
  const malformedDetections = [
    null,
    { bad: true },
    { className: 'person', confidence: 0.9, boundingBox: { x: Number.NaN, y: 10, width: 20, height: 20 } },
    { className: 'person', confidence: 0.9, boundingBox: { x: 10, y: 10, width: 0, height: 20 } },
    {
      detectionId: 'DET-VALID-1',
      className: 'person',
      category: 'PERSON' as const,
      confidence: 0.91,
      boundingBox: { x: 12, y: 15, width: 24, height: 48 },
      frameTimestampIso: new Date().toISOString(),
      cameraId: 'CAM-01',
      modelName: 'COCO-SSD (lite_mobilenet_v2)',
      backend: 'cpu',
      isSimulated: false,
    },
  ] as unknown as NormalizedDetection[];

  const tracks = updateCameraObjectTracks([], malformedDetections, 'CAM-01', 'ZONE-A');
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].label, 'person');

  const boxes = normalizedToBoundingBoxes(malformedDetections, tracks, 'ZONE-A');
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].label, 'person');

  // 4. executeAutonomousWorkflow blocks ANALYST from approving consequential workflows (WF-04)
  const analystState = {
    ...state,
    tenant: { ...state.tenant, role: 'ANALYST' as const },
  };
  const analystApproveRes = executeAutonomousWorkflow(analystState, 'WF-04', true);
  assert.ok(analystApproveRes.error?.includes('not authorized to approve consequential workflows'));
});
