import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Camera,
  Cpu,
  Eye,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Sliders,
  Square,
  Video,
} from 'lucide-react';
import {
  CameraConnectionStatus,
  CameraEntity,
  DetectionFilterConfig,
  DetectionProvenance,
  MeasuredVisionTelemetry,
  ModelProviderStatus,
  NormalizedDetection,
  ObjectTrack,
  PerformanceProfile,
  PipelineStageDiagnostics,
  VantaSystemState,
} from '../core/types';
import {
  DEFAULT_DETECTION_FILTER_CONFIG,
  FrameInferenceScheduler,
  TfjsCocoSsdProvider,
  executeFullDetectionPipelinePass,
  mapBoxToCanvasCoordinates,
  updateCameraObjectTracks,
  validateVideoReadiness,
} from '../core/visionPipeline';

interface CameraWorkspaceProps {
  state: VantaSystemState;
  onReportTelemetry: (
    cameraId: string,
    payload: {
      isLiveWebcam: boolean;
      fps: number | null;
      inferenceLatencyMs: number | null;
      motionScore: number | null;
      normalizedDetections?: NormalizedDetection[];
      measuredVisionTelemetry?: Partial<MeasuredVisionTelemetry>;
    }
  ) => Promise<void>;
  onUpdateVisionConfig?: (
    filterConfig: Partial<DetectionFilterConfig>,
    telemetryPatch?: Partial<MeasuredVisionTelemetry>
  ) => Promise<void>;
}

