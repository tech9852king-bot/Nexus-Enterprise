export type FeatureStatus =
  | 'PLANNED'
  | 'IN DEVELOPMENT'
  | 'IMPLEMENTED'
  | 'TESTED'
  | 'VERIFIED'
  | 'PRODUCTION CANDIDATE';

export type UserRole = 'ADMIN' | 'SECURITY_OPERATOR' | 'ANALYST' | 'AUDITOR';

export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED';
export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ConnectorState =
  | 'Configured'
  | 'Connecting'
  | 'Connected'
  | 'Disconnected'
  | 'Degraded'
  | 'Simulated'
  | 'Error';

export type DataProvenance =
  | 'Measured'
  | 'Estimated'
  | 'Inferred'
  | 'Human-reported'
  | 'Simulated'
  | 'Derived';

export interface TenantContext {
  tenantId: string;
  organizationName: string;
  siteId: string;
  siteName: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: UserRole;
  permissions: string[];
}

export interface BoundingBox {
  id: string;
  label: string;
  confidence: number;
  x: number; // normalized 0-100
  y: number; // normalized 0-100
  width: number; // normalized 0-100
  height: number; // normalized 0-100
  dwellSeconds: number;
  zoneId: string;
}

export interface CameraEntity {
  id: string;
  tenantId: string;
  name: string;
  zoneId: string;
  zoneName: string;
  protocol: 'ONVIF' | 'RTSP' | 'WEBRTC' | 'LOCAL_WEBCAM';
  connectorState: ConnectorState;
  isSimulatedStream: boolean;
  resolution: string;
  fps: number;
  inferenceLatencyMs: number;
  packetLossPct: number;
  bitrateKbps: number;
  lastHeartbeatIso: string;
  occupancyCount: number;
  maxCapacity: number;
  activeDetections: BoundingBox[];
  coordinates: { x: number; y: number; fovAngle: number;heading: number };
}

export interface DeviceEntity {
  id: string;
  tenantId: string;
  name: string;
  platform: 'Android Node' | 'Tablet Command' | 'Windows Workstation' | 'Linux Edge Node' | 'IP Camera Bridge';
  ipAddress: string;
  connectorState: ConnectorState;
  batteryPct: number | null;
  cpuLoadPct: number;
  memoryUsedMb: number;
  syncLatencyMs: number;
  firmwareVersion: string;
  lastSyncIso: string;
  pairedVia: 'QR_TOKEN' | 'MTLS_CERT' | 'OAUTH_SESSION';
  authorized: boolean;
}

export interface PairingSession {
  tokenId: string;
  pairingCode: string;
  tenantId: string;
  targetPlatform: DeviceEntity['platform'];
  deviceName: string;
  createdAtIso: string;
  expiresAtIso: string;
  status: 'PENDING' | 'CLAIMED' | 'REVOKED' | 'EXPIRED';
  qrPayload: string;
}

export interface ZoneEntity {
  id: string;
  tenantId: string;
  name: string;
  floor: string;
  building: string;
  securityLevel: 'RESTRICTED' | 'CONTROLLED' | 'GENERAL';
  currentOccupancy: number;
  capacityLimit: number;
  dwellThresholdSec: number;
  activePolicyIds: string[];
  temperatureC: number;
  powerDrawKw: number;
  status: 'NOMINAL' | 'ELEVATED' | 'ALERT';
  bounds: { x: number; y: number; width: number; height: number };
}

export interface SecurityEvent {
  id: string;
  tenantId: string;
  cameraId: string;
  cameraName: string;
  deviceId: string;
  zoneId: string;
  zoneName: string;
  timestampIso: string;
  category: 'ZONE_INTRUSION' | 'DWELL_THRESHOLD' | 'OCCUPANCY_SURGE' | 'DEVICE_DEGRADED' | 'PERIMETER_MOTION' | 'POLICY_TRIGGER';
  severity: SeverityLevel;
  confidence: number;
  provenance: DataProvenance;
  summary: string;
  evidenceMetadata: {
    objectCount: number;
    dwellSeconds?: number;
    modelVersion: string;
    frameHash: string;
  };
  verified: boolean;
}

export interface IncidentTimelineEntry {
  id: string;
  timestampIso: string;
  actor: string;
  fromStatus?: IncidentStatus;
  toStatus?: IncidentStatus;
  action: string;
  note: string;
  verifiedEvidence: boolean;
}

