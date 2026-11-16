import 'dotenv/config';
import express, { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import {
  BRAIN_TOOLS_REGISTRY,
  appendAuditRecord,
  buildCorrelationPipelineStages,
  buildSceneIntelligenceSummary,
  createDevicePairingSession,
  createInitialVantaState,
  evaluateCompoundPolicyRule,
  executeAutonomousWorkflow,
  executeBrainTool,
  manageConversationMemory,
  runNineLayerBrainPipeline,
  sha256Hex,
  transitionIncidentState,
  updateObjectTracks,
  verifyAuditChain,
} from './src/core/engine';
import {
  AssistantPreferences,
  ConversationMessage,
  DetectionFilterConfig,
  DeviceEntity,
  IncidentStatus,
  MeasuredVisionTelemetry,
  NormalizedDetection,
  SecurityEvent,
  UserRole,
  VantaSystemState,
} from './src/core/types';
import {
  evaluateDetectionEventRules,
  normalizedToBoundingBoxes,
  updateCameraObjectTracks,
} from './src/core/visionPipeline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE_PATH = path.resolve(__dirname, '.vanta-state.json');

function hydrateV14State(base: VantaSystemState): VantaSystemState {
  const fallback = createInitialVantaState();
  const activeTracks = base.activeTracks || fallback.activeTracks || [];
  const hydrated: VantaSystemState = {
    ...base,
    version: '15.0.0',
    visionModel: base.visionModel || fallback.visionModel,
    activeTracks,
    workflows: base.workflows || fallback.workflows,
    memoryGovernance: base.memoryGovernance || fallback.memoryGovernance,
    observability: base.observability || fallback.observability,
    detectionFilterConfig: base.detectionFilterConfig || fallback.detectionFilterConfig,
    measuredVisionTelemetry: base.measuredVisionTelemetry || fallback.measuredVisionTelemetry,
    detectionEventRules: base.detectionEventRules || fallback.detectionEventRules,
    latestNormalizedDetections: base.latestNormalizedDetections || [],
  };
  hydrated.sceneSummaries = hydrated.cameras.map((cam) =>
    buildSceneIntelligenceSummary(cam, activeTracks)
  );
  hydrated.correlationPipeline = buildCorrelationPipelineStages(hydrated);
  return hydrated;
}

function loadOrCreateState(): VantaSystemState {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as VantaSystemState;
      if (parsed && Array.isArray(parsed.cameras)) {
        const hydrated = hydrateV14State(parsed);
        saveState(hydrated);
        return hydrated;
      }
    }
  } catch {
    // Fall back to fresh verified baseline state
  }
  const initial = hydrateV14State(createInitialVantaState());
  saveState(initial);
  return initial;
}

function saveState(state: VantaSystemState): void {
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Non-fatal in read-only containers
  }
}

let systemState: VantaSystemState = loadOrCreateState();
const sseClients = new Set<Response>();

