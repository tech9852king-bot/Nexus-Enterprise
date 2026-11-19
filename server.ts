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
  buildDefaultBrainAiDiagnostics,
  buildSceneIntelligenceSummary,
  classifyGeminiError,
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
  validateAndHydrateSystemState,
  verifyAuditChain,
} from './src/core/engine';
import {
  AssistantPreferences,
  BrainAiDiagnostics,
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
  ALL_COCO_SSD_CLASSES,
  evaluateDetectionEventRules,
  normalizedToBoundingBoxes,
  updateCameraObjectTracks,
} from './src/core/visionPipeline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE_PATH = path.resolve(__dirname, '.vanta-state.json');

function isGeminiKeyConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key.trim().length >= 10);
}

function hydrateV14State(base: VantaSystemState): VantaSystemState {
  return validateAndHydrateSystemState(base, {
    apiKeyConfigured: isGeminiKeyConfigured(),
    upgradeLegacyClassFilter: false,
  }).state;
}

function loadOrCreateState(): VantaSystemState {
  const apiKeyReady = isGeminiKeyConfigured();
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      const { state: hydrated } = validateAndHydrateSystemState(parsed, {
        apiKeyConfigured: apiKeyReady,
        resetTransientWebcamOnBoot: true,
      });
      saveState(hydrated);
      return hydrated;
    }
  } catch {
    // Fall back to fresh verified baseline state if file is missing or unparseable JSON
  }
  const { state: initial } = validateAndHydrateSystemState(createInitialVantaState(), {
    apiKeyConfigured: apiKeyReady,
    resetTransientWebcamOnBoot: true,
  });
  saveState(initial);
  return initial;
}