export const CameraWorkspace: React.FC<CameraWorkspaceProps> = ({
  state,
  onReportTelemetry,
  onUpdateVisionConfig,
}) => {
  const [gridLayout, setGridLayout] = useState<1 | 2 | 4 | 6 | 9>(4);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(
    state.cameras[0]?.id || 'CAM-01'
  );
  const [showDetections, setShowDetections] = useState<boolean>(true);
  const [showZoneOverlay, setShowZoneOverlay] = useState<boolean>(true);
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [fullscreenCamId, setFullscreenCamId] = useState<string | null>(null);

  // Strict Preservation of Camera Refs & State + Section 3.1/7 Explicit Camera Status
  const [liveWebcamActive, setLiveWebcamActive] = useState<boolean>(false);
  const [cameraConnectionStatus, setCameraConnectionStatus] =
    useState<CameraConnectionStatus>('NOT CONNECTED');
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [cameraFps, setCameraFps] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Part D & E: Real Model Provider, Bounded Frame Scheduler & Truthful Measured Telemetry
  const providerRef = useRef<TfjsCocoSsdProvider | null>(null);
  const schedulerRef = useRef<FrameInferenceScheduler>(
    new FrameInferenceScheduler(
      state.measuredVisionTelemetry?.performanceProfile || 'BALANCED'
    )
  );

  const [modelStatus, setModelStatus] = useState<ModelProviderStatus>(
    state.measuredVisionTelemetry?.modelStatus || 'UNINITIALIZED'
  );
  const [modelBackend, setModelBackend] = useState<string>(
    state.measuredVisionTelemetry?.backend || 'uninitialized'
  );
  const [modelInitTimeMs, setModelInitTimeMs] = useState<number | null>(
    state.measuredVisionTelemetry?.modelInitTimeMs ?? null
  );
  const [inferenceLatencyMs, setInferenceLatencyMs] = useState<number | null>(
    state.measuredVisionTelemetry?.inferenceLatencyMs ?? null
  );
  const [inferenceFps, setInferenceFps] = useState<number | null>(
    state.measuredVisionTelemetry?.inferenceFps ?? null
  );
  const [processedFrames, setProcessedFrames] = useState<number>(
    state.measuredVisionTelemetry?.processedFrames ?? 0
  );
  const [skippedFrames, setSkippedFrames] = useState<number>(
    state.measuredVisionTelemetry?.skippedFrames ?? 0
  );
  const [errorCount, setErrorCount] = useState<number>(
    state.measuredVisionTelemetry?.errorCount ?? 0
  );
  const [lastModelError, setLastModelError] = useState<string | null>(
    state.measuredVisionTelemetry?.lastError ?? null
  );
  const [lastErrorCategory, setLastErrorCategory] = useState<string | null>(
    state.measuredVisionTelemetry?.lastErrorCategory ?? null
  );
  const [stageDiagnostics, setStageDiagnostics] =
    useState<PipelineStageDiagnostics | null>(
      state.measuredVisionTelemetry?.lastStageDiagnostics ?? null
    );
  const [selfTestFeedback, setSelfTestFeedback] = useState<string | null>(null);
  const [isSelfTesting, setIsSelfTesting] = useState<boolean>(false);
  const [performanceProfile, setPerformanceProfile] = useState<PerformanceProfile>(
    state.measuredVisionTelemetry?.performanceProfile || 'BALANCED'
  );
  const [provenanceMode, setProvenanceMode] = useState<DetectionProvenance>(
    state.measuredVisionTelemetry?.provenanceMode || 'REAL_MODEL'
  );
  const [schedulerPaused, setSchedulerPaused] = useState<boolean>(false);
  const [realDetections, setRealDetections] = useState<NormalizedDetection[]>(() =>
    (state.latestNormalizedDetections || []).filter(
      (d) => d.provenance === 'REAL_MODEL'
    )
  );
  const [localTracks, setLocalTracks] = useState<ObjectTrack[]>(
    state.activeTracks || []
  );

  // Refs to prevent stale closures and race conditions across start/stop/unmount
  const sessionGenerationRef = useRef<number>(0);
  const webcamStartingRef = useRef<boolean>(false);
  const liveWebcamActiveRef = useRef<boolean>(false);
  const cameraFpsRef = useRef<number | null>(null);
  const tracksRef = useRef<ObjectTrack[]>(state.activeTracks || []);
  const modelInitTimeMsRef = useRef<number | null>(
    state.measuredVisionTelemetry?.modelInitTimeMs ?? null
  );
  const errorCountRef = useRef<number>(
    state.measuredVisionTelemetry?.errorCount ?? 0
  );
  const inferenceTimestampsRef = useRef<number[]>([]);

  useEffect(() => {
    liveWebcamActiveRef.current = liveWebcamActive;
  }, [liveWebcamActive]);

  useEffect(() => {
    cameraFpsRef.current = cameraFps;
  }, [cameraFps]);

  useEffect(() => {
    tracksRef.current = localTracks;
  }, [localTracks]);

  // Keep stageDiagnostics & realDetections synchronized when canonical state updates via SSE or remount
  useEffect(() => {
    if (state.measuredVisionTelemetry?.lastStageDiagnostics && !stageDiagnostics) {
      setStageDiagnostics(state.measuredVisionTelemetry.lastStageDiagnostics);
    }
    if (!liveWebcamActiveRef.current && Array.isArray(state.latestNormalizedDetections)) {
      setRealDetections(
        state.latestNormalizedDetections.filter((d) => d.provenance === 'REAL_MODEL')
      );
    }
  }, [
    state.measuredVisionTelemetry?.lastStageDiagnostics,
    state.latestNormalizedDetections,
    stageDiagnostics,
  ]);

  // Filter Configuration (Part D7)
  const filterConfig: DetectionFilterConfig =
    state.detectionFilterConfig || DEFAULT_DETECTION_FILTER_CONFIG;

  const selectedCamera: CameraEntity | undefined =
    state.cameras.find((c) => c.id === selectedCameraId) || state.cameras[0];

  const stopWebcam = useCallback(() => {
    sessionGenerationRef.current += 1;
    webcamStartingRef.current = false;
    schedulerRef.current.stop();
    inferenceTimestampsRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    liveWebcamActiveRef.current = false;
    cameraFpsRef.current = null;
    setLiveWebcamActive(false);
    setCameraConnectionStatus('NOT CONNECTED');
    setCameraFps(null);
    setInferenceFps(null);
    setRealDetections([]);
    if (selectedCamera) {
      void onReportTelemetry(selectedCamera.id, {
        isLiveWebcam: false,
        fps: null,
        inferenceLatencyMs: null,
        motionScore: null,
        normalizedDetections: [],
        measuredVisionTelemetry: {
          cameraFps: null,
          inferenceFps: null,
          provenanceMode: 'SIMULATED_DEMO',
        },
      });
    }
  }, [onReportTelemetry, selectedCamera]);

  const initializeVisionModel = useCallback(
    async (options?: { forceManualRetry?: boolean }) => {
      if (
        !providerRef.current ||
        providerRef.current.getStatus() === 'DISPOSED'
      ) {
        providerRef.current = new TfjsCocoSsdProvider();
      }
      const currentStatus = providerRef.current.getStatus();
      if (currentStatus === 'READY') {
        setModelStatus('READY');
        setModelBackend(providerRef.current.getModelMetadata().backend);
        return true;
      }

      if (options?.forceManualRetry) {
        setLastModelError(null);
        setLastErrorCategory(null);
      }

      const res = await providerRef.current.initialize(options);
      const meta = providerRef.current.getModelMetadata();
      setModelStatus(res.status);
      setModelBackend(res.backend || meta.backend);

      if (res.initTimeMs !== null) {
        modelInitTimeMsRef.current = res.initTimeMs;
        setModelInitTimeMs(res.initTimeMs);
      }
      if (res.error) {
        if (res.errorCategory !== 'RETRY_BACKOFF_ACTIVE') {
          errorCountRef.current += 1;
          setErrorCount(errorCountRef.current);
        }
        setLastModelError(res.error);
        setLastErrorCategory(res.errorCategory || 'MODEL_INIT_FAILED');
      } else {
        setLastModelError(null);
        setLastErrorCategory(null);
      }
      await onUpdateVisionConfig?.(
        {},
        {
          modelStatus: res.status,
          backend: res.backend || meta.backend,
          modelInitTimeMs: res.initTimeMs,
          lastError: res.error || null,
          lastErrorCategory: res.errorCategory || null,
        }
      );
      return res.status === 'READY';
    },
    [onUpdateVisionConfig]
  );

  const startAuthorizedWebcam = async () => {
    if (webcamStartingRef.current || liveWebcamActiveRef.current) {
      return;
    }
    webcamStartingRef.current = true;
    const startGeneration = ++sessionGenerationRef.current;
    setWebcamError(null);
    setCameraConnectionStatus('PERMISSION REQUIRED');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Browser mediaDevices.getUserMedia API unavailable.');
      }
      setCameraConnectionStatus('CONNECTING');
      // Strictly reuse existing stream if already active to prevent duplicate camera streams
      if (!streamRef.current) {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 } },
          audio: false,
        });
        // If stopWebcam or unmount occurred while awaiting getUserMedia, clean up immediately
        if (sessionGenerationRef.current !== startGeneration) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = mediaStream;
      }

      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.srcObject = streamRef.current;
        // Wait for video metadata & dimensions before starting detection loop (Section 3.2)
        if (videoEl.readyState < 2 || videoEl.videoWidth === 0) {
          await new Promise<void>((resolve) => {
            let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
            const onReady = () => {
              if (fallbackTimer) clearTimeout(fallbackTimer);
              videoEl.removeEventListener('loadedmetadata', onReady);
              videoEl.removeEventListener('loadeddata', onReady);
              resolve();
            };
            videoEl.addEventListener('loadedmetadata', onReady);
            videoEl.addEventListener('loadeddata', onReady);
            fallbackTimer = setTimeout(onReady, 1500);
          });
        }
        await videoEl.play();
      }

      if (sessionGenerationRef.current !== startGeneration) {
        return;
      }

      liveWebcamActiveRef.current = true;
      setLiveWebcamActive(true);
      setCameraConnectionStatus('CONNECTED');
      setProvenanceMode('REAL_MODEL');
      schedulerRef.current.start();
      if (schedulerPaused) {
        schedulerRef.current.pause();
      }
      // Initialize model independently without blocking or killing camera playback on model failure
      void initializeVisionModel();
    } catch (err) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const msg =
        err instanceof Error
          ? err.message
          : 'Camera permission denied or hardware unavailable.';
      const isPermissionDenied =
        msg.toLowerCase().includes('permission') ||
        msg.toLowerCase().includes('notallowed') ||
        msg.toLowerCase().includes('denied');
      setCameraConnectionStatus(
        isPermissionDenied ? 'PERMISSION REQUIRED' : 'ERROR'
      );
      setWebcamError(
        `Live hardware stream unavailable (${msg}). Camera state is ${
          isPermissionDenied ? 'PERMISSION REQUIRED' : 'ERROR'
        }.`
      );
      liveWebcamActiveRef.current = false;
      cameraFpsRef.current = null;
      setLiveWebcamActive(false);
      setCameraFps(null);
    } finally {
      webcamStartingRef.current = false;
    }
  };

  // Clean disposal of camera stream and model provider on unmount (Part D2 & Part K18-19)
  useEffect(() => {
    return () => {
      sessionGenerationRef.current += 1;
      schedulerRef.current.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      providerRef.current?.dispose();
    };
  }, []);

  // Execute a single genuine inference pass through the full Section 3.4 - 3.10 pipeline
  const executePipelinePass = useCallback(
    async (
      sourceElement: HTMLVideoElement | HTMLCanvasElement,
      options: {
        isManualPass?: boolean;
        sourceType?: 'LIVE_VIDEO' | 'TEST_FIXTURE';
        provenanceOverride?: DetectionProvenance;
      } = {}
    ) => {
      if (!selectedCamera) return;
      const passGeneration = sessionGenerationRef.current;
      const targetCameraId = selectedCamera.id;
      const targetZoneId = selectedCamera.zoneId;
      const effectiveSourceType = options.sourceType || 'LIVE_VIDEO';
      const effectiveProvenance: DetectionProvenance =
        options.provenanceOverride || 'REAL_MODEL';

      if (!providerRef.current || providerRef.current.getStatus() !== 'READY') {
        const ok = await initializeVisionModel({
          forceManualRetry: Boolean(options.isManualPass),
        });
        if (!ok || !providerRef.current) return;
      }
      if (
        !options.isManualPass &&
        (sessionGenerationRef.current !== passGeneration || !liveWebcamActiveRef.current)
      ) {
        return;
      }

      const provider = providerRef.current;
      const meta = provider.getModelMetadata();
      setModelStatus('RUNNING');
      setModelBackend(meta.backend);

      const detectionOutcome = await provider.detect(
        sourceElement,
        targetCameraId
      );

      // Discard stale inference if camera was stopped or session changed while inference was in-flight
      if (
        !options.isManualPass &&
        (sessionGenerationRef.current !== passGeneration || !liveWebcamActiveRef.current)
      ) {
        setModelStatus(provider.getStatus());
        return;
      }

      setModelStatus(provider.getStatus());
      setModelBackend(provider.getModelMetadata().backend);

      if (detectionOutcome.error) {
        errorCountRef.current += 1;
        setErrorCount(errorCountRef.current);
        setLastModelError(detectionOutcome.error);
        setLastErrorCategory(
          detectionOutcome.errorCategory || 'INFERENCE_EXECUTION_FAILED'
        );
        return;
      }

      setInferenceLatencyMs(detectionOutcome.latencyMs);

      // Measure actual completed inference FPS over a rolling 1-second window when live stream is active
      let measuredInfFps: number | null = null;
      if (liveWebcamActiveRef.current && effectiveSourceType === 'LIVE_VIDEO') {
        const nowPerf = performance.now();
        const recent = inferenceTimestampsRef.current.filter(
          (ts) => nowPerf - ts <= 1000
        );
        recent.push(nowPerf);
        inferenceTimestampsRef.current = recent;
        measuredInfFps = recent.length;
      }
      setInferenceFps(measuredInfFps);

      // Full stage-by-stage detection pipeline with complete diagnostic counts (Section 3.4 - 3.7)
      const passResult = executeFullDetectionPipelinePass(
        detectionOutcome.rawPredictions,
        {
          sourceFrameWidth: detectionOutcome.frameWidth,
          sourceFrameHeight: detectionOutcome.frameHeight,
          cameraId: targetCameraId,
          modelId: meta.modelId,
          modelVersion: meta.modelVersion,
          inferenceId: detectionOutcome.inferenceId,
          provenance: effectiveProvenance,
          sourceType: effectiveSourceType,
        },
        filterConfig
      );

      const { nmsDetections, diagnostics } = passResult;
      setStageDiagnostics(diagnostics);

      if (effectiveSourceType === 'TEST_FIXTURE') {
        setSelfTestFeedback(
          `Model Self-Test Verified (${diagnostics.inferenceId}): TensorFlow.js COCO-SSD (${provider.getModelMetadata().backend}) executed in ${detectionOutcome.latencyMs}ms on ${diagnostics.sourceDimensions.width}x${diagnostics.sourceDimensions.height} fixture (Raw=${diagnostics.rawPredictionsCount}, Valid=${diagnostics.validPredictionsCount}, Final=${diagnostics.finalDisplayedCount}, Provenance=IMPORTED_SAMPLE).`
        );
      }

      // Only mutate live camera tracks and realDetections if this was a LIVE_VIDEO pass
      let nextTracks = tracksRef.current;
      if (effectiveSourceType === 'LIVE_VIDEO') {
        nextTracks = updateCameraObjectTracks(
          tracksRef.current,
          nmsDetections,
          targetCameraId,
          targetZoneId
        );
        tracksRef.current = nextTracks;
        setRealDetections(nmsDetections);
        setLocalTracks(nextTracks);
      }

      const activeCamTracks = nextTracks.filter(
        (t) => t.cameraId === targetCameraId && t.occludedFrames === 0
      );
      const measuredDisplacement =
        activeCamTracks.length > 0
          ? Number(
              Math.max(
                ...activeCamTracks.map((t) =>
                  Math.hypot(t.velocity.vx, t.velocity.vy)
                )
              ).toFixed(2)
            )
          : 0;

      const stats = schedulerRef.current.getStats();
      setProcessedFrames(stats.processedFrames);
      setSkippedFrames(stats.skippedFrames);

      const currentCamFps = liveWebcamActiveRef.current
        ? cameraFpsRef.current
        : null;

      await onReportTelemetry(targetCameraId, {
        isLiveWebcam: liveWebcamActiveRef.current,
        fps: currentCamFps,
        inferenceLatencyMs: detectionOutcome.latencyMs,
        motionScore: liveWebcamActiveRef.current ? measuredDisplacement : null,
        normalizedDetections:
          effectiveSourceType === 'LIVE_VIDEO' ? nmsDetections : undefined,
        measuredVisionTelemetry: {
          modelStatus: provider.getStatus(),
          modelId: meta.modelId,
          modelVersion: meta.modelVersion,
          backend: provider.getModelMetadata().backend,
          modelInitTimeMs: modelInitTimeMsRef.current,
          inferenceLatencyMs: detectionOutcome.latencyMs,
          processedFrames: stats.processedFrames,
          skippedFrames: stats.skippedFrames,
          cameraFps: currentCamFps,
          inferenceFps: measuredInfFps,
          errorCount: errorCountRef.current,
          lastError: null,
          lastErrorCategory: null,
          performanceProfile,
          provenanceMode: liveWebcamActiveRef.current
            ? 'REAL_MODEL'
            : effectiveProvenance,
          lastStageDiagnostics: diagnostics,
        },
      });
    },
    [
      selectedCamera,
      initializeVisionModel,
      filterConfig,
      onReportTelemetry,
      performanceProfile,
    ]
  );

  // Continuous bounded frame scheduler loop when live webcam is active (Section 3.3 & 3.4)
  useEffect(() => {
    if (!liveWebcamActive) return;
    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    schedulerRef.current.start();
    if (schedulerPaused) {
      schedulerRef.current.pause();
    }

    const loop = async () => {
      if (!active || !liveWebcamActiveRef.current) return;
      const videoEl = videoRef.current;
      const readiness = validateVideoReadiness(videoEl);
      const currentProviderStatus =
        providerRef.current?.getStatus() || 'UNINITIALIZED';

      // Prevent uncontrolled retry loops: only run loop pass when provider is READY
      if (
        readiness.ready &&
        videoEl &&
        provenanceMode === 'REAL_MODEL' &&
        currentProviderStatus === 'READY'
      ) {
        await schedulerRef.current.tryScheduleFrame(performance.now(), async () => {
          await executePipelinePass(videoEl, {
            isManualPass: false,
            sourceType: 'LIVE_VIDEO',
            provenanceOverride: 'REAL_MODEL',
          });
        });
        if (active) {
          const stats = schedulerRef.current.getStats();
          setProcessedFrames(stats.processedFrames);
          setSkippedFrames(stats.skippedFrames);
        }
      }
      if (active && liveWebcamActiveRef.current) {
        timerId = setTimeout(loop, 80);
      }
    };

    timerId = setTimeout(loop, 150);
    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [liveWebcamActive, provenanceMode, schedulerPaused, executePipelinePass]);

  // Part D10: Accurate Overlay Rendering (Zero sinusoidal fake movement & zero idle 60fps CPU burn when webcam is off)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedCamera) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameCount = 0;
    let animId = 0;
    let lastTime = performance.now();

    const drawOverlay = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // When live webcam is not active, draw clean dark command grid background
      if (!liveWebcamActive) {
        ctx.fillStyle = '#070b14';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 48) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += 48) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      }

      // Zone Polygon Overlay
      if (showZoneOverlay) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(w * 0.08, h * 0.14, w * 0.84, h * 0.74);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillText(
          `ZONE: ${selectedCamera.zoneId} · ${selectedCamera.zoneName}`,
          w * 0.1,
          h * 0.2
        );
      }

      // Part D10: Strict separation between REAL_MODEL and explicit SIMULATED_DEMO mode
      if (showDetections) {
        if (provenanceMode === 'REAL_MODEL') {
          const sourceW = videoRef.current?.videoWidth || 640;
          const sourceH = videoRef.current?.videoHeight || 360;

          realDetections
            .filter((det) => det.cameraId === selectedCamera.id)
            .forEach((det) => {
              const mapped = mapBoxToCanvasCoordinates(det.boundingBox, {
                sourceWidth: sourceW,
                sourceHeight: sourceH,
                canvasWidth: w,
                canvasHeight: h,
                objectFit: 'cover',
              });

              ctx.strokeStyle = '#10b981';
              ctx.lineWidth = 2;
              ctx.strokeRect(mapped.x, mapped.y, mapped.width, mapped.height);

              ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
              ctx.fillRect(mapped.x, mapped.y, mapped.width, mapped.height);

              // Centroid marker
              const cx = mapped.x + mapped.width / 2;
              const cy = mapped.y + mapped.height / 2;
              ctx.fillStyle = '#38bdf8';
              ctx.beginPath();
              ctx.arc(cx, cy, 3, 0, Math.PI * 2);
              ctx.fill();

              ctx.fillStyle = '#f8fafc';
              ctx.font = '600 11px "JetBrains Mono", monospace';
              ctx.fillText(
                `[REAL_MODEL] ${det.className} ${(det.confidence * 100).toFixed(0)}% · ${det.detectionId.slice(-6)}`,
                mapped.x + 4,
                Math.max(14, mapped.y - 6)
              );
            });
        } else {
          // Explicit SIMULATED_DEMO mode — deterministic coordinates, ZERO fake sinusoidal movement
          selectedCamera.activeDetections.forEach((det) => {
            const mapped = mapBoxToCanvasCoordinates(det, {
              sourceWidth: 640,
              sourceHeight: 360,
              canvasWidth: w,
              canvasHeight: h,
              objectFit: 'fill',
            });

            ctx.strokeStyle = '#f59e0b';
            ctx.setLineDash([5, 3]);
            ctx.lineWidth = 1.75;
            ctx.strokeRect(mapped.x, mapped.y, mapped.width, mapped.height);
            ctx.setLineDash([]);

            ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
            ctx.fillRect(mapped.x, mapped.y, mapped.width, mapped.height);

            ctx.fillStyle = '#fde68a';
            ctx.font = '500 11px "JetBrains Mono", monospace';
            ctx.fillText(
              `[SIMULATED_DEMO] ${det.label} ${(det.confidence * 100).toFixed(0)}% · dwell ${det.dwellSeconds}s`,
              mapped.x + 4,
              Math.max(14, mapped.y - 6)
            );
          });
        }
      }

      // Bottom provenance & model telemetry ruler
      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 11px "JetBrains Mono", monospace';
      ctx.fillText(
        `PROVENANCE: ${provenanceMode} · MODEL: ${modelStatus} (${modelBackend}) · CAMERA: ${cameraConnectionStatus}`,
        16,
        h - 14
      );
    };

    if (!liveWebcamActive) {
      drawOverlay();
      return;
    }

    const renderLoop = (now: number) => {
      frameCount++;
      const dt = now - lastTime;
      if (dt >= 1000) {
        setCameraFps(Math.min(60, Math.round((frameCount * 1000) / dt)));
        frameCount = 0;
        lastTime = now;
      }
      drawOverlay();
      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [
    selectedCamera,
    showDetections,
    showZoneOverlay,
    liveWebcamActive,
    cameraConnectionStatus,
    provenanceMode,
    realDetections,
    modelStatus,
    modelBackend,
  ]);

  const displayedCameras = state.cameras.slice(0, gridLayout);
  const cameraTracks = localTracks.filter((t) => t.cameraId === selectedCamera?.id);
  const selectedRealDetections = realDetections.filter(
    (d) => d.cameraId === selectedCamera?.id
  );

  return (
    <div className="space-y-5">
      {/* Camera Workspace Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-100">
            Camera Command & Real-Time Vision Intelligence (V16.0)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Genuine TensorFlow.js COCO-SSD (80-Class) Inference Pipeline · Bounded Retry & Frame Scheduler · Stage-by-Stage Diagnostics
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Provenance Mode Selector (Part D10 & Part E) */}
          <div
            className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg"
            role="group"
            aria-label="Detection provenance mode"
          >
            <button
              type="button"
              onClick={() => setProvenanceMode('REAL_MODEL')}
              className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                provenanceMode === 'REAL_MODEL'
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              REAL_MODEL
            </button>
            <button
              type="button"
              onClick={() => setProvenanceMode('SIMULATED_DEMO')}
              className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                provenanceMode === 'SIMULATED_DEMO'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              SIMULATED_DEMO
            </button>
          </div>

          {/* Grid Selector */}
          <div
            className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg"
            role="group"
            aria-label="Camera grid layout"
          >
            {([1, 2, 4, 6, 9] as const).map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setGridLayout(count)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  gridLayout === count
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {count}-View
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setFocusMode((v) => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              focusMode
                ? 'bg-sky-600 text-white border-sky-500'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            {focusMode ? 'Focus Mode: Active' : 'Focus Mode: Off'}
          </button>

          {!liveWebcamActive ? (
            <button
              type="button"
              data-testid="authorize-webcam-btn"
              onClick={startAuthorizedWebcam}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 inline mr-1.5" />
              Authorize Local Webcam
            </button>
          ) : (
            <button
              type="button"
              data-testid="stop-webcam-btn"
              onClick={stopWebcam}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="w-3.5 h-3.5 inline mr-1.5" />
              Stop Local Webcam
            </button>
          )}
        </div>
      </div>

      {/* Truthful Measured Telemetry Strip (Section 3.3 & Section 7) */}
      <div
        data-testid="measured-vision-telemetry-bar"
        className="border border-slate-800 rounded-xl bg-slate-900/90 p-3.5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono tabular-nums"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span
            data-testid="camera-connection-status"
            className={
              cameraConnectionStatus === 'CONNECTED'
                ? 'text-emerald-400 font-semibold'
                : cameraConnectionStatus === 'ERROR' ||
                  cameraConnectionStatus === 'PERMISSION REQUIRED'
                ? 'text-rose-400 font-semibold'
                : 'text-slate-300 font-semibold'
            }
          >
            CAMERA: {cameraConnectionStatus}
          </span>
          <span>·</span>
          <span className="text-slate-400">
            MODEL:{' '}
            <strong className="text-slate-100">
              tfjs-coco-ssd-lite_mobilenet_v2
            </strong>{' '}
            ({modelBackend})
          </span>
          <span>·</span>
          <span
            data-testid="vision-model-status"
            className={
              modelStatus === 'READY' || modelStatus === 'RUNNING'
                ? 'text-emerald-400 font-semibold'
                : modelStatus === 'ERROR'
                ? 'text-rose-400 font-semibold'
                : 'text-amber-400 font-semibold'
            }
          >
            MODEL STATUS: {modelStatus}
          </span>
          <span>·</span>
          <span className="text-slate-300">
            INIT: {modelInitTimeMs !== null ? `${modelInitTimeMs}ms` : 'N/A'}
          </span>
          <span>·</span>
          <span className="text-slate-300">
            LATENCY:{' '}
            {inferenceLatencyMs !== null ? `${inferenceLatencyMs}ms` : 'N/A'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-slate-400">
          <span>
            CAM FPS: {cameraFps !== null ? `${cameraFps}` : 'N/A'}
          </span>
          <span>·</span>
          <span>
            INFERENCE FPS: {inferenceFps !== null ? `${inferenceFps}` : 'N/A'}
          </span>
          <span>·</span>
          <span>
            FRAMES: {processedFrames} proc / {skippedFrames} skip
          </span>
          <span>·</span>
          <span>ERRORS: {errorCount}</span>
          {(modelStatus === 'UNINITIALIZED' || modelStatus === 'ERROR') && (
            <button
              type="button"
              data-testid="retry-model-init-btn"
              onClick={() => void initializeVisionModel({ forceManualRetry: true })}
              className="px-2.5 py-1 rounded bg-sky-600/20 border border-sky-500/40 text-sky-300 hover:bg-sky-600/30 font-semibold transition-colors"
            >
              <RefreshCw className="w-3 h-3 inline mr-1" />
              {modelStatus === 'ERROR' ? 'Retry Model Init' : 'Preload Model'}
            </button>
          )}
        </div>
      </div>

      {(webcamError || lastModelError) && (
        <div
          role="status"
          data-testid="vision-error-banner"
          className="p-3.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="space-y-0.5">
            {webcamError && <div>Camera Diagnostic: {webcamError}</div>}
            {lastModelError && (
              <div>
                Model Diagnostic [{lastErrorCategory || 'ERROR'}]: {lastModelError}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {lastModelError && (
              <button
                type="button"
                onClick={() => void initializeVisionModel({ forceManualRetry: true })}
                className="px-2.5 py-1 rounded bg-amber-500/20 border border-amber-400/40 text-amber-100 hover:bg-amber-500/30 font-semibold"
              >
                Retry Model Initialization
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setWebcamError(null);
                setLastModelError(null);
              }}
              className="text-xs font-medium underline whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {selfTestFeedback && (
        <div
          role="status"
          data-testid="model-selftest-banner"
          className="p-3.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-xs text-sky-200 font-mono flex flex-wrap items-center justify-between gap-3"
        >
          <span>{selfTestFeedback}</span>
          <button
            type="button"
            onClick={() => setSelfTestFeedback(null)}
            className="text-xs font-sans font-medium underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Primary Interactive Vision Canvas + Pipeline Controls */}
      {selectedCamera && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-8 border border-slate-800 rounded-xl bg-slate-950 overflow-hidden flex flex-col justify-between">
            <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
              <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                <Video className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="font-semibold text-white whitespace-nowrap">
                  {selectedCamera.id}
                </span>
                <span>·</span>
                <span className="whitespace-nowrap">{selectedCamera.name}</span>
                <span>·</span>
                <span
                  className={
                    provenanceMode === 'REAL_MODEL'
                      ? 'text-emerald-400 font-semibold whitespace-nowrap'
                      : 'text-amber-300 font-semibold whitespace-nowrap'
                  }
                >
                  PROVENANCE: {provenanceMode}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDetections((v) => !v)}
                  className="px-2.5 py-1 text-xs font-mono rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                >
                  <Eye className="w-3.5 h-3.5 inline mr-1" />
                  {showDetections ? 'Boxes: ON' : 'Boxes: OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowZoneOverlay((v) => !v)}
                  className="px-2.5 py-1 text-xs font-mono rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                >
                  {showZoneOverlay ? 'Zones: ON' : 'Zones: OFF'}
                </button>
              </div>
            </div>

            {/* Video Element kept mounted without display:none so dimensions decode reliably (Section 3.2) */}
            <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center">
              <video
                ref={videoRef}
                muted
                playsInline
                className={`absolute inset-0 w-full h-full object-cover transition-opacity ${
                  liveWebcamActive
                    ? 'opacity-95'
                    : 'opacity-0 pointer-events-none'
                }`}
              />
              <canvas
                ref={canvasRef}
                width={768}
                height={432}
                data-testid="vision-telemetry-canvas"
                className="w-full h-full object-cover relative z-10"
              />
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <div className="font-mono tabular-nums">
                Active Detections ({provenanceMode}):{' '}
                {provenanceMode === 'REAL_MODEL'
                  ? selectedRealDetections.length
                  : selectedCamera.activeDetections.length}{' '}
                · Camera-Scoped Tracks: {cameraTracks.length}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (schedulerPaused) {
                      schedulerRef.current.resume();
                      setSchedulerPaused(false);
                    } else {
                      schedulerRef.current.pause();
                      setSchedulerPaused(true);
                    }
                  }}
                  className="px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 font-medium transition-colors whitespace-nowrap"
                >
                  <Pause className="w-3.5 h-3.5 inline mr-1" />
                  {schedulerPaused ? 'Resume Scheduler' : 'Pause Scheduler'}
                </button>

                <button
                  type="button"
                  data-testid="verify-model-fixture-btn"
                  disabled={isSelfTesting}
                  onClick={async () => {
                    if (isSelfTesting) return;
                    setIsSelfTesting(true);
                    try {
                      const fixtureCanvas = document.createElement('canvas');
                      fixtureCanvas.width = 320;
                      fixtureCanvas.height = 240;
                      const fCtx = fixtureCanvas.getContext('2d', {
                        willReadFrequently: true,
                      });
                      if (fCtx) {
                        fCtx.fillStyle = '#0f172a';
                        fCtx.fillRect(0, 0, 320, 240);
                        fCtx.fillStyle = '#38bdf8';
                        fCtx.fillRect(110, 50, 100, 140);
                      }
                      await executePipelinePass(fixtureCanvas, {
                        isManualPass: true,
                        sourceType: 'TEST_FIXTURE',
                        provenanceOverride: 'IMPORTED_SAMPLE',
                      });
                    } finally {
                      setIsSelfTesting(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-md bg-slate-900 border border-slate-700 hover:bg-slate-800 disabled:opacity-50 text-slate-200 font-medium transition-colors whitespace-nowrap"
                  title="Initializes COCO-SSD and verifies model tensor execution on an off-camera test canvas (labeled IMPORTED_SAMPLE, never mixes with live webcam detections)"
                >
                  <Activity className="w-3.5 h-3.5 inline mr-1.5 text-sky-400" />
                  {isSelfTesting
                    ? 'Running Self-Test...'
                    : 'Verify Model Self-Test (Non-Camera)'}
                </button>

                <button
                  type="button"
                  data-testid="run-real-inference-btn"
                  disabled={!liveWebcamActive}
                  onClick={async () => {
                    if (liveWebcamActive && videoRef.current) {
                      await executePipelinePass(videoRef.current, {
                        isManualPass: true,
                        sourceType: 'LIVE_VIDEO',
                        provenanceOverride: 'REAL_MODEL',
                      });
                    }
                  }}
                  title={
                    liveWebcamActive
                      ? 'Run an immediate COCO-SSD inference pass on the live connected webcam frame'
                      : 'Unavailable: Connect and authorize a live local webcam first to run live camera inference'
                  }
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                    liveWebcamActive
                      ? 'bg-sky-600 hover:bg-sky-500 text-white'
                      : 'bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5 inline mr-1.5" />
                  {liveWebcamActive
                    ? 'Run Live Camera Inference'
                    : 'Live Inference (Connect Camera First)'}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Performance Profile, Threshold Calibration, Stage Diagnostics & Active Detections */}
          <div className="lg:col-span-4 border border-slate-800 rounded-xl bg-slate-900 p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              {/* Performance Profile & Threshold Configuration (Part D7 & Part J) */}
              <div className="border-b border-slate-800 pb-3 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <Sliders className="w-3.5 h-3.5 text-sky-400" />
                    SCHEDULER & FILTER GOVERNANCE
                  </span>
                  <span>
                    {filterConfig.enabledClasses.length} COCO CLASSES ACTIVE
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'LOW_RESOURCE', label: 'Low (2Hz)' },
                      { id: 'BALANCED', label: 'Balanced (6Hz)' },
                      { id: 'HIGH_PERFORMANCE', label: 'High (15Hz)' },
                    ] as const
                  ).map((prof) => (
                    <button
                      key={prof.id}
                      type="button"
                      onClick={() => {
                        setPerformanceProfile(prof.id);
                        schedulerRef.current.setProfile(prof.id);
                        onUpdateVisionConfig?.({}, { performanceProfile: prof.id });
                      }}
                      className={`px-2 py-1.5 text-xs font-mono rounded border transition-colors ${
                        performanceProfile === prof.id
                          ? 'bg-sky-500/20 border-sky-500 text-sky-300 font-semibold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {prof.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-xs font-mono">
                  <div>
                    <label
                      htmlFor="min-conf-select"
                      className="block text-slate-400 mb-1"
                    >
                      Min Confidence
                    </label>
                    <select
                      id="min-conf-select"
                      value={filterConfig.globalMinConfidence}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        onUpdateVisionConfig?.({
                          globalMinConfidence: val,
                          displayThreshold: val,
                        });
                      }}
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-200"
                    >
                      <option value={0.35}>35% (High Recall)</option>
                      <option value={0.45}>45% (Calibrated)</option>
                      <option value={0.6}>60% (Strict)</option>
                      <option value={0.75}>75% (Ultra-Strict)</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="nms-iou-select"
                      className="block text-slate-400 mb-1"
                    >
                      NMS IoU Overlap
                    </label>
                    <select
                      id="nms-iou-select"
                      value={filterConfig.nmsIouThreshold}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        onUpdateVisionConfig?.({ nmsIouThreshold: val });
                      }}
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-200"
                    >
                      <option value={0.4}>0.40 IoU</option>
                      <option value={0.5}>0.50 IoU (Default)</option>
                      <option value={0.65}>0.65 IoU</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 3.7: Stage-by-Stage Detection Pipeline Diagnostics */}
              <div
                data-testid="pipeline-stage-diagnostics"
                className="border-b border-slate-800 pb-3 space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="font-semibold text-slate-200">
                    PIPELINE STAGE DIAGNOSTICS
                  </span>
                  <span className="text-slate-400">
                    {stageDiagnostics ? stageDiagnostics.sourceType : 'NO PASS YET'}
                  </span>
                </div>
                {stageDiagnostics ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-[11px] font-mono tabular-nums">
                      <div className="p-1.5 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-400">Raw</div>
                        <div className="text-slate-100 font-semibold">
                          {stageDiagnostics.rawPredictionsCount}
                        </div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-400">Valid</div>
                        <div className="text-slate-100 font-semibold">
                          {stageDiagnostics.validPredictionsCount}
                        </div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-400">ClassDrop</div>
                        <div className="text-amber-300 font-semibold">
                          {stageDiagnostics.classFilteredCount}
                        </div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-400">ConfDrop</div>
                        <div className="text-amber-300 font-semibold">
                          {stageDiagnostics.confidenceFilteredCount}
                        </div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-400">NMSDrop</div>
                        <div className="text-sky-300 font-semibold">
                          {stageDiagnostics.nmsSuppressedCount}
                        </div>
                      </div>
                      <div className="p-1.5 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-400">Final</div>
                        <div className="text-emerald-400 font-semibold">
                          {stageDiagnostics.finalDisplayedCount}
                        </div>
                      </div>
                    </div>
                    {stageDiagnostics.rawClassesObserved.length > 0 && (
                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        Raw Classes:{' '}
                        {stageDiagnostics.rawClassesObserved
                          .map((c) => `${c.className} (${Math.round(c.score * 100)}%)`)
                          .join(', ')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs font-mono text-slate-500">
                    Stage counts (Raw → Valid → Filtered → NMS → Final) populate on first model inference pass.
                  </div>
                )}
              </div>

              {/* Provenance-Tagged Detections & Tracks List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span>
                    {provenanceMode === 'REAL_MODEL'
                      ? `Real Model Detections (${selectedRealDetections.length})`
                      : `Simulated Demo Objects (${selectedCamera.activeDetections.length})`}
                  </span>
                  <span className="font-mono text-slate-400">
                    {provenanceMode}
                  </span>
                </div>

                {provenanceMode === 'REAL_MODEL' && selectedRealDetections.length === 0 && (
                  <div className="p-3 rounded-lg border border-slate-800 bg-slate-950 text-xs text-slate-400 font-mono">
                    {liveWebcamActive
                      ? `Live webcam CONNECTED (${modelStatus}). 0 objects above ${(
                          filterConfig.globalMinConfidence * 100
                        ).toFixed(0)}% confidence in current frame.`
                      : 'Live webcam is NOT CONNECTED. Click "Authorize Local Webcam" to stream live video frames into COCO-SSD, or switch to SIMULATED_DEMO to inspect deterministic facility replay.'}
                  </div>
                )}

                {provenanceMode === 'REAL_MODEL'
                  ? selectedRealDetections.map((det) => (
                      <div
                        key={det.detectionId}
                        className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-xs font-mono tabular-nums space-y-1"
                      >
                        <div className="flex items-center justify-between text-slate-100 font-semibold">
                          <span>
                            {det.className} (class #{det.classId})
                          </span>
                          <span className="text-emerald-400">
                            {(det.confidence * 100).toFixed(1)}% (raw{' '}
                            {(det.rawConfidence * 100).toFixed(1)}%)
                          </span>
                        </div>
                        <div className="text-slate-400">
                          ID: {det.detectionId} · Frame: {det.sourceFrameWidth}x
                          {det.sourceFrameHeight} · Provenance: {det.provenance}
                        </div>
                      </div>
                    ))
                  : selectedCamera.activeDetections.map((det) => (
                      <div
                        key={det.id}
                        className="py-2 border-b border-slate-800/80 flex items-center justify-between text-xs font-mono tabular-nums"
                      >
                        <div>
                          <span className="font-semibold text-amber-300">
                            [DEMO] {det.id} ({det.label})
                          </span>
                          <div className="text-slate-400">
                            Box: [{det.x}%, {det.y}%] · Zone {det.zoneId}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-amber-300">
                            {(det.confidence * 100).toFixed(0)}% conf
                          </div>
                          <div className="text-slate-500">
                            Dwell: {det.dwellSeconds}s
                          </div>
                        </div>
                      </div>
                    ))}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 text-xs text-slate-400 space-y-1">
              <div className="font-medium text-slate-200 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-sky-400" />
                Zero-Biometric & Provenance Integrity
              </div>
              <p>
                Real detections (`REAL_MODEL`) and demo fixtures (`SIMULATED_DEMO`) never share an ambiguous state. Zero facial or biometric identity inference is performed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Camera Matrix Grid (1, 2, 4, 6, 9 Configurable Views) */}
      {!focusMode && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Authorized Camera Matrix ({gridLayout}-Camera Layout)
            </h3>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              Showing {displayedCameras.length} configured feeds of {gridLayout} matrix slots
            </span>
          </div>

          <div
            className={`grid gap-4 ${
              gridLayout === 1
                ? 'grid-cols-1'
                : gridLayout === 2
                ? 'grid-cols-1 md:grid-cols-2'
                : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
            }`}
          >
            {Array.from({ length: gridLayout }, (_, slotIdx) => {
              const cam = state.cameras[slotIdx];
              if (!cam) {
                return (
                  <div
                    key={`empty-slot-${slotIdx}`}
                    className="border border-dashed border-slate-800 rounded-xl p-5 flex flex-col items-center justify-center text-center min-h-[150px]"
                  >
                    <Camera className="w-5 h-5 text-slate-500 mb-2" />
                    <div className="text-xs font-medium text-slate-300">
                      Matrix Slot #{slotIdx + 1} — NOT CONNECTED
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Ready for ONVIF / RTSP / WebRTC stream binding
                    </div>
                  </div>
                );
              }

              const isSelected = cam.id === selectedCamera?.id;
              const isFullscreen = fullscreenCamId === cam.id;

              return (
                <div
                  key={cam.id}
                  className={`border rounded-xl p-4 transition-all ${
                    isFullscreen
                      ? 'col-span-full border-sky-400 bg-sky-500/15 ring-1 ring-sky-500/40'
                      : isSelected
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-slate-800 bg-slate-900'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-mono text-slate-400">
                        {cam.id} · {cam.protocol} ·{' '}
                        {cam.isSimulatedStream ? 'SIMULATED_DEMO' : 'REAL_STREAM'}
                        {isFullscreen ? ' · EXPANDED FOCUS' : ''}
                      </div>
                      <h4 className="text-sm font-semibold text-slate-100 mt-0.5">
                        {cam.name}
                      </h4>
                    </div>
                    <button
                      type="button"
                      aria-label={`Toggle fullscreen view for ${cam.name}`}
                      onClick={() => {
                        setSelectedCameraId(cam.id);
                        setFullscreenCamId(isFullscreen ? null : cam.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md border border-transparent hover:border-slate-700"
                    >
                      {isFullscreen ? (
                        <Minimize2 className="w-4 h-4 text-sky-400" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  <div className="mt-3 text-xs text-slate-400 font-mono tabular-nums space-y-1">
                    <div>
                      Zone: {cam.zoneName} ({cam.occupancyCount}/{cam.maxCapacity} occ)
                    </div>
                    <div>
                      State: {cam.connectorState} · {cam.fps} FPS · {cam.inferenceLatencyMs}ms
                    </div>
                    {isFullscreen && (
                      <div className="pt-1 text-sky-300">
                        Resolution: {cam.resolution} · Bitrate: {cam.bitrateKbps} kbps · Packet Loss: {cam.packetLossPct}%
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-mono tabular-nums">
                      {cam.activeDetections.length} tracked object(s)
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedCameraId(cam.id)}
                      className="px-3 py-1 text-xs font-medium rounded-md bg-slate-800 text-slate-100 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      {isSelected ? 'Inspecting Stream' : 'Inspect Stream'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