export interface IncidentEntity {
  id: string;
  tenantId: string;
  title: string;
  severity: SeverityLevel;
  status: IncidentStatus;
  zoneId: string;
  zoneName: string;
  cameraIds: string[];
  relatedEventIds: string[];
  assignedTo: string;
  createdAtIso: string;
  updatedAtIso: string;
  rootCauseHypothesis: string;
  recommendedPlaybook: string;
  timeline: IncidentTimelineEntry[];
}

export interface PolicyRule {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  targetZoneId: string;
  targetZoneName: string;
  enabled: boolean;
  conditions: {
    minOccupancy?: number;
    maxDwellSeconds?: number;
    restrictedHoursOnly?: boolean;
    requiredConfidence: number;
  };
  severityOnMatch: SeverityLevel;
  autoCreateIncident: boolean;
  lastEvaluatedIso: string;
  matchCount24h: number;
}

export interface AuditRecord {
  id: string;
  sequenceNumber: number;
  tenantId: string;
  timestampIso: string;
  actorId: string;
  actorRole: UserRole;
  category: 'AUTH' | 'INCIDENT_STATE' | 'POLICY_CHANGE' | 'BRAIN_TOOL' | 'DEVICE_PAIRING' | 'CLOUD_SYNC';
  action: string;
  targetId: string;
  outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  details: string;
  previousHash: string;
  recordHash: string;
}

export interface BrainLayerTrace {
  layerNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  layerName:
    | 'Intent Intelligence'
    | 'Context Intelligence'
    | 'Data Intelligence'
    | 'Vision Intelligence'
    | 'Temporal Intelligence'
    | 'Policy & Risk Intelligence'
    | 'Reasoning & Orchestration'
    | 'Explanation Intelligence'
    | 'Governance Intelligence';
  status: 'COMPLETED' | 'WARNING' | 'BLOCKED';
  latencyMs: number;
  summary: string;
  evidenceRefs: string[];
}

export interface BrainToolDefinition {
  id: string;
  name: string;
  category: 'SYSTEM' | 'CAMERA_DEVICE' | 'EVENT_INCIDENT' | 'POLICY_INTELLIGENCE' | 'OPERATIONS_GOVERNANCE';
  description: string;
  consequential: boolean;
  requiredRole: UserRole[];
  inputSchemaSummary: string;
  outputSchemaSummary: string;
}

export interface BrainToolExecutionRecord {
  executionId: string;
  toolName: string;
  category: BrainToolDefinition['category'];
  timestampIso: string;
  actor: string;
  arguments: Record<string, unknown>;
  status: 'EXECUTED' | 'REQUIRES_CONFIRMATION' | 'DENIED' | 'FAILED';
  latencyMs: number;
  resultSummary: string;
  dataPayload: unknown;
  provenance: DataProvenance;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  modality: 'TEXT' | 'VOICE_ALEANA';
  language: 'en' | 'hi' | 'hinglish';
  timestampIso: string;
  content: string;
  directAnswer?: string;
  keyFindings?: string[];
  evidenceCitations?: string[];
  uncertaintyDisclosure?: string;
  recommendedNextAction?: string;
  layerTraces?: BrainLayerTrace[];
  toolExecutions?: BrainToolExecutionRecord[];
  latencyMs?: number;
  modelUsed?: string;
}

export interface TimeSeriesPoint {
  timestampIso: string;
  label: string;
  eventsCount: number;
  incidentsCount: number;
  occupancyTotal: number;
  avgInferenceMs: number;
  syncThroughputKbps: number;
  provenance: DataProvenance;
}

export interface AssistantPreferences {
  voiceProvider: 'BROWSER_SPEECH_SYNTHESIS' | 'GEMINI_SERVER_SYNTHESIS';
  languagePreference: 'en' | 'hi' | 'hinglish';
  speakingRate: number;
  volume: number;
  autoSpeakResponses: boolean;
  conversationMode: 'PUSH_TO_TALK' | 'CONTINUOUS' | 'TEXT_ONLY';
}

export interface VantaSystemState {
  version: string;
  codename: string;
  tenant: TenantContext;
  syncRevision: number;
  lastCloudSyncIso: string;
  connectedClients: number;
  cameras: CameraEntity[];
  devices: DeviceEntity[];
  pairingSessions: PairingSession[];
  zones: ZoneEntity[];
  events: SecurityEvent[];
  incidents: IncidentEntity[];
  policies: PolicyRule[];
  auditTrail: AuditRecord[];
  conversations: ConversationMessage[];
  toolExecutions: BrainToolExecutionRecord[];
  timeSeries: TimeSeriesPoint[];
  preferences: AssistantPreferences;
}