function saveState(state: VantaSystemState): void {
  const tmpPath = `${STATE_FILE_PATH}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, STATE_FILE_PATH);
  } catch {
    try {
      fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    } catch {
      // Non-fatal in read-only containers
    }
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
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      next: express.NextFunction
    ) => {
      if (err instanceof SyntaxError && 'body' in err) {
        res.status(400).json({ error: 'Malformed JSON request payload.' });
        return;
      }
      next(err);
    }
  );

  // Operational Health & Readiness Endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    const auditIntegrity = verifyAuditChain(systemState.auditTrail);
    res.json({
      status: auditIntegrity.valid ? 'HEALTHY' : 'DEGRADED',
      version: systemState.version,
      syncRevision: systemState.syncRevision,
      connectedClients: Math.max(1, sseClients.size),
      auditIntegrity,
      geminiConfigured: isGeminiKeyConfigured(),
    });
  });

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

    const keepAliveTimer = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAliveTimer);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
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
    const rawOccupancy = Number(req.body?.occupancy ?? zone.currentOccupancy);
    const rawDwell = Number(req.body?.maxDwellSeconds ?? 148);
    const rawConfidence = Number(req.body?.confidence ?? 0.94);
    if (
      !Number.isFinite(rawOccupancy) ||
      rawOccupancy < 0 ||
      !Number.isFinite(rawDwell) ||
      rawDwell < 0 ||
      !Number.isFinite(rawConfidence) ||
      rawConfidence < 0 ||
      rawConfidence > 1
    ) {
      res.status(400).json({
        error:
          'Invalid policy evaluation parameters: occupancy and maxDwellSeconds must be non-negative numbers, and confidence must be between 0 and 1.',
      });
      return;
    }
    const isRestrictedHours = Boolean(req.body?.isRestrictedHours ?? true);

    const evaluation = evaluateCompoundPolicyRule(policy, {
      zoneId: zone.id,
      occupancy: Math.round(rawOccupancy),
      maxDwellSeconds: Math.round(rawDwell),
      confidence: rawConfidence,
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
    const deviceName = String(req.body?.deviceName || '').trim().slice(0, 80);
    const validPlatforms: DeviceEntity['platform'][] = [
      'Android Node',
      'Tablet Command',
      'Windows Workstation',
      'Linux Edge Node',
      'IP Camera Bridge',
    ];
    const requestedPlatform = req.body?.targetPlatform as DeviceEntity['platform'];
    const targetPlatform: DeviceEntity['platform'] = validPlatforms.includes(
      requestedPlatform
    )
      ? requestedPlatform
      : 'Android Node';
    if (deviceName.length < 3) {
      res.status(400).json({ error: 'Device name must be between 3 and 80 characters.' });
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
    const seededDeviceIds = new Set(['DEV-AND-01', 'DEV-TAB-02', 'DEV-WIN-03']);
    systemState = {
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      devices: systemState.devices.map((d) =>
        d.id === devId
          ? {
              ...d,
              authorized: nextAuthorized,
              connectorState: nextAuthorized
                ? !seededDeviceIds.has(d.id) && d.pairedVia === 'QR_TOKEN'
                  ? 'Connected'
                  : 'Simulated'
                : 'Disconnected',
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

  const baselineCamerasById = new Map(
    createInitialVantaState().cameras.map((c) => [c.id, c])
  );

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
    const fps =
      typeof req.body?.fps === 'number' && Number.isFinite(req.body.fps)
        ? Math.max(0, Math.round(req.body.fps))
        : isLiveWebcam
        ? cam.fps
        : 0;
    const latencyMs =
      typeof req.body?.inferenceLatencyMs === 'number' &&
      Number.isFinite(req.body.inferenceLatencyMs)
        ? Math.max(0, Math.round(req.body.inferenceLatencyMs))
        : cam.inferenceLatencyMs;
    const motionPct =
      typeof req.body?.motionScore === 'number' && Number.isFinite(req.body.motionScore)
        ? Math.max(0, Number(req.body.motionScore))
        : 0;
    const incomingDetections = Array.isArray(req.body?.normalizedDetections)
      ? (req.body.normalizedDetections as NormalizedDetection[]).filter(
          (d): d is NormalizedDetection =>
            Boolean(
              d &&
                typeof d === 'object' &&
                typeof d.className === 'string' &&
                d.className.trim().length > 0 &&
                typeof d.confidence === 'number' &&
                Number.isFinite(d.confidence) &&
                d.boundingBox &&
                typeof d.boundingBox === 'object' &&
                Number.isFinite(d.boundingBox.x) &&
                Number.isFinite(d.boundingBox.y) &&
                Number.isFinite(d.boundingBox.width) &&
                Number.isFinite(d.boundingBox.height) &&
                d.boundingBox.width > 0 &&
                d.boundingBox.height > 0
            )
        )
      : null;
    const incomingTelemetry = (req.body?.measuredVisionTelemetry || null) as Partial<MeasuredVisionTelemetry> | null;
    const isSelfTestPass = !isLiveWebcam && !Array.isArray(req.body?.normalizedDetections);

    let nextTracks = systemState.activeTracks || [];
    let updatedActiveDetections = cam.activeDetections;
    let ruleEvents: SecurityEvent[] = [];

    if (isLiveWebcam && incomingDetections) {
      nextTracks = updateCameraObjectTracks(nextTracks, incomingDetections, cam.id, cam.zoneId, {
        nowIso,
      });
      updatedActiveDetections = normalizedToBoundingBoxes(
        incomingDetections,
        nextTracks,
        cam.zoneId
      );
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
    } else if (!isLiveWebcam && incomingDetections !== null) {
      // Webcam stopped: restore baseline simulated detections and tracks for this camera
      const baselineCam = baselineCamerasById.get(cam.id);
      updatedActiveDetections = baselineCam
        ? baselineCam.activeDetections.map((d) => ({ ...d }))
        : cam.activeDetections;
      nextTracks = updateObjectTracks(
        nextTracks.filter((t) => t.cameraId !== cam.id),
        updatedActiveDetections,
        cam.id,
        cam.zoneId,
        nowIso
      );
    } else {
      nextTracks = updateObjectTracks(nextTracks, cam.activeDetections, cam.id, cam.zoneId, nowIso);
    }

    const motionEvent: SecurityEvent | null =
      ruleEvents.length === 0 && isLiveWebcam && motionPct > 12
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
            provenance: 'Measured',
            summary: `Measured live webcam track centroid displacement (${motionPct.toFixed(
              1
            )}%) recorded on ${cam.name}.`,
            evidenceMetadata: {
              objectCount: updatedActiveDetections.length,
              modelVersion: 'tfjs-coco-ssd-lite_mobilenet_v2@2.2.3',
              frameHash: sha256Hex(`${cam.id}:${nowIso}:${motionPct}`),
            },
            verified: true,
          }
        : null;

    const appendedEvents = [
      ...ruleEvents,
      ...(motionEvent ? [motionEvent] : []),
    ];

    const nextCameras = systemState.cameras.map((c) => {
      const baselineCam = baselineCamerasById.get(c.id);
      if (c.id === camId) {
        if (isSelfTestPass) {
          // Non-camera self-test: record latency & heartbeat without altering stream connectorState or baseline boxes
          return {
            ...c,
            inferenceLatencyMs: latencyMs,
            lastHeartbeatIso: nowIso,
          };
        }
        if (isLiveWebcam) {
          const livePersonCount = updatedActiveDetections.filter(
            (d) => d.label === 'person'
          ).length;
          return {
            ...c,
            isSimulatedStream: false,
            connectorState: 'Connected' as const,
            fps,
            inferenceLatencyMs: latencyMs,
            lastHeartbeatIso: nowIso,
            activeDetections: updatedActiveDetections,
            occupancyCount:
              incomingDetections !== null ? livePersonCount : c.occupancyCount,
          };
        }
        // Webcam explicitly stopped on this camera: restore deterministic baseline state
        return {
          ...c,
          isSimulatedStream: true,
          connectorState: baselineCam?.connectorState || ('Simulated' as const),
          fps: baselineCam?.fps ?? c.fps,
          inferenceLatencyMs: latencyMs,
          lastHeartbeatIso: nowIso,
          activeDetections: updatedActiveDetections,
          occupancyCount: baselineCam?.occupancyCount ?? c.occupancyCount,
        };
      }
      // If another camera was previously left in live-webcam mode (!c.isSimulatedStream), restore it to baseline
      if (!isSelfTestPass && !c.isSimulatedStream) {
        return {
          ...c,
          isSimulatedStream: true,
          connectorState: baselineCam?.connectorState || ('Simulated' as const),
          fps: baselineCam?.fps ?? c.fps,
          activeDetections: baselineCam
            ? baselineCam.activeDetections.map((d) => ({ ...d }))
            : c.activeDetections,
          occupancyCount: baselineCam?.occupancyCount ?? c.occupancyCount,
        };
      }
      return c;
    });

    const nextNormalizedDetections = isSelfTestPass
      ? systemState.latestNormalizedDetections || []
      : isLiveWebcam && incomingDetections
      ? [
          ...incomingDetections,
          ...(systemState.latestNormalizedDetections || []).filter(
            (d) => d.cameraId !== cam.id && d.provenance !== 'REAL_MODEL'
          ),
        ].slice(0, 50)
      : (systemState.latestNormalizedDetections || []).filter(
          (d) => d.provenance !== 'REAL_MODEL'
        );

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
            activeDetectionsCount: nextNormalizedDetections.length,
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
    const rawFilter = (req.body?.filterConfig || {}) as Partial<DetectionFilterConfig>;
    const sanitizedFilter: Partial<DetectionFilterConfig> = {};

    if (
      typeof rawFilter.globalMinConfidence === 'number' &&
      Number.isFinite(rawFilter.globalMinConfidence)
    ) {
      sanitizedFilter.globalMinConfidence = Math.max(
        0.1,
        Math.min(0.99, rawFilter.globalMinConfidence)
      );
    }
    if (
      typeof rawFilter.displayThreshold === 'number' &&
      Number.isFinite(rawFilter.displayThreshold)
    ) {
      sanitizedFilter.displayThreshold = Math.max(
        0.1,
        Math.min(0.99, rawFilter.displayThreshold)
      );
    }
    if (
      typeof rawFilter.nmsIouThreshold === 'number' &&
      Number.isFinite(rawFilter.nmsIouThreshold)
    ) {
      sanitizedFilter.nmsIouThreshold = Math.max(
        0.1,
        Math.min(0.95, rawFilter.nmsIouThreshold)
      );
    }
    if (Array.isArray(rawFilter.enabledClasses) && rawFilter.enabledClasses.length > 0) {
      sanitizedFilter.enabledClasses = rawFilter.enabledClasses
        .map((c) => String(c))
        .slice(0, 100);
    }

    const validProfiles = ['LOW_RESOURCE', 'BALANCED', 'HIGH_PERFORMANCE'] as const;
    const reqProfile =
      req.body?.performanceProfile || req.body?.telemetryPatch?.performanceProfile;
    const safeProfile = validProfiles.includes(reqProfile)
      ? reqProfile
      : undefined;

    const rawPatch =
      req.body?.telemetryPatch && typeof req.body.telemetryPatch === 'object'
        ? (req.body.telemetryPatch as Partial<MeasuredVisionTelemetry>)
        : {};
    const validModelStatuses: MeasuredVisionTelemetry['modelStatus'][] = [
      'UNINITIALIZED',
      'LOADING',
      'READY',
      'RUNNING',
      'ERROR',
      'DISPOSED',
    ];
    const telemetryPatch: Partial<MeasuredVisionTelemetry> = {
      ...(safeProfile ? { performanceProfile: safeProfile } : {}),
      ...(rawPatch.modelStatus && validModelStatuses.includes(rawPatch.modelStatus)
        ? { modelStatus: rawPatch.modelStatus }
        : {}),
      ...(typeof rawPatch.cameraFps === 'number' && Number.isFinite(rawPatch.cameraFps)
        ? { cameraFps: Math.max(0, rawPatch.cameraFps) }
        : {}),
      ...(typeof rawPatch.inferenceFps === 'number' && Number.isFinite(rawPatch.inferenceFps)
        ? { inferenceFps: Math.max(0, rawPatch.inferenceFps) }
        : {}),
      ...(typeof rawPatch.inferenceLatencyMs === 'number' && Number.isFinite(rawPatch.inferenceLatencyMs)
        ? { inferenceLatencyMs: Math.max(0, rawPatch.inferenceLatencyMs) }
        : {}),
    };

    systemState = hydrateV14State({
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      detectionFilterConfig: systemState.detectionFilterConfig
        ? { ...systemState.detectionFilterConfig, ...sanitizedFilter }
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
    const rawPrefs = (req.body || {}) as Partial<AssistantPreferences>;
    const validLangs = ['en', 'hi', 'hinglish'] as const;
    const validProviders = ['BROWSER_SPEECH_SYNTHESIS', 'GEMINI_SERVER_SYNTHESIS'] as const;
    const validModes = ['PUSH_TO_TALK', 'CONTINUOUS', 'TEXT_ONLY'] as const;
    const sanitizedPrefs: Partial<AssistantPreferences> = {};

    if (
      rawPrefs.voiceProvider &&
      validProviders.includes(rawPrefs.voiceProvider)
    ) {
      sanitizedPrefs.voiceProvider = rawPrefs.voiceProvider;
    }
    if (
      rawPrefs.languagePreference &&
      validLangs.includes(rawPrefs.languagePreference)
    ) {
      sanitizedPrefs.languagePreference = rawPrefs.languagePreference;
    }
    if (
      rawPrefs.conversationMode &&
      validModes.includes(rawPrefs.conversationMode)
    ) {
      sanitizedPrefs.conversationMode = rawPrefs.conversationMode;
    }
    if (typeof rawPrefs.autoSpeakResponses === 'boolean') {
      sanitizedPrefs.autoSpeakResponses = rawPrefs.autoSpeakResponses;
    }
    if (
      typeof rawPrefs.speakingRate === 'number' &&
      Number.isFinite(rawPrefs.speakingRate)
    ) {
      sanitizedPrefs.speakingRate = Math.max(
        0.5,
        Math.min(2.0, rawPrefs.speakingRate)
      );
    }
    if (typeof rawPrefs.volume === 'number' && Number.isFinite(rawPrefs.volume)) {
      sanitizedPrefs.volume = Math.max(0, Math.min(1.0, rawPrefs.volume));
    }

    const nowIso = new Date().toISOString();
    systemState = {
      ...systemState,
      syncRevision: systemState.syncRevision + 1,
      lastCloudSyncIso: nowIso,
      preferences: {
        ...systemState.preferences,
        ...sanitizedPrefs,
      },
    };
    broadcastSyncState('PREFERENCES_UPDATED');
    res.json({ preferences: systemState.preferences, state: systemState });
  });

  // Direct Authorized Tool Execution Endpoint (25 Brain Tools)
  app.post('/api/brain/execute-tool', (req: Request, res: Response) => {
    const toolName = String(req.body?.toolName || '');
    const args =
      req.body?.args && typeof req.body.args === 'object' && !Array.isArray(req.body.args)
        ? (req.body.args as Record<string, unknown>)
        : {};
    const { record, updatedState } = executeBrainTool(systemState, toolName, args, {
      confirmedConsequential: true,
    });
    systemState = hydrateV14State({
      ...updatedState,
      syncRevision: updatedState.syncRevision + 1,
      lastCloudSyncIso: new Date().toISOString(),
    });
    broadcastSyncState('BRAIN_TOOL_EXECUTED');
    res.json({ record, state: systemState });
  });

  // Section 5 & 7: Vanta Brain & Gemini Health / Readiness Diagnostic Endpoint
  app.get('/api/brain/health', async (req: Request, res: Response) => {
    const probe = req.query.probe === 'true';
    const ai = getGeminiClient();
    const nowIso = new Date().toISOString();

    if (!ai) {
      const diag = buildDefaultBrainAiDiagnostics(false);
      systemState = {
        ...systemState,
        brainAiDiagnostics: diag,
      };
      res.json({
        diagnostics: diag,
        localPipelineReady: true,
        toolsRegistered: BRAIN_TOOLS_REGISTRY.length,
      });
      return;
    }

    if (probe) {
      const t0 = Date.now();
      try {
        const probeRes = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: 'Respond with the single word READY.',
        });
        const text = (probeRes.text || '').trim();
        if (!text) {
          throw new Error('Empty response from Gemini model');
        }
        const diag: BrainAiDiagnostics = {
          status: 'GEMINI CONNECTED',
          geminiConfigured: true,
          modelName: 'gemini-4-hydrogen',
          fallbackModelName: 'vanta-brain-9layer-v16-fallback',
          lastErrorCategory: null,
          lastErrorMessage: null,
          lastCheckedIso: nowIso,
          lastResponseLatencyMs: Math.max(1, Date.now() - t0),
          usingFallback: false,
        };
        systemState = { ...systemState, brainAiDiagnostics: diag };
        broadcastSyncState('BRAIN_HEALTH_VERIFIED');
      } catch (err) {
        const classified = classifyGeminiError(err);
        const diag: BrainAiDiagnostics = {
          status: classified.status,
          geminiConfigured: true,
          modelName: 'gemini-4-hydrogen',
          fallbackModelName: 'vanta-brain-9layer-v16-fallback',
          lastErrorCategory: classified.errorCategory,
          lastErrorMessage: classified.sanitizedMessage,
          lastCheckedIso: nowIso,
          lastResponseLatencyMs: Math.max(1, Date.now() - t0),
          usingFallback: true,
        };
        systemState = { ...systemState, brainAiDiagnostics: diag };
        broadcastSyncState('BRAIN_HEALTH_VERIFIED');
      }
    }

    res.json({
      diagnostics:
        systemState.brainAiDiagnostics || buildDefaultBrainAiDiagnostics(isGeminiKeyConfigured()),
      localPipelineReady: true,
      toolsRegistered: BRAIN_TOOLS_REGISTRY.length,
    });
  });

  // Unified Vanta Brain + ALEANA Conversational Reasoning Endpoint
  app.post('/api/brain/query', async (req: Request, res: Response) => {
    const startMs = Date.now();
    const query = String(req.body?.query || '').trim().slice(0, 2000);
    const modality = (req.body?.modality === 'VOICE_ALEANA' ? 'VOICE_ALEANA' : 'TEXT') as 'TEXT' | 'VOICE_ALEANA';
    const validLangs = ['en', 'hi', 'hinglish'] as const;
    const rawLang = req.body?.language;
    const preferredLanguage = validLangs.includes(rawLang) ? rawLang : undefined;

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
    let uncertaintyDisclosure = pipelineResult.uncertaintyDisclosure;
    let modelUsed = 'vanta-brain-9layer-v16-fallback (GEMINI_UNAVAILABLE: API_KEY_MISSING)';
    let nextDiagnostics: BrainAiDiagnostics = buildDefaultBrainAiDiagnostics(false);

    // Enhance with Server-Side Gemini ('gemini-4-hydrogen') when GEMINI_API_KEY is available
    const ai = getGeminiClient();
    if (ai) {
      const geminiStartMs = Date.now();
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
            systemInstruction: `You are Vanta Brain (and ALEANA Voice Intelligence) inside VantaVisionAI V16.0 (Vanta Nexus Command Center).
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
        if (!parsed.directAnswer) {
          throw new Error('Gemini returned empty directAnswer payload.');
        }
        directAnswer = parsed.directAnswer;
        if (Array.isArray(parsed.keyFindings) && parsed.keyFindings.length > 0) {
          keyFindings = parsed.keyFindings;
        }
        if (parsed.recommendedNextAction) {
          recommendedNextAction = parsed.recommendedNextAction;
        }
        const geminiLatencyMs = Math.max(1, Date.now() - geminiStartMs);
        modelUsed = 'gemini-4-hydrogen + vanta-9layer';
        nextDiagnostics = {
          status: 'GEMINI CONNECTED',
          geminiConfigured: true,
          modelName: 'gemini-4-hydrogen',
          fallbackModelName: 'vanta-brain-9layer-v16-fallback',
          lastErrorCategory: null,
          lastErrorMessage: null,
          lastCheckedIso: new Date().toISOString(),
          lastResponseLatencyMs: geminiLatencyMs,
          usingFallback: false,
        };
      } catch (err) {
        const classified = classifyGeminiError(err);
        const geminiLatencyMs = Math.max(1, Date.now() - geminiStartMs);
        modelUsed = `vanta-brain-9layer-v16-fallback (${classified.errorCategory})`;
        uncertaintyDisclosure = `[FALLBACK MODE — ${classified.status}: ${classified.sanitizedMessage}] ${pipelineResult.uncertaintyDisclosure}`;
        nextDiagnostics = {
          status: classified.status,
          geminiConfigured: true,
          modelName: 'gemini-4-hydrogen',
          fallbackModelName: 'vanta-brain-9layer-v16-fallback',
          lastErrorCategory: classified.errorCategory,
          lastErrorMessage: classified.sanitizedMessage,
          lastCheckedIso: new Date().toISOString(),
          lastResponseLatencyMs: geminiLatencyMs,
          usingFallback: true,
        };
      }
    } else {
      uncertaintyDisclosure = `[FALLBACK MODE — GEMINI UNAVAILABLE (API_KEY_MISSING): Configure GEMINI_API_KEY in AI Studio Settings > Secrets for live Gemini synthesis. Response generated by Vanta Brain 9-Layer deterministic tool pipeline.] ${pipelineResult.uncertaintyDisclosure}`;
    }

    const totalLatencyMs = Math.max(1, Date.now() - startMs);
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
      uncertaintyDisclosure,
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
      brainAiDiagnostics: nextDiagnostics,
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
      diagnostics: nextDiagnostics,
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
    if (systemState.tenant.role === 'AUDITOR') {
      res.status(403).json({
        error: 'AUDITOR role is read-only and cannot reset conversation memory or modify retention policies.',
        state: systemState,
      });
      return;
    }
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
      verifiedAtIso: new Date().toISOString(),
    });
  });

  // Defensive API 404 & Error Boundary (Zero stack trace leaks on /api/*)
  app.use('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });
  app.use(
    (
      _err: unknown,
      req: Request,
      res: Response,
      next: express.NextFunction
    ) => {
      if (req.path.startsWith('/api/')) {
        res.status(500).json({ error: 'Internal server error.' });
        return;
      }
      next(_err);
    }
  );

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
    console.log(`VantaVisionAI V16.0 (Vanta Nexus) Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
