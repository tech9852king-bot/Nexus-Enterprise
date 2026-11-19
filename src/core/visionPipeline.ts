import {
  BoundingBox,
  DetectionEventRule,
  DetectionFilterConfig,
  DetectionProvenance,
  ModelProviderStatus,
  NormalizedDetection,
  ObjectTrack,
  PerformanceProfile,
  PipelineStageDiagnostics,
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

/**
 * Complete 80-class COCO-SSD label map (matching @tensorflow-models/coco-ssd classes)
 */
export const COCO_CLASS_IDS: Record<string, number> = {
  person: 1,
  bicycle: 2,
  car: 3,
  vehicle: 3,
  motorcycle: 4,
  airplane: 5,
  bus: 6,
  train: 7,
  truck: 8,
  boat: 9,
  'traffic light': 10,
  'fire hydrant': 11,
  'stop sign': 13,
  'parking meter': 14,
  bench: 15,
  bird: 16,
  cat: 17,
  dog: 18,
  horse: 19,
  sheep: 20,
  cow: 21,
  elephant: 22,
  bear: 23,
  zebra: 24,
  giraffe: 25,
  backpack: 27,
  umbrella: 28,
  handbag: 31,
  tie: 32,
  suitcase: 33,
  frisbee: 34,
  skis: 35,
  snowboard: 36,
  'sports ball': 37,
  kite: 38,
  'baseball bat': 39,
  'baseball glove': 40,
  skateboard: 41,
  surfboard: 42,
  'tennis racket': 43,
  bottle: 44,
  'wine glass': 46,
  cup: 47,
  fork: 48,
  knife: 49,
  spoon: 50,
  bowl: 51,
  banana: 52,
  apple: 53,
  sandwich: 54,
  orange: 55,
  broccoli: 56,
  carrot: 57,
  'hot dog': 58,
  pizza: 59,
  donut: 60,
  cake: 61,
  chair: 62,
  couch: 63,
  'potted plant': 64,
  potted_plant: 64,
  bed: 65,
  'dining table': 67,
  toilet: 70,
  tv: 72,
  laptop: 73,
  mouse: 74,
  remote: 75,
  keyboard: 76,
  'cell phone': 77,
  microwave: 78,
  oven: 79,
  toaster: 80,
  sink: 81,
  refrigerator: 82,
  book: 84,
  clock: 85,
  vase: 86,
  scissors: 87,
  'teddy bear': 88,
  'hair drier': 89,
  toothbrush: 90,
};

export const ALL_COCO_SSD_CLASSES: string[] = Object.keys(COCO_CLASS_IDS);

export const DEFAULT_DETECTION_FILTER_CONFIG: DetectionFilterConfig = {
  globalMinConfidence: 0.45,
  classThresholds: {
    person: 0.45,
    car: 0.45,
    truck: 0.45,
    vehicle: 0.45,
    laptop: 0.45,
    'cell phone': 0.45,
    backpack: 0.45,
  },
  displayThreshold: 0.45,
  eventGenerationThreshold: 0.65,
  enabledClasses: ALL_COCO_SSD_CLASSES,
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
    const rawClass = typeof candidate.class === 'string' ? candidate.class.trim().toLowerCase() : '';
    const className = rawClass === 'potted_plant' ? 'potted plant' : rawClass;
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
 * Keeps rawConfidence separate and returns both display-qualified and event-qualified detections,
 * plus exact counts of class-filtered and confidence-filtered predictions for Section 3.7 diagnostics.
 */
export function filterPredictionsByConfig(
  detections: NormalizedDetection[],
  config: DetectionFilterConfig = DEFAULT_DETECTION_FILTER_CONFIG
): {
  displayDetections: NormalizedDetection[];
  eventCandidateDetections: NormalizedDetection[];
  classFilteredCount: number;
  confidenceFilteredCount: number;
} {
  const enabledSet = new Set(
    config.enabledClasses.map((c) => {
      const norm = c.trim().toLowerCase();
      return norm === 'potted_plant' ? 'potted plant' : norm;
    })
  );

  let classFilteredCount = 0;
  let confidenceFilteredCount = 0;
  const classAndConfidenceFiltered: NormalizedDetection[] = [];

  for (const d of detections) {
    const cls = d.className.toLowerCase();
    if (enabledSet.size > 0 && !enabledSet.has(cls)) {
      classFilteredCount++;
      continue;
    }
    const classMin = config.classThresholds[cls] ?? config.globalMinConfidence;
    const effectiveMin = Math.max(config.globalMinConfidence, classMin, config.displayThreshold);
    if (d.rawConfidence < effectiveMin) {
      confidenceFilteredCount++;
      continue;
    }
    classAndConfidenceFiltered.push(d);
  }

  const displayDetections = classAndConfidenceFiltered;
  const eventCandidateDetections = classAndConfidenceFiltered.filter(
    (d) => d.rawConfidence >= config.eventGenerationThreshold
  );

  return {
    displayDetections,
    eventCandidateDetections,
    classFilteredCount,
    confidenceFilteredCount,
  };
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
 * Section 3.7 Complete Stage-by-Stage Detection Pipeline Execution & Diagnostics
 */
export function executeFullDetectionPipelinePass(
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
    sourceType?: 'LIVE_VIDEO' | 'TEST_FIXTURE';
  },
  filterConfig: DetectionFilterConfig = DEFAULT_DETECTION_FILTER_CONFIG
): {
  validDetections: NormalizedDetection[];
  displayDetections: NormalizedDetection[];
  eventCandidateDetections: NormalizedDetection[];
  nmsDetections: NormalizedDetection[];
  diagnostics: PipelineStageDiagnostics;
} {
  const timestampIso = frameContext.timestampIso || new Date().toISOString();
  const rawList = Array.isArray(rawPredictions) ? rawPredictions : [];
  const rawClassesObserved = rawList
    .filter((r): r is RawModelPrediction => Boolean(r && typeof r === 'object' && 'class' in (r as object)))
    .map((r) => ({
      className: String(r.class || '').trim().toLowerCase(),
      score: Number(Number(r.score || 0).toFixed(3)),
    }));

  const { validDetections, rejectedCount, rejectionReasons } = validateAndNormalizePredictions(
    rawPredictions,
    {
      ...frameContext,
      timestampIso,
    }
  );

  const {
    displayDetections,
    eventCandidateDetections,
    classFilteredCount,
    confidenceFilteredCount,
  } = filterPredictionsByConfig(validDetections, filterConfig);

  const nmsDetections = applyNormalizedClassAwareNMS(
    displayDetections,
    filterConfig.nmsIouThreshold
  );

  const nmsSuppressedCount = Math.max(0, displayDetections.length - nmsDetections.length);

  const diagnostics: PipelineStageDiagnostics = {
    inferenceId: frameContext.inferenceId,
    timestampIso,
    sourceType: frameContext.sourceType || (frameContext.provenance === 'REAL_MODEL' ? 'LIVE_VIDEO' : 'TEST_FIXTURE'),
    sourceDimensions: {
      width: frameContext.sourceFrameWidth,
      height: frameContext.sourceFrameHeight,
    },
    rawPredictionsCount: rawList.length,
    validPredictionsCount: validDetections.length,
    rejectedPredictionsCount: rejectedCount,
    rejectionReasons,
    confidenceFilteredCount,
    classFilteredCount,
    nmsSuppressedCount,
    finalDisplayedCount: nmsDetections.length,
    rawClassesObserved,
  };

  return {
    validDetections,
    displayDetections,
    eventCandidateDetections,
    nmsDetections,
    diagnostics,
  };
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
  const validDetections = (Array.isArray(nmsDetections) ? nmsDetections : []).filter(
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
  ).map((d, idx) => ({
    ...d,
    detectionId:
      typeof d.detectionId === 'string' && d.detectionId.length > 0
        ? d.detectionId
        : `DET-${cameraId}-${idx}`,
  }));

  for (const track of existingTracks) {
    if (track.cameraId !== cameraId) {
      updatedTracks.push(track);
      continue;
    }

    let bestDet: NormalizedDetection | null = null;
    let bestScore = 0;

    for (const det of validDetections) {
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

  for (const det of validDetections) {
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
    const matchingDet = detections.find(
      (d) => d.className.toLowerCase() === rule.objectClass.toLowerCase()
    );
    if (!matchingDet) continue;

    const isRealModel = matchingDet.provenance === 'REAL_MODEL';
    const provenanceLabel = isRealModel ? 'Measured' : 'Simulated';

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
      summary: `[${rule.ruleId}] ${isRealModel ? 'Verified' : 'Simulated'} ${primaryTrack.label} track (${primaryTrack.trackId}) confirmed across ${primaryTrack.persistenceFrames} frames (${(
        primaryTrack.confidence * 100
      ).toFixed(0)}% conf, provenance=${matchingDet.provenance}).`,
      evidenceMetadata: {
        objectCount: matchingTracks.length,
        dwellSeconds: primaryTrack.dwellSeconds,
        modelVersion: `${matchingDet.modelId}@${matchingDet.modelVersion}`,
        frameHash: sha256Hex(`${context.cameraId}:${rule.ruleId}:${primaryTrack.trackId}:${nowIso}`),
      },
      verified: isRealModel,
    });
  }

  return generatedEvents;
}

/**
 * PART D3: Modular Model Provider Interface & Genuine TensorFlow.js COCO-SSD Implementation
 */
export interface VisionModelProvider {
  initialize(options?: { forceManualRetry?: boolean }): Promise<{
    status: ModelProviderStatus;
    initTimeMs: number | null;
    backend?: string;
    error?: string;
    errorCategory?: string;
  }>;
  retryInitialize(): Promise<{
    status: ModelProviderStatus;
    initTimeMs: number | null;
    backend?: string;
    error?: string;
    errorCategory?: string;
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
    errorCategory?: string;
  }>;
  getModelMetadata(): {
    modelId: string;
    modelVersion: string;
    backend: string;
    status: ModelProviderStatus;
    initTimeMs: number | null;
    failureCount: number;
    lastError: string | null;
    lastErrorCategory: string | null;
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
  private backendName = 'uninitialized';
  private failureCount = 0;
  private lastFailureMs = 0;
  private lastError: string | null = null;
  private lastErrorCategory: string | null = null;
  private readonly maxAutoRetries = 2;
  private readonly baseBackoffMs = 1500;
  private initPromise: Promise<{
    status: ModelProviderStatus;
    initTimeMs: number | null;
    backend?: string;
    error?: string;
    errorCategory?: string;
  }> | null = null;
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
      failureCount: this.failureCount,
      lastError: this.lastError,
      lastErrorCategory: this.lastErrorCategory,
    };
  }

  public async retryInitialize(): Promise<{
    status: ModelProviderStatus;
    initTimeMs: number | null;
    backend?: string;
    error?: string;
    errorCategory?: string;
  }> {
    return this.initialize({ forceManualRetry: true });
  }

  public async initialize(options?: { forceManualRetry?: boolean }): Promise<{
    status: ModelProviderStatus;
    initTimeMs: number | null;
    backend?: string;
    error?: string;
    errorCategory?: string;
  }> {
    if (this.status === 'DISPOSED') {
      return {
        status: 'DISPOSED',
        initTimeMs: null,
        backend: this.backendName,
        error: 'Model provider has been disposed and cannot be reused.',
        errorCategory: 'PROVIDER_DISPOSED',
      };
    }
    if ((this.status === 'READY' || this.status === 'RUNNING') && this.model) {
      return { status: 'READY', initTimeMs: this.initTimeMs, backend: this.backendName };
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    // Section 3.3: Bounded retry with exponential backoff — prevent uncontrolled retry loops on every frame
    if (this.status === 'ERROR' && !options?.forceManualRetry) {
      if (this.failureCount >= this.maxAutoRetries) {
        return {
          status: 'ERROR',
          initTimeMs: null,
          backend: this.backendName,
          error:
            this.lastError ||
            `Model initialization failed after ${this.failureCount} attempts. Use explicit retry to attempt again.`,
          errorCategory: this.lastErrorCategory || 'MAX_RETRIES_EXCEEDED',
        };
      }
      const requiredBackoffMs = this.baseBackoffMs * Math.pow(2, Math.max(0, this.failureCount - 1));
      const elapsedMs = Date.now() - this.lastFailureMs;
      if (elapsedMs < requiredBackoffMs) {
        return {
          status: 'ERROR',
          initTimeMs: null,
          backend: this.backendName,
          error:
            this.lastError ||
            `Model retry backoff active (${Math.ceil((requiredBackoffMs - elapsedMs) / 1000)}s remaining).`,
          errorCategory: 'RETRY_BACKOFF_ACTIVE',
        };
      }
    }

    if (options?.forceManualRetry) {
      this.failureCount = 0;
      this.lastFailureMs = 0;
    }

    this.status = 'LOADING';
    const startMs = performance.now();
    this.initPromise = (async () => {
      try {
        const loadedModel = this.customLoader
          ? await (async () => {
              this.backendName = 'custom-provider';
              return this.customLoader!();
            })()
          : await (async () => {
              const tf = await import('@tensorflow/tfjs');
              await tf.ready();
              // Verify backend tensor allocation works; fall back to CPU if WebGL context is broken
              try {
                const probeTensor = tf.tensor1d([1, 2]);
                probeTensor.dispose();
                this.backendName = tf.getBackend() || 'webgl';
              } catch {
                await tf.setBackend('cpu');
                await tf.ready();
                this.backendName = tf.getBackend() || 'cpu';
              }
              const cocoSsd = await import('@tensorflow-models/coco-ssd');
              return cocoSsd.load({ base: 'lite_mobilenet_v2' });
            })();

        // Guard in case dispose() was called while model was loading
        if (this.status === 'DISPOSED') {
          loadedModel.dispose?.();
          return {
            status: 'DISPOSED' as ModelProviderStatus,
            initTimeMs: null,
            backend: this.backendName,
            error: 'Model provider was disposed during initialization.',
            errorCategory: 'PROVIDER_DISPOSED',
          };
        }

        this.model = loadedModel;
        this.initTimeMs = Math.max(1, Math.round(performance.now() - startMs));
        this.failureCount = 0;
        this.lastError = null;
        this.lastErrorCategory = null;
        this.status = 'READY';
        return {
          status: 'READY' as ModelProviderStatus,
          initTimeMs: this.initTimeMs,
          backend: this.backendName,
        };
      } catch (err) {
        this.failureCount += 1;
        this.lastFailureMs = Date.now();
        if (this.status !== 'DISPOSED') {
          this.status = 'ERROR';
        }
        const message =
          err instanceof Error ? err.message : 'Failed to initialize COCO-SSD model.';
        const category =
          message.toLowerCase().includes('fetch') || message.toLowerCase().includes('network')
            ? 'MODEL_DOWNLOAD_FAILED'
            : message.toLowerCase().includes('webgl') || message.toLowerCase().includes('backend')
              ? 'BACKEND_INIT_FAILED'
              : 'MODEL_INIT_FAILED';
        this.lastError = message;
        this.lastErrorCategory = category;
        return {
          status: this.status,
          initTimeMs: null,
          backend: this.backendName,
          error: message,
          errorCategory: category,
        };
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
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
    errorCategory?: string;
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
        errorCategory: 'MODEL_NOT_READY',
      };
    }

    const isVideo = typeof HTMLVideoElement !== 'undefined' && input instanceof HTMLVideoElement;
    const rawWidth = isVideo
      ? (input as HTMLVideoElement).videoWidth
      : (input as HTMLCanvasElement).width ?? (input as ImageData).width ?? 640;
    const rawHeight = isVideo
      ? (input as HTMLVideoElement).videoHeight
      : (input as HTMLCanvasElement).height ?? (input as ImageData).height ?? 360;

    if (rawWidth <= 0 || rawHeight <= 0) {
      return {
        rawPredictions: [],
        inferenceId,
        latencyMs: 0,
        frameWidth: 0,
        frameHeight: 0,
        error: `Input frame has invalid zero dimensions (${rawWidth}x${rawHeight}). Ensure video stream metadata is loaded.`,
        errorCategory: 'INVALID_FRAME_DIMENSIONS',
      };
    }

    const frameWidth = rawWidth;
    const frameHeight = rawHeight;

    this.status = 'RUNNING';
    const startMs = performance.now();
    try {
      const rawPredictions = await this.model.detect(input, 20, 0.25);
      const latencyMs = Math.max(1, Math.round(performance.now() - startMs));
      this.status = 'READY';
      return {
        rawPredictions: Array.isArray(rawPredictions) ? rawPredictions : [],
        inferenceId,
        latencyMs,
        frameWidth,
        frameHeight,
      };
    } catch (err) {
      this.status = 'ERROR';
      const message = err instanceof Error ? err.message : 'Model inference failed.';
      this.lastError = message;
      this.lastErrorCategory = 'INFERENCE_EXECUTION_FAILED';
      return {
        rawPredictions: [],
        inferenceId,
        latencyMs: Math.max(1, Math.round(performance.now() - startMs)),
        frameWidth,
        frameHeight,
        error: message,
        errorCategory: 'INFERENCE_EXECUTION_FAILED',
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
    this.initPromise = null;
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
  const validDetections = (Array.isArray(detections) ? detections : []).filter(
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
  );
  return validDetections.map((d, idx) => {
    const matchingTrack = tracks.find(
      (t) =>
        t.label === d.className &&
        computeIoU(t.bbox, d.boundingBox) >= 0.3
    );
    return {
      id: matchingTrack?.trackId || d.detectionId || `DET-${zoneId}-${idx}`,
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
