import {
  BoundingBox,
  DetectionEventRule,
  DetectionFilterConfig,
  DetectionProvenance,
  ModelProviderStatus,
  NormalizedDetection,
  ObjectTrack,
  PerformanceProfile,
  SecurityEvent,
} from './types';
import { computeIoU, classifyTrackDirection, sha256Hex } from './engine';

export interface RawModelPrediction {
  bbox: [number, number, number, number]; // [x, y, width, height] in source pixels
  class: string;
  score: number;
}

export interface VideoReadinessResult {
  ready: boolean;
  reason: string;
  width: number;
  height: number;
}

export const COCO_CLASS_IDS: Record<string, number> = {
  person: 1,
  bicycle: 2,
  car: 3,
  motorcycle: 4,
  airplane: 5,
  bus: 6,
  train: 7,
  truck: 8,
  boat: 9,
  backpack: 27,
  umbrella: 28,
  handbag: 31,
  tie: 32,
  suitcase: 33,
  bottle: 44,
  chair: 62,
  couch: 63,
  potted_plant: 64,
  tv: 72,
  laptop: 73,
  mouse: 74,
  keyboard: 76,
  'cell phone': 77,
  book: 84,
  clock: 85,
};

export const DEFAULT_DETECTION_FILTER_CONFIG: DetectionFilterConfig = {
  globalMinConfidence: 0.45,
  classThresholds: {
    person: 0.5,
    car: 0.5,
    truck: 0.5,
    vehicle: 0.5,
    laptop: 0.45,
    'cell phone': 0.45,
    backpack: 0.45,
  },
  displayThreshold: 0.45,
  eventGenerationThreshold: 0.65,
  enabledClasses: [
    'person',
    'bicycle',
    'car',
    'motorcycle',
    'bus',
    'truck',
    'vehicle',
    'backpack',
    'handbag',
    'suitcase',
    'laptop',
    'cell phone',
    'chair',
    'bottle',
    'book',
  ],
  nmsIouThreshold: 0.5,
};

export const DEFAULT_DETECTION_EVENT_RULES: DetectionEventRule[] = [
  {
    ruleId: 'RULE-V15-PERSON-DWELL',
    name: 'Sustained Person Presence in Monitored Zone',
    objectClass: 'person',
    minConfidence: 0.65,
    minPersistenceSeconds: 2,
    minRepeatedFrames: 2,
    cooldownSeconds: 30,
    severity: 'MEDIUM',
    enabled: true,
  },
  {
    ruleId: 'RULE-V15-VEHICLE-GATE',
    name: 'Verified Vehicle / Logistics Asset Detection',
    objectClass: 'car',
    minConfidence: 0.65,
    minPersistenceSeconds: 1,
    minRepeatedFrames: 2,
    cooldownSeconds: 45,
    severity: 'LOW',
    enabled: true,
  },
  {
    ruleId: 'RULE-V15-EQUIPMENT-CHECK',
    name: 'Portable Device / Equipment Presence',
    objectClass: 'cell phone',
    minConfidence: 0.55,
    minPersistenceSeconds: 1,
    minRepeatedFrames: 1,
    cooldownSeconds: 30,
    severity: 'LOW',
    enabled: true,
  },
];

/**
 * PART D4: Video Readiness Validation
 */
export function validateVideoReadiness(
  video: {
    readyState?: number;
    videoWidth?: number;
    videoHeight?: number;
    paused?: boolean;
    ended?: boolean;
  } | null
): VideoReadinessResult {
  if (!video) {
    return { ready: false, reason: 'Video element reference is null.', width: 0, height: 0 };
  }
  if (typeof video.readyState === 'number' && video.readyState < 2) {
    return {
      ready: false,
      reason: `Video stream not ready (readyState=${video.readyState}, requires >= 2).`,
      width: 0,
      height: 0,
    };
  }
  const width = Number(video.videoWidth || 0);
  const height = Number(video.videoHeight || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      ready: false,
      reason: `Invalid video frame dimensions (${width}x${height}).`,
      width: 0,
      height: 0,
    };
  }
  if (video.paused || video.ended) {
    return {
      ready: false,
      reason: video.ended ? 'Video playback has ended.' : 'Video stream is paused.',
      width,
      height,
    };
  }
  return {
    ready: true,
    reason: `Video stream ready (${width}x${height}).`,
    width,
    height,
  };
}