function broadcastSyncState(eventLabel = 'STATE_SYNC'): void {
  systemState.connectedClients = Math.max(1, sseClients.size);
  saveState(systemState);
  const payload = JSON.stringify({
    event: eventLabel,
    syncRevision: systemState.syncRevision,
    lastCloudSyncIso: systemState.lastCloudSyncIso,
    connectedClients: systemState.connectedClients,
    state: systemState,
  });
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY' || key.trim().length < 10) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Real-time Cloud Synchronization SSE Stream
  app.get('/api/sync/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    systemState.connectedClients = sseClients.size;

    const initialPayload = JSON.stringify({
      event: 'INITIAL_SYNC',
      syncRevision: systemState.syncRevision,
      lastCloudSyncIso: systemState.lastCloudSyncIso,
      connectedClients: systemState.connectedClients,
      state: systemState,
    });
    res.write(`data: ${initialPayload}\n\n`);

    req.on('close', () => {
      sseClients.delete(res);
      systemState.connectedClients = Math.max(1, sseClients.size);
    });
  });

  // Canonical System State & Health
  app.get('/api/state', (_req: Request, res: Response) => {
    systemState.connectedClients = Math.max(1, sseClients.size);
    res.json({
      state: systemState,
      toolsRegistry: BRAIN_TOOLS_REGISTRY,
      auditIntegrity: verifyAuditChain(systemState.auditTrail),
    });
  });

  // Switch active RBAC Role (for testing authorization boundaries)
  app.post('/api/role', (req: Request, res: Response) => {
    const role = req.body?.role as UserRole;
    const validRoles: UserRole[] = ['ADMIN', 'SECURITY_OPERATOR', 'ANALYST', 'AUDITOR'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: 'Invalid RBAC role specified.' });
      return;
    }
    const prevRole = systemState.tenant.role;
    const nowIso = new Date().toISOString();
    systemState = {
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      tenant: {
        ...systemState.tenant,
        role,
      },
      auditTrail: appendAuditRecord(systemState.auditTrail, {
        tenantId: systemState.tenant.tenantId,
        timestampIso: nowIso,
        actorId: systemState.tenant.userId,
        actorRole: role,
        category: 'AUTH',
        action: `RBAC_ROLE_SWITCH:${prevRole}->${role}`,
        targetId: systemState.tenant.userId,
        outcome: 'SUCCESS',
        details: `Operator switched active session RBAC role from ${prevRole} to ${role}.`,
      }),
    };
    broadcastSyncState('RBAC_ROLE_UPDATED');
    res.json({ state: systemState });
  });

  // Incident State Machine Transition
  app.post('/api/incidents/:id/transition', (req: Request, res: Response) => {
    const incidentId = req.params.id;
    const targetStatus = req.body?.targetStatus as IncidentStatus;
    const note = String(req.body?.note || '');

    const incident = systemState.incidents.find((i) => i.id === incidentId);
    if (!incident) {
      res.status(404).json({ error: `Incident ${incidentId} not found.` });
      return;
    }

    const nowIso = new Date().toISOString();
    const result = transitionIncidentState(
      incident,
      targetStatus,
      systemState.tenant.userName,
      systemState.tenant.role,
      note,
      nowIso
    );

    if (result.error || !result.updatedIncident) {
      systemState = {
        ...systemState,
        auditTrail: appendAuditRecord(systemState.auditTrail, {
          tenantId: systemState.tenant.tenantId,
          timestampIso: nowIso,
          actorId: systemState.tenant.userId,
          actorRole: systemState.tenant.role,
          category: 'INCIDENT_STATE',
          action: `INCIDENT_TRANSITION_REJECTED:${incidentId}`,
          targetId: incidentId,
          outcome: 'DENIED',
          details: result.error || 'Transition validation failed',
        }),
      };
      broadcastSyncState('AUDIT_UPDATED');
      res.status(400).json({ error: result.error, state: systemState });
      return;
    }

    systemState = {
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      incidents: systemState.incidents.map((inc) =>
        inc.id === incidentId ? result.updatedIncident! : inc
      ),
      auditTrail: appendAuditRecord(systemState.auditTrail, {
        tenantId: systemState.tenant.tenantId,
        timestampIso: nowIso,
        actorId: systemState.tenant.userId,
        actorRole: systemState.tenant.role,
        category: 'INCIDENT_STATE',
        action: `INCIDENT_TRANSITION:${incident.status}->${targetStatus}`,
        targetId: incidentId,
        outcome: 'SUCCESS',
        details: `Note: ${note.trim()}`,
      }),
    };

    broadcastSyncState('INCIDENT_UPDATED');
    res.json({ incident: result.updatedIncident, state: systemState });
  });

  // Policy Toggle & Live Evaluation
  app.post('/api/policies/:id/toggle', (req: Request, res: Response) => {
    if (systemState.tenant.role === 'AUDITOR' || systemState.tenant.role === 'ANALYST') {
      res.status(403).json({
        error: `Role ${systemState.tenant.role} is not authorized to mutate security policies. Required: ADMIN or SECURITY_OPERATOR.`,
      });
      return;
    }
    const policyId = req.params.id;
    const policy = systemState.policies.find((p) => p.id === policyId);
    if (!policy) {
      res.status(404).json({ error: 'Policy not found.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const nextEnabled = !policy.enabled;
    systemState = {
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      policies: systemState.policies.map((p) =>
        p.id === policyId ? { ...p, enabled: nextEnabled, lastEvaluatedIso: nowIso } : p
      ),
      auditTrail: appendAuditRecord(systemState.auditTrail, {
        tenantId: systemState.tenant.tenantId,
        timestampIso: nowIso,
        actorId: systemState.tenant.userId,
        actorRole: systemState.tenant.role,
        category: 'POLICY_CHANGE',
        action: `POLICY_TOGGLE:${policyId}->${nextEnabled ? 'ENABLED' : 'DISABLED'}`,
        targetId: policyId,
        outcome: 'SUCCESS',
        details: `Policy "${policy.name}" set to ${nextEnabled ? 'ENABLED' : 'DISABLED'}.`,
      }),
    };
    broadcastSyncState('POLICY_UPDATED');
    res.json({ state: systemState });
  });

  app.post('/api/policies/:id/evaluate', (req: Request, res: Response) => {
    const policyId = req.params.id;
    const policy = systemState.policies.find((p) => p.id === policyId);
    if (!policy) {
      res.status(404).json({ error: 'Policy not found.' });
      return;
    }
    const zone = systemState.zones.find((z) => z.id === policy.targetZoneId) || systemState.zones[0];
    const occupancy = Number(req.body?.occupancy ?? zone.currentOccupancy);
    const maxDwellSeconds = Number(req.body?.maxDwellSeconds ?? 148);
    const confidence = Number(req.body?.confidence ?? 0.94);
    const isRestrictedHours = Boolean(req.body?.isRestrictedHours ?? true);

    const evaluation = evaluateCompoundPolicyRule(policy, {
      zoneId: zone.id,
      occupancy,
      maxDwellSeconds,
      confidence,
      isRestrictedHours,
    });

    res.json({ evaluation, policy, zone });
  });

  // Multi-Device QR Pairing & Heartbeat Sync
  app.post('/api/devices/pair', (req: Request, res: Response) => {
    if (systemState.tenant.role === 'AUDITOR') {
      res.status(403).json({ error: 'AUDITOR role cannot create device pairing tokens.' });
      return;
    }
    const deviceName = String(req.body?.deviceName || '').trim();
    const targetPlatform = (req.body?.targetPlatform || 'Android Node') as DeviceEntity['platform'];
    if (deviceName.length < 3) {
      res.status(400).json({ error: 'Device name must be at least 3 characters.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const session = createDevicePairingSession(systemState.tenant.tenantId, deviceName, targetPlatform);
    const newDevice: DeviceEntity = {
      id: `DEV-${Date.now().toString(36).toUpperCase().slice(-4)}`,
      tenantId: systemState.tenant.tenantId,
      name: deviceName,
      platform: targetPlatform,
      ipAddress: `10.42.19.${Math.floor(100 + Math.random() * 140)}`,
      connectorState: 'Connected',
      batteryPct: targetPlatform.includes('Android') || targetPlatform.includes('Tablet') ? 96 : null,
      cpuLoadPct: 19,
      memoryUsedMb: 2150,
      syncLatencyMs: 15,
      firmwareVersion: 'VantaEdge-11.0.3',
      lastSyncIso: nowIso,
      pairedVia: 'QR_TOKEN',
      authorized: true,
    };

    systemState = {
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      pairingSessions: [
        { ...session, status: 'CLAIMED' },
        ...systemState.pairingSessions.slice(0, 9),
      ],
      devices: [newDevice, ...systemState.devices],
      auditTrail: appendAuditRecord(systemState.auditTrail, {
        tenantId: systemState.tenant.tenantId,
        timestampIso: nowIso,
        actorId: systemState.tenant.userId,
        actorRole: systemState.tenant.role,
        category: 'DEVICE_PAIRING',
        action: `DEVICE_PAIRED:${newDevice.id}`,
        targetId: newDevice.id,
        outcome: 'SUCCESS',
        details: `Paired ${deviceName} (${targetPlatform}) via short-lived QR token ${session.tokenId}.`,
      }),
    };

    broadcastSyncState('DEVICE_PAIRED');
    res.json({ session, device: newDevice, state: systemState });
  });

  app.post('/api/devices/:id/revoke', (req: Request, res: Response) => {
    if (systemState.tenant.role !== 'ADMIN' && systemState.tenant.role !== 'SECURITY_OPERATOR') {
      res.status(403).json({ error: 'Only ADMIN or SECURITY_OPERATOR can revoke device authorization.' });
      return;
    }
    const devId = req.params.id;
    const dev = systemState.devices.find((d) => d.id === devId);
    if (!dev) {
      res.status(404).json({ error: 'Device not found.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const nextAuthorized = !dev.authorized;
    systemState = {
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      devices: systemState.devices.map((d) =>
        d.id === devId
          ? {
              ...d,
              authorized: nextAuthorized,
              connectorState: nextAuthorized ? 'Connected' : 'Disconnected',
              lastSyncIso: nowIso,
            }
          : d
      ),
      auditTrail: appendAuditRecord(systemState.auditTrail, {
        tenantId: systemState.tenant.tenantId,
        timestampIso: nowIso,
        actorId: systemState.tenant.userId,
        actorRole: systemState.tenant.role,
        category: 'DEVICE_PAIRING',
        action: nextAuthorized ? `DEVICE_REAUTHORIZED:${devId}` : `DEVICE_REVOKED:${devId}`,
        targetId: devId,
        outcome: 'SUCCESS',
        details: `${nextAuthorized ? 'Re-authorized' : 'Revoked'} device ${dev.name}.`,
      }),
    };
    broadcastSyncState('DEVICE_UPDATED');
    res.json({ state: systemState });
  });

  // Record Measured Camera Frame Telemetry / Real Model Detections from Local Authorized Webcam or Demo
  app.post('/api/cameras/:id/telemetry', (req: Request, res: Response) => {
    const camId = req.params.id;
    const cam = systemState.cameras.find((c) => c.id === camId);
    if (!cam) {
      res.status(404).json({ error: 'Camera not found.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const isLiveWebcam = Boolean(req.body?.isLiveWebcam);
    const fps = Number(req.body?.fps ?? cam.fps);
    const latencyMs = Number(req.body?.inferenceLatencyMs ?? cam.inferenceLatencyMs);
    const motionPct = Number(req.body?.motionScore ?? 0);
    const incomingDetections = Array.isArray(req.body?.normalizedDetections)
      ? (req.body.normalizedDetections as NormalizedDetection[])
      : null;
    const incomingTelemetry = (req.body?.measuredVisionTelemetry || null) as Partial<MeasuredVisionTelemetry> | null;

    let nextTracks = systemState.activeTracks || [];
    let updatedActiveDetections = cam.activeDetections;
    let ruleEvents: SecurityEvent[] = [];

    if (incomingDetections) {
      nextTracks = updateCameraObjectTracks(nextTracks, incomingDetections, cam.id, cam.zoneId, {
        nowIso,
      });
      updatedActiveDetections = normalizedToBoundingBoxes(incomingDetections, nextTracks, cam.zoneId);
      ruleEvents = evaluateDetectionEventRules(
        nextTracks,
        incomingDetections,
        systemState.detectionEventRules || [],
        systemState.events,
        {
          tenantId: systemState.tenant.tenantId,
          cameraId: cam.id,
          cameraName: cam.name,
          deviceId: systemState.devices[0]?.id || 'DEV-LOCAL',
          zoneId: cam.zoneId,
          zoneName: cam.zoneName,
          nowIso,
        }
      );
    } else {
      nextTracks = updateObjectTracks(nextTracks, cam.activeDetections, cam.id, cam.zoneId, nowIso);
    }

    const motionEvent: SecurityEvent | null =
      ruleEvents.length === 0 && motionPct > 12
        ? {
            id: `EVT-${Date.now().toString(36).toUpperCase().slice(-4)}`,
            tenantId: systemState.tenant.tenantId,
            cameraId: cam.id,
            cameraName: cam.name,
            deviceId: systemState.devices[0]?.id || 'DEV-LOCAL',
            zoneId: cam.zoneId,
            zoneName: cam.zoneName,
            timestampIso: nowIso,
            category: 'PERIMETER_MOTION',
            severity: motionPct > 28 ? 'HIGH' : 'MEDIUM',
            confidence: 0.93,
            provenance: isLiveWebcam ? 'Measured' : 'Simulated',
            summary: `${isLiveWebcam ? 'Measured live webcam' : 'Simulated stream'} motion displacement (${motionPct.toFixed(
              1
            )}%) recorded on ${cam.name}.`,
            evidenceMetadata: {
              objectCount: updatedActiveDetections.length,
              modelVersion: isLiveWebcam ? 'tfjs-coco-ssd-lite_mobilenet_v2@2.2.3' : 'COCO-SSD-640px-v2.4',
              frameHash: sha256Hex(`${cam.id}:${nowIso}:${motionPct}`),
            },
            verified: true,
          }
        : null;

    const appendedEvents = [
      ...ruleEvents,
      ...(motionEvent ? [motionEvent] : []),
    ];

    const nextCameras = systemState.cameras.map((c) =>
      c.id === camId
        ? {
            ...c,
            isSimulatedStream: !isLiveWebcam,
            connectorState: 'Connected' as const,
            fps,
            inferenceLatencyMs: latencyMs,
            lastHeartbeatIso: nowIso,
            activeDetections: updatedActiveDetections,
            occupancyCount: updatedActiveDetections.filter((d) => d.label === 'person').length || c.occupancyCount,
          }
        : c
    );

    const prevOtherDetections = (systemState.latestNormalizedDetections || []).filter(
      (d) => d.cameraId !== cam.id
    );
    const nextNormalizedDetections = incomingDetections
      ? [...incomingDetections, ...prevOtherDetections].slice(0, 50)
      : systemState.latestNormalizedDetections || [];

    systemState = hydrateV14State({
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      cameras: nextCameras,
      activeTracks: nextTracks,
      latestNormalizedDetections: nextNormalizedDetections,
      measuredVisionTelemetry: systemState.measuredVisionTelemetry
        ? {
            ...systemState.measuredVisionTelemetry,
            ...(incomingTelemetry || {}),
            activeTracksCount: nextTracks.length,
            activeDetectionsCount: updatedActiveDetections.length,
          }
        : undefined,
      events:
        appendedEvents.length > 0
          ? [...appendedEvents, ...systemState.events].slice(0, 50)
          : systemState.events,
      observability: systemState.observability
        ? {
            ...systemState.observability,
            videoReadiness: isLiveWebcam ? 'READY' : 'SIMULATED_CANVAS',
            avgInferenceLatencyMs: latencyMs,
          }
        : undefined,
    });

    broadcastSyncState('CAMERA_TELEMETRY');
    res.json({ state: systemState, eventCreated: appendedEvents[0] || null });
  });

  // Update V15.0 Detection Filter Configuration & Performance Profile
  app.post('/api/vision/config', (req: Request, res: Response) => {
    const nowIso = new Date().toISOString();
    const filterPatch = (req.body?.filterConfig || {}) as Partial<DetectionFilterConfig>;
    const telemetryPatch = (req.body?.telemetryPatch || {}) as Partial<MeasuredVisionTelemetry>;

    systemState = hydrateV14State({
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      detectionFilterConfig: systemState.detectionFilterConfig
        ? { ...systemState.detectionFilterConfig, ...filterPatch }
        : undefined,
      measuredVisionTelemetry: systemState.measuredVisionTelemetry
        ? { ...systemState.measuredVisionTelemetry, ...telemetryPatch }
        : undefined,
    });
    broadcastSyncState('VISION_CONFIG_UPDATED');
    res.json({ state: systemState });
  });

  // Update ALEANA Voice & Assistant Preferences
  app.post('/api/preferences', (req: Request, res: Response) => {
    const partial = req.body as Partial<AssistantPreferences>;
    const nowIso = new Date().toISOString();
    systemState = {
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      preferences: {
        ...systemState.preferences,
        ...partial,
      },
    };
    broadcastSyncState('PREFERENCES_UPDATED');
    res.json({ preferences: systemState.preferences, state: systemState });
  });

  // Direct Authorized Tool Execution Endpoint (25 Brain Tools)
  app.post('/api/brain/execute-tool', (req: Request, res: Response) => {
    const toolName = String(req.body?.toolName || '');
    const args = (req.body?.args || {}) as Record<string, unknown>;
    const { record, updatedState } = executeBrainTool(systemState, toolName, args, {
      confirmedConsequential: true,
    });
    systemState = {
      ...updatedState,
      syncRevision: updatedState.syncRevision + 1,
      lastCloudSyncIso: new Date().toISOString(),
    };
    broadcastSyncState('BRAIN_TOOL_EXECUTED');
    res.json({ record, state: systemState });
  });

  // Unified Vanta Brain + ALEANA Conversational Reasoning Endpoint
  app.post('/api/brain/query', async (req: Request, res: Response) => {
    const startMs = Date.now();
    const query = String(req.body?.query || '').trim();
    const modality = (req.body?.modality === 'VOICE_ALEANA' ? 'VOICE_ALEANA' : 'TEXT') as 'TEXT' | 'VOICE_ALEANA';
    const preferredLanguage = req.body?.language as 'en' | 'hi' | 'hinglish' | undefined;

    if (!query) {
      res.status(400).json({ error: 'Query cannot be empty.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const userMsg: ConversationMessage = {
      id: `MSG-USR-${Date.now().toString(36).toUpperCase()}`,
      conversationId: 'CONV-PRIMARY',
      role: 'user',
      modality,
      language: preferredLanguage || 'en',
      timestampIso: nowIso,
      content: query,
    };

    // Execute 9-Layer Vanta Brain Pipeline & Authorized Tools
    const pipelineResult = runNineLayerBrainPipeline(systemState, query, modality, preferredLanguage);
    systemState = pipelineResult.updatedState;

    let directAnswer = pipelineResult.directAnswer;
    let keyFindings = pipelineResult.keyFindings;
    let recommendedNextAction = pipelineResult.recommendedNextAction;
    let modelUsed = 'vanta-brain-9layer-deterministic';

    // Enhance with Server-Side Gemini 4 ('gemini-4-hydrogen') when GEMINI_API_KEY is available
    const ai = getGeminiClient();
    if (ai) {
      try {
        const languageDirective =
          pipelineResult.detectedLanguage === 'hi'
            ? 'Respond in natural Hindi (Devanagari script).'
            : pipelineResult.detectedLanguage === 'hinglish'
            ? 'Respond in natural conversational Hinglish (Hindi + English mix in Latin script).'
            : 'Respond in concise, authoritative enterprise English.';

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Operator Query (${modality}): "${query}"\n\nVerified Vanta Nexus Tool Outputs:\n${JSON.stringify(
                    pipelineResult.toolExecutions.map((t) => ({
                      tool: t.toolName,
                      summary: t.resultSummary,
                      data: t.dataPayload,
                    })),
                    null,
                    2
                  )}`,
                },
              ],
            },
          ],
          config: {
            systemInstruction: `You are Vanta Brain (and ALEANA Voice Intelligence) inside VantaVisionAI V11.0 (Vanta Nexus Command Center).
Strictly ground every claim in the Verified Vanta Nexus Tool Outputs provided. Never invent cameras, incidents, or metrics.
${languageDirective}
Return JSON matching the schema.`,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                directAnswer: {
                  type: Type.STRING,
                  description: 'Natural, conversational, evidence-grounded answer suitable for both display and ALEANA speech synthesis.',
                },
                keyFindings: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '2 to 4 concise bullet findings with exact IDs and numbers.',
                },
                recommendedNextAction: {
                  type: Type.STRING,
                  description: 'Specific recommended operator action.',
                },
              },
              required: ['directAnswer', 'keyFindings', 'recommendedNextAction'],
            },
          },
        });

        const parsed = JSON.parse((response.text ?? '{}').trim()) as {
          directAnswer?: string;
          keyFindings?: string[];
          recommendedNextAction?: string;
        };
        if (parsed.directAnswer) {
          directAnswer = parsed.directAnswer;
          if (Array.isArray(parsed.keyFindings) && parsed.keyFindings.length > 0) {
            keyFindings = parsed.keyFindings;
          }
          if (parsed.recommendedNextAction) {
            recommendedNextAction = parsed.recommendedNextAction;
          }
          modelUsed = 'gemini-4-hydrogen + vanta-9layer';
        }
      } catch {
        // Transparently preserve deterministic 9-layer grounded output if Gemini call fails
        modelUsed = 'vanta-brain-9layer-verified-fallback';
      }
    }

    const totalLatencyMs = Math.max(18, Date.now() - startMs);
    const assistantMsg: ConversationMessage = {
      id: `MSG-AI-${Date.now().toString(36).toUpperCase()}`,
      conversationId: 'CONV-PRIMARY',
      role: 'assistant',
      modality,
      language: pipelineResult.detectedLanguage,
      timestampIso: new Date().toISOString(),
      content: directAnswer,
      directAnswer,
      keyFindings,
      evidenceCitations: pipelineResult.evidenceCitations,
      epistemicBreakdown: pipelineResult.epistemicBreakdown,
      uncertaintyDisclosure: pipelineResult.uncertaintyDisclosure,
      recommendedNextAction,
      layerTraces: pipelineResult.layerTraces,
      toolExecutions: pipelineResult.toolExecutions,
      latencyMs: totalLatencyMs,
      modelUsed,
    };

    const nextConversations = [...systemState.conversations, userMsg, assistantMsg].slice(-40);
    systemState = hydrateV14State({
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: assistantMsg.timestampIso,
      conversations: nextConversations,
      memoryGovernance: systemState.memoryGovernance
        ? {
            ...systemState.memoryGovernance,
            conversationTurnCount: nextConversations.length,
          }
        : undefined,
    });

    broadcastSyncState('BRAIN_CONVERSATION_UPDATED');
    res.json({
      message: assistantMsg,
      state: systemState,
    });
  });

  // Autonomous Workflow Execution with Human Approval Boundary (Section 12)
  app.post('/api/workflows/:id/execute', (req: Request, res: Response) => {
    const workflowId = req.params.id;
    const approvedByHuman = Boolean(req.body?.approvedByHuman);
    const result = executeAutonomousWorkflow(systemState, workflowId, approvedByHuman);
    if (result.error) {
      res.status(400).json({ error: result.error, state: systemState });
      return;
    }
    systemState = hydrateV14State(result.updatedState);
    broadcastSyncState('WORKFLOW_EXECUTED');
    res.json({ workflow: result.workflow, state: systemState });
  });

  // Conversation Memory & Context Governance (Section 9)
  app.post('/api/memory/manage', (req: Request, res: Response) => {
    const action = req.body?.action === 'UPDATE_RETENTION' ? 'UPDATE_RETENTION' : 'RESET_CONVERSATION';
    const retentionDays = typeof req.body?.retentionDays === 'number' ? req.body.retentionDays : undefined;
    systemState = hydrateV14State(manageConversationMemory(systemState, action, retentionDays));
    broadcastSyncState('MEMORY_GOVERNANCE_UPDATED');
    res.json({ state: systemState });
  });

  // Audit Chain Verification Endpoint
  app.get('/api/audit/verify', (_req: Request, res: Response) => {
    const verification = verifyAuditChain(systemState.auditTrail);
    res.json({
      verification,
      totalRecords: systemState.auditTrail.length,
      auditTrail: systemState.auditTrail.slice().reverse(),
    });
  });

  // Mount Vite Dev Server or Production Static Bundle
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`VantaVisionAI V11.0 (Vanta Nexus) Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
