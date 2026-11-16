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
  CameraEntity,
  DetectionFilterConfig,
  DetectionProvenance,
  MeasuredVisionTelemetry,
  ModelProviderStatus,
  NormalizedDetection,
  ObjectTrack,
  PerformanceProfile,
  VantaSystemState,
} from '../core/types';
import {
  DEFAULT_DETECTION_FILTER_CONFIG,
  FrameInferenceScheduler,
  TfjsCocoSsdProvider,
  applyNormalizedClassAwareNMS,
  filterPredictionsByConfig,
  mapBoxToCanvasCoordinates,
  updateCameraObjectTracks,
  validateAndNormalizePredictions,
  validateVideoReadiness,
} from '../core/visionPipeline';

interface CameraWorkspaceProps {
  state: VantaSystemState;
  onReportTelemetry: (
    cameraId: string,
    payload: {
      isLiveWebcam: boolean;
      fps: number;
      inferenceLatencyMs: number;
      motionScore: number;
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

  // Strict Preservation of Camera Refs & State (Part D2)
  const [liveWebcamActive, setLiveWebcamActive] = useState<boolean>(false);
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
  const [performanceProfile, setPerformanceProfile] = useState<PerformanceProfile>(
    state.measuredVisionTelemetry?.performanceProfile || 'BALANCED'
  );
  const [provenanceMode, setProvenanceMode] = useState<DetectionProvenance>(
    state.measuredVisionTelemetry?.provenanceMode || 'REAL_MODEL'
  );
  const [schedulerPaused, setSchedulerPaused] = useState<boolean>(false);
  const [realDetections, setRealDetections] = useState<NormalizedDetection[]>([]);
  const [localTracks, setLocalTracks] = useState<ObjectTrack[]>(
    state.activeTracks || []
  );

  // Filter Configuration (Part D7)
  const filterConfig: DetectionFilterConfig =
    state.detectionFilterConfig || DEFAULT_DETECTION_FILTER_CONFIG;

  const selectedCamera: CameraEntity | undefined =
    state.cameras.find((c) => c.id === selectedCameraId) || state.cameras[0];

  const stopWebcam = useCallback(() => {
    schedulerRef.current.stop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setLiveWebcamActive(false);
    setCameraFps(null);
    setInferenceFps(null);
  }, []);

  const initializeVisionModel = useCallback(async () => {
    if (!providerRef.current) {
      providerRef.current = new TfjsCocoSsdProvider();
    }
    setModelStatus('LOADING');
    setLastModelError(null);
    const res = await providerRef.current.initialize();
    setModelStatus(res.status);
    if (res.initTimeMs !== null) {
      setModelInitTimeMs(res.initTimeMs);
    }
    if (res.error) {
      setErrorCount((c) => c + 1);
      setLastModelError(res.error);
    }
    await onUpdateVisionConfig?.(
      {},
      {
        modelStatus: res.status,
        modelInitTimeMs: res.initTimeMs,
        lastError: res.error || null,
      }
    );
    return res.status === 'READY';
  }, [onUpdateVisionConfig]);

  const startAuthorizedWebcam = async () => {
    setWebcamError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Browser mediaDevices.getUserMedia API unavailable.');
      }
      // Strictly reuse existing stream if already active to prevent duplicate camera streams
      if (!streamRef.current) {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 } },
          audio: false,
        });
        streamRef.current = mediaStream;
      }
      setLiveWebcamActive(true);
      setProvenanceMode('REAL_MODEL');
      if (videoRef.current) {
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play();
      }
      schedulerRef.current.start();
      // Initialize model independently without blocking or killing camera playback on model failure
      void initializeVisionModel();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Camera permission denied or hardware unavailable.';
      setWebcamError(
        `Live hardware stream unavailable (${msg}). Camera state is NOT CONNECTED.`
      );
      setLiveWebcamActive(false);
      setCameraFps(null);
    }
  };

  // Clean disposal of camera stream and model provider on unmount (Part D2 & Part K18-19)
  useEffect(() => {
    return () => {
      schedulerRef.current.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      providerRef.current?.dispose();
    };
  }, []);

  // Execute a single genuine inference pass through the full Part D4 pipeline
  const executePipelinePass = useCallback(
    async (sourceElement: HTMLVideoElement | HTMLCanvasElement) => {
      if (!selectedCamera) return;
      if (!providerRef.current || providerRef.current.getStatus() !== 'READY') {
        const ok = await initializeVisionModel();
        if (!ok || !providerRef.current) return;
      }

      const provider = providerRef.current;
      const meta = provider.getModelMetadata();
      setModelStatus('RUNNING');

      const detectionOutcome = await provider.detect(
        sourceElement,
        selectedCamera.id
      );

      setModelStatus(provider.getStatus());

      if (detectionOutcome.error) {
        setErrorCount((c) => c + 1);
        setLastModelError(detectionOutcome.error);
        return;
      }

      setInferenceLatencyMs(detectionOutcome.latencyMs);
      setInferenceFps(
        detectionOutcome.latencyMs > 0
          ? Math.min(
              30,
              Number((1000 / Math.max(detectionOutcome.latencyMs, schedulerRef.current.getMinIntervalMs())).toFixed(1))
            )
          : 1
      );

      // Stage D6: Prediction Validation & Normalization
      const { validDetections } = validateAndNormalizePredictions(
        detectionOutcome.rawPredictions,
        {
          sourceFrameWidth: detectionOutcome.frameWidth,
          sourceFrameHeight: detectionOutcome.frameHeight,
          cameraId: selectedCamera.id,
          modelId: meta.modelId,
          modelVersion: meta.modelVersion,
          inferenceId: detectionOutcome.inferenceId,
          provenance: 'REAL_MODEL',
        }
      );

      // Stage D7: Confidence & Class Filtering
      const { displayDetections } = filterPredictionsByConfig(
        validDetections,
        filterConfig
      );

      // Stage D8: Class-Aware Non-Maximum Suppression
      const nmsDetections = applyNormalizedClassAwareNMS(
        displayDetections,
        filterConfig.nmsIouThreshold
      );

      // Stage D9: Camera-Scoped Object Tracking
      const nextTracks = updateCameraObjectTracks(
        localTracks,
        nmsDetections,
        selectedCamera.id,
        selectedCamera.zoneId
      );

      setRealDetections(nmsDetections);
      setLocalTracks(nextTracks);

      const stats = schedulerRef.current.getStats();
      setProcessedFrames(stats.processedFrames);
      setSkippedFrames(stats.skippedFrames);

      await onReportTelemetry(selectedCamera.id, {
        isLiveWebcam: liveWebcamActive,
        fps: cameraFps ?? 30,
        inferenceLatencyMs: detectionOutcome.latencyMs,
        motionScore: nmsDetections.length * 8,
        normalizedDetections: nmsDetections,
        measuredVisionTelemetry: {
          modelStatus: provider.getStatus(),
          modelId: meta.modelId,
          modelVersion: meta.modelVersion,
          modelInitTimeMs,
          inferenceLatencyMs: detectionOutcome.latencyMs,
          processedFrames: stats.processedFrames,
          skippedFrames: stats.skippedFrames,
          cameraFps,
          inferenceFps:
            detectionOutcome.latencyMs > 0
              ? Number((1000 / Math.max(detectionOutcome.latencyMs, schedulerRef.current.getMinIntervalMs())).toFixed(1))
              : null,
          errorCount,
          lastError: null,
          performanceProfile,
          provenanceMode: 'REAL_MODEL',
        },
      });
    },
    [
      selectedCamera,
      initializeVisionModel,
      filterConfig,
      localTracks,
      onReportTelemetry,
      liveWebcamActive,
      cameraFps,
      modelInitTimeMs,
      errorCount,
      performanceProfile,
    ]
  );

  // Continuous bounded frame scheduler loop when live webcam is active (Part D4 & D5)
  useEffect(() => {
    if (!liveWebcamActive) return;
    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    schedulerRef.current.start();

    const loop = async () => {
      if (!active) return;
      const videoEl = videoRef.current;
      const readiness = validateVideoReadiness(videoEl);
      if (readiness.ready && videoEl && provenanceMode === 'REAL_MODEL') {
        await schedulerRef.current.tryScheduleFrame(performance.now(), async () => {
          await executePipelinePass(videoEl);
        });
        const stats = schedulerRef.current.getStats();
        setProcessedFrames(stats.processedFrames);
        setSkippedFrames(stats.skippedFrames);
      }
      if (active) {
        timerId = setTimeout(loop, 80);
      }
    };

    timerId = setTimeout(loop, 150);
    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [liveWebcamActive, provenanceMode, executePipelinePass]);

  // Part D10: Accurate Overlay Rendering (Zero sinusoidal fake movement!)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedCamera) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameCount = 0;
    let animId = 0;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      frameCount++;
      const dt = now - lastTime;
      if (dt >= 1000) {
        if (liveWebcamActive) {
          setCameraFps(Math.min(60, Math.round((frameCount * 1000) / dt)));
        }
        frameCount = 0;
        lastTime = now;
      }

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

          realDetections.forEach((det) => {
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
        `PROVENANCE: ${provenanceMode} · MODEL: ${modelStatus} · STREAM: ${
          liveWebcamActive ? 'LIVE WEBCAM (CONNECTED)' : 'HARDWARE CAMERA NOT CONNECTED'
        }`,
        16,
        h - 14
      );

      animId = requestAnimationFrame(renderFrame);
    };

    animId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animId);
  }, [
    selectedCamera,
    showDetections,
    showZoneOverlay,
    liveWebcamActive,
    provenanceMode,
    realDetections,
    modelStatus,
  ]);

  const displayedCameras = state.cameras.slice(0, gridLayout);
  const cameraTracks = localTracks.filter((t) => t.cameraId === selectedCamera?.id);

  return (
    <div className="space-y-5">
      {/* Camera Workspace Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-100">
            Camera Command & Real-Time Vision Intelligence (V15.0)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Genuine TensorFlow.js COCO-SSD Inference Pipeline · Bounded Frame Scheduler · Explicit Provenance Separation
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
              onClick={startAuthorizedWebcam}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 inline mr-1.5" />
              Authorize Local Webcam
            </button>
          ) : (
            <button
              type="button"
              onClick={stopWebcam}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="w-3.5 h-3.5 inline mr-1.5" />
              Stop Local Webcam
            </button>
          )}
        </div>
      </div>

      {/* Truthful Measured Telemetry Strip (Part E & Part J) */}
      <div
        data-testid="measured-vision-telemetry-bar"
        className="border border-slate-800 rounded-xl bg-slate-900/90 p-3.5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono tabular-nums"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-slate-400">
            MODEL:{' '}
            <strong className="text-slate-100">
              tfjs-coco-ssd-lite_mobilenet_v2
            </strong>
          </span>
          <span>·</span>
          <span
            className={
              modelStatus === 'READY' || modelStatus === 'RUNNING'
                ? 'text-emerald-400 font-semibold'
                : modelStatus === 'ERROR'
                ? 'text-rose-400 font-semibold'
                : 'text-amber-400 font-semibold'
            }
          >
            STATUS: {modelStatus}
          </span>
          <span>·</span>
          <span className="text-slate-300">
            INIT: {modelInitTimeMs !== null ? `${modelInitTimeMs}ms` : 'N/A'}
          </span>
          <span>·</span>
          <span className="text-slate-300">
            INFERENCE LATENCY:{' '}
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
        </div>
      </div>

      {(webcamError || lastModelError) && (
        <div
          role="status"
          className="p-3.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200 flex items-center justify-between gap-4"
        >
          <span>{webcamError || lastModelError}</span>
          <button
            type="button"
            onClick={() => {
              setWebcamError(null);
              setLastModelError(null);
            }}
            className="text-xs font-medium underline whitespace-nowrap shrink-0"
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

            {/* Existing Video & Canvas Elements Preserved (Part D2) */}
            <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center">
              <video
                ref={videoRef}
                muted
                playsInline
                className={`absolute inset-0 w-full h-full object-cover ${
                  liveWebcamActive ? 'opacity-95' : 'hidden'
                }`}
              />
              <canvas
                ref={canvasRef}
                width={768}
                height={432}
                data-testid="vision-telemetry-canvas"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <div className="font-mono tabular-nums">
                Active Detections ({provenanceMode}):{' '}
                {provenanceMode === 'REAL_MODEL'
                  ? realDetections.length
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
                  onClick={async () => {
                    const targetEl =
                      liveWebcamActive && videoRef.current
                        ? videoRef.current
                        : canvasRef.current;
                    if (targetEl) {
                      await executePipelinePass(targetEl);
                    }
                  }}
                  className="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors whitespace-nowrap"
                >
                  <Cpu className="w-3.5 h-3.5 inline mr-1.5" />
                  Run Real COCO-SSD Inference Pass
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Performance Profile, Threshold Calibration & Active Detections */}
          <div className="lg:col-span-4 border border-slate-800 rounded-xl bg-slate-900 p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              {/* Performance Profile & Threshold Configuration (Part D7 & Part J) */}
              <div className="border-b border-slate-800 pb-3 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <Sliders className="w-3.5 h-3.5 text-sky-400" />
                    SCHEDULER & FILTER GOVERNANCE
                  </span>
                  <span>PROFILE: {performanceProfile}</span>
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

              {/* Provenance-Tagged Detections & Tracks List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span>
                    {provenanceMode === 'REAL_MODEL'
                      ? `Real Model Detections (${realDetections.length})`
                      : `Simulated Demo Objects (${selectedCamera.activeDetections.length})`}
                  </span>
                  <span className="font-mono text-slate-400">
                    {provenanceMode}
                  </span>
                </div>

                {provenanceMode === 'REAL_MODEL' && realDetections.length === 0 && (
                  <div className="p-3 rounded-lg border border-slate-800 bg-slate-950 text-xs text-slate-400 font-mono">
                    {liveWebcamActive
                      ? 'Model scanning live video frames — 0 objects above threshold in current frame.'
                      : 'Live webcam is NOT CONNECTED. Authorize Local Webcam or click "Run Real COCO-SSD Inference Pass" to initialize and execute the neural network.'}
                  </div>
                )}

                {provenanceMode === 'REAL_MODEL'
                  ? realDetections.map((det) => (
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
                  className={`border rounded-xl p-4 transition-colors ${
                    isSelected
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-slate-800 bg-slate-900'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-mono text-slate-400">
                        {cam.id} · {cam.protocol} ·{' '}
                        {cam.isSimulatedStream ? 'SIMULATED_DEMO' : 'REAL_STREAM'}
                      </div>
                      <h4 className="text-sm font-semibold text-slate-100 mt-0.5">
                        {cam.name}
                      </h4>
                    </div>
                    <button
                      type="button"
                      aria-label={`Toggle fullscreen view for ${cam.name}`}
                      onClick={() => setFullscreenCamId(isFullscreen ? null : cam.id)}
                      className="p-1.5 text-slate-400 hover:text-slate-100 rounded-md"
                    >
                      {isFullscreen ? (
                        <Minimize2 className="w-4 h-4" />
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