/**
 * PART D6: Prediction Validation & Normalization
 * Rejects NaN, Infinity, invalid confidence, non-positive box dimensions, or boxes outside frame bounds.
 */
export function validateAndNormalizePredictions(
  rawPredictions: unknown[],
  frameContext: {
    sourceFrameWidth: number;
    sourceFrameHeight: number;
    cameraId: string;
    modelId: string;
    modelVersion: string;
    inferenceId: string;
    timestampIso?: string;
    provenance: DetectionProvenance;
  }
): {
  validDetections: NormalizedDetection[];
  rejectedCount: number;
  rejectionReasons: string[];
} {
  const validDetections: NormalizedDetection[] = [];
  const rejectionReasons: string[] = [];
  let rejectedCount = 0;

  const fw = frameContext.sourceFrameWidth;
  const fh = frameContext.sourceFrameHeight;
  const timestamp = frameContext.timestampIso || new Date().toISOString();

  if (!Number.isFinite(fw) || !Number.isFinite(fh) || fw <= 0 || fh <= 0) {
    return {
      validDetections: [],
      rejectedCount: Array.isArray(rawPredictions) ? rawPredictions.length : 0,
      rejectionReasons: [`Invalid source frame dimensions (${fw}x${fh}).`],
    };
  }

  if (!Array.isArray(rawPredictions)) {
    return {
      validDetections: [],
      rejectedCount: 1,
      rejectionReasons: ['Raw predictions input is not an array.'],
    };
  }

  rawPredictions.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') {
      rejectedCount++;
      rejectionReasons.push(`Prediction[${idx}] is not an object.`);
      return;
    }
    const candidate = raw as Partial<RawModelPrediction>;
    const className = typeof candidate.class === 'string' ? candidate.class.trim().toLowerCase() : '';
    const score = Number(candidate.score);
    const bbox = candidate.bbox;

    if (!className) {
      rejectedCount++;
      rejectionReasons.push(`Prediction[${idx}] missing valid className.`);
      return;
    }
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      rejectedCount++;
      rejectionReasons.push(`Prediction[${idx}] has out-of-range confidence (${candidate.score}).`);
      return;
    }
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      rejectedCount++;
      rejectionReasons.push(`Prediction[${idx}] bbox must be a 4-element tuple.`);
      return;
    }

    const [rawX, rawY, rawW, rawH] = bbox.map(Number);
    if (
      !Number.isFinite(rawX) ||
      !Number.isFinite(rawY) ||
      !Number.isFinite(rawW) ||
      !Number.isFinite(rawH)
    ) {
      rejectedCount++;
      rejectionReasons.push(`Prediction[${idx}] contains non-finite coordinates.`);
      return;
    }

    if (rawW <= 0 || rawH <= 0) {
      rejectedCount++;
      rejectionReasons.push(`Prediction[${idx}] has non-positive width/height (${rawW}x${rawH}).`);
      return;
    }

    // Reject boxes that lie completely outside source frame bounds
    if (rawX >= fw || rawY >= fh || rawX + rawW <= 0 || rawY + rawH <= 0) {
      rejectedCount++;
      rejectionReasons.push(`Prediction[${idx}] lies outside source frame (${fw}x${fh}).`);
      return;
    }

    // Clamp box within source frame bounds
    const clampedX = Math.max(0, Math.min(fw, rawX));
    const clampedY = Math.max(0, Math.min(fh, rawY));
    const clampedW = Math.max(1, Math.min(fw - clampedX, rawW));
    const clampedH = Math.max(1, Math.min(fh - clampedY, rawH));

    const normX = Number(((clampedX / fw) * 100).toFixed(2));
    const normY = Number(((clampedY / fh) * 100).toFixed(2));
    const normW = Number(((clampedW / fw) * 100).toFixed(2));
    const normH = Number(((clampedH / fh) * 100).toFixed(2));

    const classId = COCO_CLASS_IDS[className] ?? 99;
    const rawConfidence = Number(score.toFixed(4));

    validDetections.push({
      detectionId: `DET-${frameContext.cameraId}-${frameContext.inferenceId}-${idx + 1}`,
      classId,
      className,
      confidence: rawConfidence,
      rawConfidence,
      boundingBox: {
        x: normX,
        y: normY,
        width: normW,
        height: normH,
      },
      pixelBox: {
        x: Math.round(clampedX),
        y: Math.round(clampedY),
        width: Math.round(clampedW),
        height: Math.round(clampedH),
      },
      sourceFrameWidth: fw,
      sourceFrameHeight: fh,
      timestamp,
      modelId: frameContext.modelId,
      modelVersion: frameContext.modelVersion,
      cameraId: frameContext.cameraId,
      inferenceId: frameContext.inferenceId,
      provenance: frameContext.provenance,
    });
  });

  return { validDetections, rejectedCount, rejectionReasons };
}

