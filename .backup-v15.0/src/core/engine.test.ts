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
import {
  DEFAULT_DETECTION_FILTER_CONFIG,
  FrameInferenceScheduler,
  TfjsCocoSsdProvider,
  applyNormalizedClassAwareNMS,
  evaluateDetectionEventRules,
  filterPredictionsByConfig,
  mapBoxToCanvasCoordinates,
  updateCameraObjectTracks,
  validateAndNormalizePredictions,
  validateVideoReadiness,
} from './visionPipeline';

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
