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

export type TrackDirection = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST' | 'STATIC';

export interface ObjectTrack {
  trackId: string;
  sessionId: string;
  cameraId: string;
  zoneId: string;
  label: string;
  bbox: { x: number; y: number; width: number; height: number };
  centroid: { cx: number; cy: number };
  velocity: { vx: number; vy: number };
  direction: TrackDirection;
  confidence: number;
  confidenceHistory: number[];
  persistenceFrames: number;
  occludedFrames: number;
  dwellSeconds: number;
  lastUpdatedIso: string;
  isBiometric: false;
}

export interface VisionModelSpec {
  providerId: 'TFJS_COCO_SSD_640' | 'ONNX_WEB_QUANTIZED' | 'CANVAS_MOTION_NMS';
  modelName: string;
  modelSizeMb: number;
  supportedClassesCount: number;
  loadTimeMs: number;
  avgInferenceLatencyMs: number;
  memoryConsumptionMb: number;
  readinessState: 'READY' | 'LOADING' | 'FALLBACK_CANVAS' | 'ERROR';
  frameSkips: number;
  samplingHz: number;
}

export interface SceneIntelligenceSummary {
  cameraId: string;
  cameraName: string;
  zoneId: string;
  timestampIso: string;
  detectedClasses: Record<string, number>;
  detectionCount: number;
  activeTrackCount: number;
  motionState: 'STABLE' | 'MODERATE_MOTION' | 'ELEVATED_MOTION';
  zoneOccupancyEstimate: number;
  avgConfidence: number;
  modelStatus: string;
  uncertaintyNote: string;
  safetyGuarantee: string;
}

export type EventClassificationStage =
  | 'DETECTION'
  | 'OBSERVATION'
  | 'EVENT'
  | 'POLICY_MATCH'
  | 'INCIDENT_CANDIDATE'
  | 'CONFIRMED_INCIDENT';

export interface CorrelationPipelineStage {
  stageNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  stageName:
    | 'Vision Metadata'
    | 'Detection Event'
    | 'Tracking Update'
    | 'Motion Analysis'
    | 'Zone Evaluation'
    | 'Event Correlation'
    | 'Policy Evaluation'
    | 'Incident Candidate'
    | 'Authorized Workflow';
  status: 'ACTIVE' | 'COOLDOWN_DEDUP' | 'GATED';
  itemsProcessed: number;
  deduplicatedCount: number;
  cooldownSec: number;
  detail: string;
}

export interface EpistemicStatement {
  category:
    | 'Verified Fact'
    | 'Calculated Value'
    | 'Estimate'
    | 'Model Interpretation'
    | 'Assumption'
    | 'Unavailable Information';
  statement: string;
  sourceRef: string;
}

export interface AutonomousWorkflow {
  id: string;
  name: string;
  description: string;
  triggerType: 'MANUAL_OPERATOR' | 'POLICY_CORRELATION' | 'SCHEDULED';
  requiresHumanApproval: boolean;
  consequentialActionSummary: string;
  status: 'READY' | 'AWAITING_APPROVAL' | 'EXECUTING' | 'COMPLETED' | 'CANCELLED';
  steps: string[];
  lastRunIso: string | null;
  lastResultSummary: string | null;
  correlationId: string;
}

export interface MemoryGovernanceState {
  conversationTurnCount: number;
  sessionContextKeys: string[];
  operationalMemoryCount: number;
  retentionPeriodDays: number;
  piiMinimizationActive: boolean;
  rawVideoStored: false;
  lastPurgedIso: string | null;
}

export interface SystemObservabilityMetrics {
  correlationId: string;
  cameraHealthScore: number;
  videoReadiness: 'READY' | 'SIMULATED_CANVAS';
  modelReadiness: string;
  avgInferenceLatencyMs: number;
  processingFrequencyHz: number;
  frameSkipsCount: number;
  apiLatencyMs: number;
  toolExecutionAvgMs: number;
  brainResponseAvgMs: number;
  voiceResponseAvgMs: number;
  databaseHealth: 'HEALTHY' | 'DEGRADED';
  errorRatePct: number;
  diagnosticFindings: {
    subsystem: string;
    status: 'OK' | 'WARNING' | 'ERROR';
    message: string;
  }[];
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
  epistemicBreakdown?: EpistemicStatement[];
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

export type DetectionProvenance = 'REAL_MODEL' | 'SIMULATED_DEMO' | 'IMPORTED_SAMPLE';

export type ModelProviderStatus =
  | 'UNINITIALIZED'
  | 'LOADING'
  | 'READY'
  | 'RUNNING'
  | 'ERROR'
  | 'DISPOSED';

export type PerformanceProfile = 'LOW_RESOURCE' | 'BALANCED' | 'HIGH_PERFORMANCE';

export interface NormalizedDetection {
  detectionId: string;
  classId: number;
  className: string;
  confidence: number;
  rawConfidence: number;
  boundingBox: {
    x: number; // 0-100% normalized
    y: number; // 0-100% normalized
    width: number; // 0-100% normalized
    height: number; // 0-100% normalized
  };
  pixelBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sourceFrameWidth: number;
  sourceFrameHeight: number;
  timestamp: string;
  modelId: string;
  modelVersion: string;
  cameraId: string;
  inferenceId: string;
  provenance: DetectionProvenance;
}

export interface DetectionFilterConfig {
  globalMinConfidence: number;
  classThresholds: Record<string, number>;
  displayThreshold: number;
  eventGenerationThreshold: number;
  enabledClasses: string[];
  nmsIouThreshold: number;
}

export interface MeasuredVisionTelemetry {
  modelStatus: ModelProviderStatus;
  modelId: string;
  modelVersion: string;
  modelInitTimeMs: number | null;
  inferenceLatencyMs: number | null;
  processedFrames: number;
  skippedFrames: number;
  cameraFps: number | null;
  inferenceFps: number | null;
  activeTracksCount: number;
  activeDetectionsCount: number;
  errorCount: number;
  lastError: string | null;
  performanceProfile: PerformanceProfile;
  provenanceMode: DetectionProvenance;
}

export interface DetectionEventRule {
  ruleId: string;
  name: string;
  objectClass: string;
  minConfidence: number;
  minPersistenceSeconds: number;
  minRepeatedFrames: number;
  zoneId?: string;
  cooldownSeconds: number;
  severity: SeverityLevel;
  enabled: boolean;
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
  // V14.0 Enterprise Extensions
  visionModel?: VisionModelSpec;
  activeTracks?: ObjectTrack[];
  sceneSummaries?: SceneIntelligenceSummary[];
  correlationPipeline?: CorrelationPipelineStage[];
  workflows?: AutonomousWorkflow[];
  memoryGovernance?: MemoryGovernanceState;
  observability?: SystemObservabilityMetrics;
  // V15.0 Real-Time Vision Intelligence Extensions
  detectionFilterConfig?: DetectionFilterConfig;
  measuredVisionTelemetry?: MeasuredVisionTelemetry;
  detectionEventRules?: DetectionEventRule[];
  latestNormalizedDetections?: NormalizedDetection[];
}