/**
 * PART D7: Configurable Confidence and Class Filtering
 * Keeps rawConfidence separate and returns both display-qualified and event-qualified detections.
 */
export function filterPredictionsByConfig(
  detections: NormalizedDetection[],
  config: DetectionFilterConfig = DEFAULT_DETECTION_FILTER_CONFIG
): {
  displayDetections: NormalizedDetection[];
  eventCandidateDetections: NormalizedDetection[];
} {
  const enabledSet = new Set(config.enabledClasses.map((c) => c.toLowerCase()));

  const classAndConfidenceFiltered = detections.filter((d) => {
    const cls = d.className.toLowerCase();
    if (enabledSet.size > 0 && !enabledSet.has(cls)) {
      return false;
    }
    const classMin = config.classThresholds[cls] ?? config.globalMinConfidence;
    const effectiveMin = Math.max(config.globalMinConfidence, classMin);
    return d.rawConfidence >= effectiveMin;
  });

  const displayDetections = classAndConfidenceFiltered.filter(
    (d) => d.rawConfidence >= config.displayThreshold
  );
  const eventCandidateDetections = classAndConfidenceFiltered.filter(
    (d) => d.rawConfidence >= config.eventGenerationThreshold
  );

  return { displayDetections, eventCandidateDetections };
}

/**
 * PART D8: Class-Aware Non-Maximum Suppression for NormalizedDetection[]
 * Suppresses overlapping boxes of the SAME class while preserving overlapping boxes of different classes.
 */
export function applyNormalizedClassAwareNMS(
  detections: NormalizedDetection[],
  iouThreshold = 0.5
): NormalizedDetection[] {
  if (!Array.isArray(detections) || detections.length === 0) {
    return [];
  }

  const valid = detections
    .filter(
      (d) =>
        d &&
        d.boundingBox &&
        Number.isFinite(d.boundingBox.x) &&
        Number.isFinite(d.boundingBox.y) &&
        d.boundingBox.width > 0 &&
        d.boundingBox.height > 0 &&
        Number.isFinite(d.confidence)
    )
    .slice()
    .sort((a, b) => b.confidence - a.confidence);

  const kept: NormalizedDetection[] = [];
  for (const candidate of valid) {
    const suppressed = kept.some(
      (existing) =>
        existing.className === candidate.className &&
        computeIoU(existing.boundingBox, candidate.boundingBox) > iouThreshold
    );
    if (!suppressed) {
      kept.push(candidate);
    }
  }
  return kept;
}

/**
 * PART D9: Camera-Scoped Object Tracking with Track Expiration & Non-Biometric Guarantee
 */
export function updateCameraObjectTracks(
  existingTracks: ObjectTrack[],
  nmsDetections: NormalizedDetection[],
  cameraId: string,
  zoneId: string,
  options: {
    nowIso?: string;
    maxMissedFrames?: number;
  } = {}
): ObjectTrack[] {
  const nowIso = options.nowIso || new Date().toISOString();
  const maxMissedFrames = options.maxMissedFrames ?? 3;
  const updatedTracks: ObjectTrack[] = [];
  const matchedDetectionIds = new Set<string>();

  for (const track of existingTracks) {
    if (track.cameraId !== cameraId) {
      updatedTracks.push(track);
      continue;
    }

    let bestDet: NormalizedDetection | null = null;
    let bestScore = 0;

    for (const det of nmsDetections) {
      if (matchedDetectionIds.has(det.detectionId) || det.className !== track.label) {
        continue;
      }
      const iou = computeIoU(track.bbox, det.boundingBox);
      const detCx = det.boundingBox.x + det.boundingBox.width / 2;
      const detCy = det.boundingBox.y + det.boundingBox.height / 2;
      const dist = Math.hypot(detCx - track.centroid.cx, detCy - track.centroid.cy);
      const centroidScore = dist < 25 ? (25 - dist) / 25 : 0;
      const combinedScore = iou * 0.65 + centroidScore * 0.35;
      if (combinedScore > bestScore && combinedScore >= 0.2) {
        bestScore = combinedScore;
        bestDet = det;
      }
    }

    if (bestDet) {
      matchedDetectionIds.add(bestDet.detectionId);
      const nextCx = Number((bestDet.boundingBox.x + bestDet.boundingBox.width / 2).toFixed(2));
      const nextCy = Number((bestDet.boundingBox.y + bestDet.boundingBox.height / 2).toFixed(2));
      const vx = Number((nextCx - track.centroid.cx).toFixed(2));
      const vy = Number((nextCy - track.centroid.cy).toFixed(2));
      const elapsedSec = Math.max(
        1,
        Math.round((new Date(nowIso).getTime() - new Date(track.lastUpdatedIso).getTime()) / 1000) || 1
      );

      updatedTracks.push({
        ...track,
        bbox: { ...bestDet.boundingBox },
        centroid: { cx: nextCx, cy: nextCy },
        velocity: { vx, vy },
        direction: classifyTrackDirection(vx, vy),
        confidence: bestDet.confidence,
        confidenceHistory: [...track.confidenceHistory.slice(-4), bestDet.confidence],
        persistenceFrames: track.persistenceFrames + 1,
        occludedFrames: 0,
        dwellSeconds: track.dwellSeconds + elapsedSec,
        lastUpdatedIso: nowIso,
        isBiometric: false,
      });
    } else if (track.occludedFrames + 1 <= maxMissedFrames) {
      updatedTracks.push({
        ...track,
        occludedFrames: track.occludedFrames + 1,
        lastUpdatedIso: nowIso,
      });
    }
    // Tracks exceeding maxMissedFrames are expired and not pushed
  }

  for (const det of nmsDetections) {
    if (matchedDetectionIds.has(det.detectionId)) continue;
    const cx = Number((det.boundingBox.x + det.boundingBox.width / 2).toFixed(2));
    const cy = Number((det.boundingBox.y + det.boundingBox.height / 2).toFixed(2));
    updatedTracks.push({
      trackId: `TRK-${cameraId}-${det.className.toUpperCase().replace(/\s+/g, '')}-${det.detectionId.slice(-4)}`,
      sessionId: `SES-${cameraId}-V15`,
      cameraId,
      zoneId,
      label: det.className,
      bbox: { ...det.boundingBox },
      centroid: { cx, cy },
      velocity: { vx: 0, vy: 0 },
      direction: 'STATIC',
      confidence: det.confidence,
      confidenceHistory: [det.confidence],
      persistenceFrames: 1,
      occludedFrames: 0,
      dwellSeconds: 1,
      lastUpdatedIso: nowIso,
      isBiometric: false,
    });
  }

  return updatedTracks;
}

/**
 * PART D10: Video-to-Canvas Coordinate Mapping with Aspect-Ratio & Object-Fit Handling
 */
export function mapBoxToCanvasCoordinates(
  normalizedBox: { x: number; y: number; width: number; height: number },
  geometry: {
    sourceWidth: number;
    sourceHeight: number;
    canvasWidth: number;
    canvasHeight: number;
    objectFit?: 'cover' | 'contain' | 'fill';
  }
): { x: number; y: number; width: number; height: number } {
  const { sourceWidth, sourceHeight, canvasWidth, canvasHeight, objectFit = 'cover' } = geometry;
  if (sourceWidth <= 0 || sourceHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  if (objectFit === 'fill') {
    return {
      x: Number(((normalizedBox.x / 100) * canvasWidth).toFixed(1)),
      y: Number(((normalizedBox.y / 100) * canvasHeight).toFixed(1)),
      width: Number(((normalizedBox.width / 100) * canvasWidth).toFixed(1)),
      height: Number(((normalizedBox.height / 100) * canvasHeight).toFixed(1)),
    };
  }

  const scaleX = canvasWidth / sourceWidth;
  const scaleY = canvasHeight / sourceHeight;
  const scale = objectFit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (canvasWidth - renderedWidth) / 2;
  const offsetY = (canvasHeight - renderedHeight) / 2;

  const pxX = (normalizedBox.x / 100) * sourceWidth;
  const pxY = (normalizedBox.y / 100) * sourceHeight;
  const pxW = (normalizedBox.width / 100) * sourceWidth;
  const pxH = (normalizedBox.height / 100) * sourceHeight;

  return {
    x: Number((offsetX + pxX * scale).toFixed(1)),
    y: Number((offsetY + pxY * scale).toFixed(1)),
    width: Number((pxW * scale).toFixed(1)),
    height: Number((pxH * scale).toFixed(1)),
  };
}

/**
 * PART D5 & PART J: Bounded Frame Scheduler with Overlap Prevention & Performance Profiles
 */
export class FrameInferenceScheduler {
  private profile: PerformanceProfile;
  private isRunning = false;
  private isPaused = false;
  private inFlight = false;
  private lastInferenceMs = 0;
  private processedFrames = 0;
  private skippedFrames = 0;

  constructor(profile: PerformanceProfile = 'BALANCED') {
    this.profile = profile;
  }

  public getMinIntervalMs(): number {
    switch (this.profile) {
      case 'LOW_RESOURCE':
        return 500; // ~2 FPS max inference
      case 'HIGH_PERFORMANCE':
        return 66; // ~15 FPS max inference
      case 'BALANCED':
      default:
        return 166; // ~6 FPS max inference
    }
  }

  public setProfile(profile: PerformanceProfile): void {
    this.profile = profile;
  }

  public getProfile(): PerformanceProfile {
    return this.profile;
  }

  public start(): void {
    this.isRunning = true;
    this.isPaused = false;
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    if (this.isRunning) {
      this.isPaused = false;
    }
  }

  public stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.inFlight = false;
  }

  public async tryScheduleFrame<T>(
    nowMs: number,
    task: () => Promise<T>
  ): Promise<{ executed: boolean; reason?: string; result?: T }> {
    if (!this.isRunning || this.isPaused) {
      return { executed: false, reason: 'SCHEDULER_STOPPED_OR_PAUSED' };
    }
    if (this.inFlight) {
      this.skippedFrames++;
      return { executed: false, reason: 'INFERENCE_IN_FLIGHT_OVERLAP_PREVENTED' };
    }
    if (this.lastInferenceMs > 0 && nowMs - this.lastInferenceMs < this.getMinIntervalMs()) {
      this.skippedFrames++;
      return { executed: false, reason: 'CADENCE_THROTTLED' };
    }

    this.inFlight = true;
    this.lastInferenceMs = nowMs;
    try {
      const result = await task();
      this.processedFrames++;
      return { executed: true, result };
    } finally {
      this.inFlight = false;
    }
  }

  public getStats(): {
    processedFrames: number;
    skippedFrames: number;
    inFlight: boolean;
    profile: PerformanceProfile;
    isRunning: boolean;
    isPaused: boolean;
  } {
    return {
      processedFrames: this.processedFrames,
      skippedFrames: this.skippedFrames,
      inFlight: this.inFlight,
      profile: this.profile,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
    };
  }
}

/**
 * PART F: Deterministic Event Generation from Verified Object Tracks & Detections
 */
export function evaluateDetectionEventRules(
  tracks: ObjectTrack[],
  detections: NormalizedDetection[],
  rules: DetectionEventRule[],
  existingEvents: SecurityEvent[],
  context: {
    tenantId: string;
    cameraId: string;
    cameraName: string;
    deviceId: string;
    zoneId: string;
    zoneName: string;
    nowIso?: string;
  }
): SecurityEvent[] {
  const nowIso = context.nowIso || new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const generatedEvents: SecurityEvent[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.zoneId && rule.zoneId !== context.zoneId) continue;

    const matchingTracks = tracks.filter(
      (t) =>
        t.cameraId === context.cameraId &&
        t.label.toLowerCase() === rule.objectClass.toLowerCase() &&
        t.confidence >= rule.minConfidence &&
        t.dwellSeconds >= rule.minPersistenceSeconds &&
        t.persistenceFrames >= rule.minRepeatedFrames
    );

    if (matchingTracks.length === 0) continue;

    // Check cooldown duplicate suppression
    const recentDuplicate = existingEvents.find((ev) => {
      if (ev.cameraId !== context.cameraId) return false;
      if (!ev.summary.includes(rule.ruleId)) return false;
      const evMs = new Date(ev.timestampIso).getTime();
      return Math.abs(nowMs - evMs) < rule.cooldownSeconds * 1000;
    });

    if (recentDuplicate) continue;

    const primaryTrack = matchingTracks[0];
    const matchingDet = detections.find((d) => d.className.toLowerCase() === rule.objectClass.toLowerCase());
    const provenanceLabel =
      matchingDet?.provenance === 'REAL_MODEL' ? 'Measured' : 'Simulated';

    generatedEvents.push({
      id: `EVT-${Date.now().toString(36).toUpperCase().slice(-4)}-${generatedEvents.length + 1}`,
      tenantId: context.tenantId,
      cameraId: context.cameraId,
      cameraName: context.cameraName,
      deviceId: context.deviceId,
      zoneId: context.zoneId,
      zoneName: context.zoneName,
      timestampIso: nowIso,
      category: primaryTrack.dwellSeconds >= 120 ? 'DWELL_THRESHOLD' : 'PERIMETER_MOTION',
      severity: rule.severity,
      confidence: primaryTrack.confidence,
      provenance: provenanceLabel,
      summary: `[${rule.ruleId}] Verified ${primaryTrack.label} track (${primaryTrack.trackId}) confirmed across ${primaryTrack.persistenceFrames} frames (${(
        primaryTrack.confidence * 100
      ).toFixed(0)}% conf, provenance=${matchingDet?.provenance || 'REAL_MODEL'}).`,
      evidenceMetadata: {
        objectCount: matchingTracks.length,
        dwellSeconds: primaryTrack.dwellSeconds,
        modelVersion: matchingDet
          ? `${matchingDet.modelId}@${matchingDet.modelVersion}`
          : 'TFJS-COCO-SSD-LiteMobilenetV2',
        frameHash: sha256Hex(`${context.cameraId}:${rule.ruleId}:${primaryTrack.trackId}:${nowIso}`),
      },
      verified: true,
    });
  }

  return generatedEvents;
}

/**
 * PART D3: Modular Model Provider Interface & Genuine TensorFlow.js COCO-SSD Implementation
 */
export interface VisionModelProvider {
  initialize(): Promise<{
    status: ModelProviderStatus;
    initTimeMs: number | null;
    error?: string;
  }>;
  getStatus(): ModelProviderStatus;
  detect(
    input: HTMLVideoElement | HTMLCanvasElement | ImageData,
    cameraId: string,
    provenance?: DetectionProvenance
  ): Promise<{
    rawPredictions: RawModelPrediction[];
    inferenceId: string;
    latencyMs: number;
    frameWidth: number;
    frameHeight: number;
    error?: string;
  }>;
  getModelMetadata(): {
    modelId: string;
    modelVersion: string;
    backend: string;
    status: ModelProviderStatus;
    initTimeMs: number | null;
  };
  dispose(): void;
}

export class TfjsCocoSsdProvider implements VisionModelProvider {
  private status: ModelProviderStatus = 'UNINITIALIZED';
  private model: {
    detect: (
      img: HTMLVideoElement | HTMLCanvasElement | ImageData,
      maxNumBoxes?: number,
      minScore?: number
    ) => Promise<RawModelPrediction[]>;
    dispose?: () => void;
  } | null = null;
  private initTimeMs: number | null = null;
  private backendName = 'webgl';
  private readonly customLoader?: () => Promise<{
    detect: (
      img: HTMLVideoElement | HTMLCanvasElement | ImageData,
      maxNumBoxes?: number,
      minScore?: number
    ) => Promise<RawModelPrediction[]>;
    dispose?: () => void;
  }>;

  constructor(
    customLoader?: () => Promise<{
      detect: (
        img: HTMLVideoElement | HTMLCanvasElement | ImageData,
        maxNumBoxes?: number,
        minScore?: number
      ) => Promise<RawModelPrediction[]>;
      dispose?: () => void;
    }>
  ) {
    this.customLoader = customLoader;
  }

  public getStatus(): ModelProviderStatus {
    return this.status;
  }

  public getModelMetadata() {
    return {
      modelId: 'tfjs-coco-ssd-lite_mobilenet_v2',
      modelVersion: '2.2.3',
      backend: this.backendName,
      status: this.status,
      initTimeMs: this.initTimeMs,
    };
  }

  public async initialize(): Promise<{
    status: ModelProviderStatus;
    initTimeMs: number | null;
    error?: string;
  }> {
    if (this.status === 'READY' && this.model) {
      return { status: 'READY', initTimeMs: this.initTimeMs };
    }
    if (this.status === 'LOADING') {
      return { status: 'LOADING', initTimeMs: null };
    }

    this.status = 'LOADING';
    const startMs = performance.now();
    try {
      if (this.customLoader) {
        this.model = await this.customLoader();
      } else {
        const tf = await import('@tensorflow/tfjs');
        await tf.ready();
        this.backendName = tf.getBackend() || 'cpu';
        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      }
      this.initTimeMs = Math.max(1, Math.round(performance.now() - startMs));
      this.status = 'READY';
      return { status: 'READY', initTimeMs: this.initTimeMs };
    } catch (err) {
      this.status = 'ERROR';
      const message = err instanceof Error ? err.message : 'Failed to initialize COCO-SSD model.';
      return { status: 'ERROR', initTimeMs: null, error: message };
    }
  }

  public async detect(
    input: HTMLVideoElement | HTMLCanvasElement | ImageData,
    cameraId: string
  ): Promise<{
    rawPredictions: RawModelPrediction[];
    inferenceId: string;
    latencyMs: number;
    frameWidth: number;
    frameHeight: number;
    error?: string;
  }> {
    const inferenceId = `INF-${cameraId}-${Date.now().toString(36).toUpperCase()}`;
    if ((this.status !== 'READY' && this.status !== 'RUNNING') || !this.model) {
      return {
        rawPredictions: [],
        inferenceId,
        latencyMs: 0,
        frameWidth: 0,
        frameHeight: 0,
        error: `Model provider is not READY (current status: ${this.status}).`,
      };
    }

    const frameWidth =
      (input as HTMLVideoElement).videoWidth ||
      (input as HTMLCanvasElement).width ||
      640;
    const frameHeight =
      (input as HTMLVideoElement).videoHeight ||
      (input as HTMLCanvasElement).height ||
      360;

    this.status = 'RUNNING';
    const startMs = performance.now();
    try {
      const rawPredictions = await this.model.detect(input, 20, 0.25);
      const latencyMs = Math.max(1, Math.round(performance.now() - startMs));
      this.status = 'READY';
      return {
        rawPredictions,
        inferenceId,
        latencyMs,
        frameWidth,
        frameHeight,
      };
    } catch (err) {
      this.status = 'ERROR';
      const message = err instanceof Error ? err.message : 'Model inference failed.';
      return {
        rawPredictions: [],
        inferenceId,
        latencyMs: Math.max(1, Math.round(performance.now() - startMs)),
        frameWidth,
        frameHeight,
        error: message,
      };
    }
  }

  public dispose(): void {
    try {
      this.model?.dispose?.();
    } catch {
      // ignore disposal errors
    }
    this.model = null;
    this.status = 'DISPOSED';
  }
}

/**
 * Convert NormalizedDetection[] to CameraEntity BoundingBox[] for backward compatibility
 */
export function normalizedToBoundingBoxes(
  detections: NormalizedDetection[],
  tracks: ObjectTrack[],
  zoneId: string
): BoundingBox[] {
  return detections.map((d) => {
    const matchingTrack = tracks.find(
      (t) =>
        t.label === d.className &&
        computeIoU(t.bbox, d.boundingBox) >= 0.3
    );
    return {
      id: matchingTrack?.trackId || d.detectionId,
      label: d.className,
      confidence: d.confidence,
      x: d.boundingBox.x,
      y: d.boundingBox.y,
      width: d.boundingBox.width,
      height: d.boundingBox.height,
      dwellSeconds: matchingTrack?.dwellSeconds ?? 1,
      zoneId,
    };
  });
}
