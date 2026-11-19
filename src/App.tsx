import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  Brain,
  Camera,
  ChevronLeft,
  ChevronRight,
  Layers,
  Menu,
  Moon,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
  X,
} from 'lucide-react';
import {
  BRAIN_TOOLS_REGISTRY,
  createInitialVantaState,
  verifyAuditChain,
} from './core/engine';
import {
  AssistantPreferences,
  BrainToolDefinition,
  ConversationMessage,
  DetectionFilterConfig,
  DeviceEntity,
  IncidentStatus,
  MeasuredVisionTelemetry,
  NormalizedDetection,
  PerformanceProfile,
  UserRole,
  VantaSystemState,
} from './core/types';
import { CameraWorkspace } from './components/CameraWorkspace';
import { BrainAndAleanaWorkspace } from './components/BrainAndAleanaWorkspace';
import { OperationsAndPoliciesWorkspace } from './components/OperationsAndPoliciesWorkspace';
import { MultiDeviceAndTwinWorkspace } from './components/MultiDeviceAndTwinWorkspace';
import { AuditAndBlueprintWorkspace } from './components/AuditAndBlueprintWorkspace';
import { WorkspaceErrorBoundary } from './components/WorkspaceErrorBoundary';

export type WorkspaceTab =
  | 'OVERVIEW'
  | 'CAMERAS'
  | 'BRAIN_ALEANA'
  | 'OPERATIONS'
  | 'DEVICES'
  | 'DIGITAL_TWIN'
  | 'AUDIT_BLUEPRINT';

const NAVIGATION_GROUPS: {
  groupLabel: string;
  items: {
    id: WorkspaceTab;
    label: string;
    shortDesc: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
}[] = [
  {
    groupLabel: 'OPERATIONS & VISION',
    items: [
      {
        id: 'OVERVIEW',
        label: 'Command Overview',
        shortDesc: 'Unified operational intelligence & health',
        icon: Activity,
      },
      {
        id: 'CAMERAS',
        label: 'Camera Workspace',
        shortDesc: 'Live WebRTC & real COCO-SSD object detection',
        icon: Camera,
      },
    ],
  },
  {
    groupLabel: 'AI & INTELLIGENCE',
    items: [
      {
        id: 'BRAIN_ALEANA',
        label: 'Vanta Brain & ALEANA',
        shortDesc: '9-layer reasoning, 25 tools & bilingual voice',
        icon: Brain,
      },
      {
        id: 'OPERATIONS',
        label: 'Incidents & Policies',
        shortDesc: 'State-governed incidents & compound rules',
        icon: ShieldAlert,
      },
    ],
  },
  {
    groupLabel: 'INFRASTRUCTURE & GOVERNANCE',
    items: [
      {
        id: 'DEVICES',
        label: 'Multi-Device Sync',
        shortDesc: 'QR device pairing & real-time SSE sync',
        icon: Smartphone,
      },
      {
        id: 'DIGITAL_TWIN',
        label: 'Digital Twin & Replay',
        shortDesc: 'Spatial zone state & chronological replay',
        icon: Layers,
      },
      {
        id: 'AUDIT_BLUEPRINT',
        label: 'Audit & Blueprint',
        shortDesc: 'SHA-256 hash chain & forensic blueprint',
        icon: ShieldCheck,
      },
    ],
  },
];

const ALL_NAV_ITEMS = NAVIGATION_GROUPS.flatMap((g) => g.items);

export default function App() {
  const [state, setState] = useState<VantaSystemState>(() =>
    createInitialVantaState()
  );
  const [toolsRegistry, setToolsRegistry] =
    useState<BrainToolDefinition[]>(BRAIN_TOOLS_REGISTRY);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('OVERVIEW');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>('');
  const [chartWindow, setChartWindow] = useState<'1H' | '6H' | '24H'>('6H');
  const [quickBrainPrompt, setQuickBrainPrompt] = useState<string>('');
  const [quickBrainLoading, setQuickBrainLoading] = useState<boolean>(false);
  const [quickBrainError, setQuickBrainError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [syncErrorBanner, setSyncErrorBanner] = useState<string | null>(null);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Initial state fetch + Real-time Cloud Synchronization SSE Stream
  useEffect(() => {
    let isMounted = true;
    const abortCtrl = new AbortController();

    fetch('/api/state', { signal: abortCtrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (isMounted && data?.state) {
          setState(data.state);
          setSseConnected(true);
          setSyncErrorBanner(null);
          if (Array.isArray(data.toolsRegistry)) {
            setToolsRegistry(data.toolsRegistry);
          }
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        if (isMounted) {
          setSseConnected(false);
        }
      });

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/sync/stream');
      eventSource.onopen = () => {
        if (isMounted) {
          setSseConnected(true);
          setSyncErrorBanner(null);
        }
      };
      eventSource.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data);
          if (isMounted && parsed?.state) {
            setState(parsed.state);
            setSseConnected(true);
          }
        } catch {
          // Ignore non-JSON SSE heartbeat frames
        }
      };
      eventSource.onerror = () => {
        if (isMounted) setSseConnected(false);
      };
    } catch {
      if (isMounted) setSseConnected(false);
    }

    return () => {
      isMounted = false;
      abortCtrl.abort();
      eventSource?.close();
    };
  }, []);

  // API Handlers
  const handleSwitchRole = async (role: UserRole) => {
    try {
      const res = await fetch('/api/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (data?.state) setState(data.state);
    } catch {
      setState((prev) => ({
        ...prev,
        tenant: { ...prev.tenant, role },
      }));
    }
  };

  const handleSendBrainQuery = async (
    query: string,
    modality: 'TEXT' | 'VOICE_ALEANA',
    language?: 'en' | 'hi' | 'hinglish'
  ): Promise<ConversationMessage | null> => {
    const res = await fetch('/api/brain/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, modality, language }),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.state) {
      setState(data.state);
    }
    if (!res.ok) {
      throw new Error(data?.error || `Brain request failed with HTTP ${res.status}.`);
    }
    return data?.message || null;
  };

  const handleVerifyGeminiConnection = async (): Promise<void> => {
    const res = await fetch('/api/brain/health?probe=true');
    const data = await res.json().catch(() => ({}));
    if (data?.diagnostics) {
      setState((prev) => ({
        ...prev,
        brainAiDiagnostics: data.diagnostics,
      }));
    }
  };

  const handleExecuteBrainTool = async (
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<{ error?: string; message?: string }> => {
    try {
      const res = await fetch('/api/brain/execute-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.state) setState(data.state);
      if (!res.ok) {
        return { error: data?.error || `Tool execution failed (HTTP ${res.status}).` };
      }
      if (data?.record?.status === 'DENIED') {
        return { error: data.record.resultSummary };
      }
      return {
        message:
          data?.record?.resultSummary ||
          `Tool ${toolName} executed and recorded in SHA-256 ledger.`,
      };
    } catch {
      return { error: 'Network error while executing Brain tool.' };
    }
  };

  const handleTransitionIncident = async (
    incidentId: string,
    targetStatus: IncidentStatus,
    note: string
  ): Promise<{ error?: string }> => {
    try {
      const res = await fetch(`/api/incidents/${incidentId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStatus, note }),
      });
      const data = await res.json();
      if (data?.state) setState(data.state);
      if (!res.ok) {
        return { error: data?.error || 'Transition rejected.' };
      }
      return {};
    } catch {
      return { error: 'Network error while transitioning incident.' };
    }
  };

  const handleTogglePolicy = async (
    policyId: string
  ): Promise<{ error?: string }> => {
    try {
      const res = await fetch(`/api/policies/${policyId}/toggle`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data?.state) setState(data.state);
      if (!res.ok) return { error: data?.error };
      return {};
    } catch {
      return { error: 'Failed to toggle policy.' };
    }
  };

  const handleEvaluatePolicy = async (
    policyId: string,
    params: {
      occupancy: number;
      maxDwellSeconds: number;
      confidence: number;
      isRestrictedHours: boolean;
    }
  ) => {
    try {
      const res = await fetch(`/api/policies/${policyId}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      return data?.evaluation || null;
    } catch {
      return null;
    }
  };

  const handlePairDevice = async (
    deviceName: string,
    targetPlatform: DeviceEntity['platform']
  ): Promise<{ error?: string }> => {
    try {
      const res = await fetch('/api/devices/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName, targetPlatform }),
      });
      const data = await res.json();
      if (data?.state) setState(data.state);
      if (!res.ok) return { error: data?.error || 'Pairing failed.' };
      return {};
    } catch {
      return { error: 'Network error during pairing.' };
    }
  };

  const handleRevokeDevice = async (
    deviceId: string
  ): Promise<{ error?: string }> => {
    try {
      const res = await fetch(`/api/devices/${deviceId}/revoke`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (data?.state) setState(data.state);
      if (!res.ok) {
        return { error: data?.error || 'Failed to update device authorization.' };
      }
      return {};
    } catch {
      return { error: 'Network error while updating device authorization.' };
    }
  };

  const handleReportCameraTelemetry = async (
    cameraId: string,
    payload: {
      isLiveWebcam: boolean;
      fps: number | null;
      inferenceLatencyMs: number | null;
      motionScore: number | null;
      normalizedDetections?: NormalizedDetection[];
      measuredVisionTelemetry?: Partial<MeasuredVisionTelemetry>;
    }
  ) => {
    try {
      const res = await fetch(`/api/cameras/${cameraId}/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.state) setState(data.state);
      if (!res.ok && data?.error) {
        setSyncErrorBanner(data.error);
      }
    } catch {
      setSyncErrorBanner('Telemetry sync temporarily offline · Local inference active.');
    }
  };

  const handleUpdateVisionConfig = async (
    filterConfig: Partial<DetectionFilterConfig>,
    telemetryPatch?: Partial<MeasuredVisionTelemetry>
  ) => {
    try {
      const res = await fetch('/api/vision/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filterConfig,
          telemetryPatch,
          performanceProfile: telemetryPatch?.performanceProfile,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.state) setState(data.state);
      if (!res.ok && data?.error) {
        setSyncErrorBanner(data.error);
      }
    } catch {
      setSyncErrorBanner('Failed to persist vision filter configuration to server.');
    }
  };

  const handleUpdatePreferences = async (
    prefs: Partial<AssistantPreferences>
  ) => {
    try {
      const res = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.state) setState(data.state);
      if (!res.ok && data?.error) {
        setSyncErrorBanner(data.error);
      }
    } catch {
      setState((prev) => ({
        ...prev,
        preferences: { ...prev.preferences, ...prefs },
      }));
    }
  };

  const handleRefreshAudit = async () => {
    try {
      const [stateRes, verifyRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/audit/verify'),
      ]);
      const stateData = await stateRes.json().catch(() => ({}));
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (stateData?.state) setState(stateData.state);
      return verifyData?.verification;
    } catch {
      return undefined;
    }
  };

  const handleExecuteWorkflow = async (
    workflowId: string,
    approvedByHuman = false
  ): Promise<{ error?: string; message?: string }> => {
    try {
      const res = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedByHuman }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.state) setState(data.state);
      if (!res.ok) {
        return { error: data?.error || 'Workflow execution rejected.' };
      }
      return {
        message:
          data?.workflow?.lastResultSummary ||
          `Workflow ${workflowId} status: ${data?.workflow?.status || 'UPDATED'}.`,
      };
    } catch {
      return { error: 'Network error while executing workflow.' };
    }
  };

  const handleManageMemory = async (
    action: 'RESET_CONVERSATION' | 'UPDATE_RETENTION',
    retentionDays?: number
  ): Promise<{ error?: string; message?: string }> => {
    try {
      const res = await fetch('/api/memory/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, retentionDays }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.state) setState(data.state);
      if (!res.ok) {
        return { error: data?.error || 'Memory governance action rejected.' };
      }
      return {};
    } catch {
      return { error: 'Network error during memory governance update.' };
    }
  };

  // Unified Global Search Results across authorized entities
  const searchResults = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: {
      id: string;
      type: string;
      title: string;
      subtitle: string;
      targetTab: WorkspaceTab;
    }[] = [];

    state.cameras.forEach((c) => {
      if (
        c.id.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.zoneName.toLowerCase().includes(q)
      ) {
        results.push({
          id: c.id,
          type: 'CAMERA',
          title: `${c.id} — ${c.name}`,
          subtitle: `Zone: ${c.zoneName} · ${c.connectorState}`,
          targetTab: 'CAMERAS',
        });
      }
    });

    state.incidents.forEach((i) => {
      if (
        i.id.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        i.zoneName.toLowerCase().includes(q)
      ) {
        results.push({
          id: i.id,
          type: 'INCIDENT',
          title: `${i.id} — ${i.title}`,
          subtitle: `${i.severity} · ${i.status} · ${i.zoneName}`,
          targetTab: 'OPERATIONS',
        });
      }
    });

    state.devices.forEach((d) => {
      if (
        d.id.toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q) ||
        d.platform.toLowerCase().includes(q)
      ) {
        results.push({
          id: d.id,
          type: 'DEVICE',
          title: `${d.id} — ${d.name}`,
          subtitle: `${d.platform} · ${d.ipAddress}`,
          targetTab: 'DEVICES',
        });
      }
    });

    state.policies.forEach((p) => {
      if (
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q)
      ) {
        results.push({
          id: p.id,
          type: 'POLICY',
          title: `${p.id} — ${p.name}`,
          subtitle: `Zone: ${p.targetZoneName}`,
          targetTab: 'OPERATIONS',
        });
      }
    });

    return results.slice(0, 8);
  }, [globalSearchQuery, state]);

  const openIncidentsCount = state.incidents.filter(
    (i) => i.status !== 'RESOLVED'
  ).length;
  const totalOccupancy = state.zones.reduce(
    (acc, z) => acc + z.currentOccupancy,
    0
  );
  const auditCheck = verifyAuditChain(state.auditTrail);

  // Genuine model detections vs simulated demo detections
  const genuineDetectionsCount = (state.latestNormalizedDetections || []).filter(
    (d) => d.provenance === 'REAL_MODEL'
  ).length;
  const connectedLiveCamerasCount = state.cameras.filter(
    (c) => !c.isSimulatedStream && c.connectorState === 'Connected'
  ).length;
  const visionTel = state.measuredVisionTelemetry;

  const activeNavMeta =
    ALL_NAV_ITEMS.find((item) => item.id === activeTab) || ALL_NAV_ITEMS[0];

  const displayedSeries =
    chartWindow === '1H'
      ? state.timeSeries.slice(-4)
      : chartWindow === '6H'
      ? state.timeSeries.slice(-8)
      : state.timeSeries;

  const handleSelectNavTab = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    setMobileDrawerOpen(false);
  };

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* =====================================================================
          PART B2 / C2: COMPACT GLOBAL TOP HEADER
          Contains:
          - Left: Mobile Drawer Button (<768px) + VantaVisionAI Brand + Active Workspace Title
          - Center: Compact Global Search
          - Right: Alert/Incident Counter, SSE Connection Status, RBAC Role Selector, Theme Toggle, ALEANA Action
          Zero duplicated workspace navigation links in the header.
         ===================================================================== */}
      <header
        data-testid="global-top-header"
        className="h-14 shrink-0 flex items-center justify-between gap-4 px-4 lg:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-30"
      >
        {/* Left Zone: Mobile menu toggle + Brand + Current Workspace Title */}
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <button
            type="button"
            data-testid="mobile-drawer-toggle"
            onClick={() => setMobileDrawerOpen((o) => !o)}
            aria-label="Toggle navigation drawer"
            aria-expanded={mobileDrawerOpen}
            className="md:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <Menu className="w-5 h-5" />
          </button>

          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              handleSelectNavTab('OVERVIEW');
            }}
            className="text-base lg:text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            VantaVisionAI
          </a>

          <span className="hidden sm:inline-block text-slate-300 dark:text-slate-700">
            /
          </span>

          <div
            data-testid="header-workspace-title"
            className="hidden sm:flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 truncate"
          >
            <span>{activeNavMeta.label}</span>
          </div>
        </div>

        {/* Center Zone: Compact Global Search */}
        <div className="relative flex-1 max-w-md mx-2">
          <label htmlFor="global-nexus-search" className="sr-only">
            Search cameras, incidents, devices, policies
          </label>
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
          <input
            id="global-nexus-search"
            data-testid="global-search-input"
            type="search"
            value={globalSearchQuery}
            onChange={(e) => setGlobalSearchQuery(e.target.value)}
            placeholder="Search cameras, incidents, devices, policies..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 shadow-xl divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto z-50">
              {searchResults.map((res) => (
                <button
                  key={`${res.type}-${res.id}`}
                  type="button"
                  onClick={() => {
                    handleSelectNavTab(res.targetTab);
                    setGlobalSearchQuery('');
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {res.title}
                  </div>
                  <div className="text-xs font-mono text-slate-500 truncate">
                    {res.type} · {res.subtitle}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Zone: System Connection, Alert Status, Profile/Role Selector, Theme, Launch ALEANA */}
        <div className="flex items-center gap-2 lg:gap-3 shrink-0">
          {/* System / SSE Connection Status */}
          <div
            data-testid="header-connection-status"
            title={
              sseConnected
                ? `Live SSE Cloud Stream Connected (Revision #${state.syncRevision})`
                : 'Local Deterministic State'
            }
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                sseConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span>{sseConnected ? 'SYNC ONLINE' : 'LOCAL'}</span>
          </div>

          {/* Notification / Open Incidents Alert Status */}
          <button
            type="button"
            onClick={() => handleSelectNavTab('OPERATIONS')}
            aria-label={`View ${openIncidentsCount} open incidents`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-amber-500/50 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200 transition-colors"
          >
            <Bell className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>{openIncidentsCount}</span>
          </button>

          {/* Compact RBAC Role / Operator Profile Control */}
          <div className="hidden md:flex items-center">
            <label htmlFor="rbac-role-select" className="sr-only">
              Active Operator RBAC Role
            </label>
            <select
              id="rbac-role-select"
              data-testid="header-rbac-select"
              value={state.tenant.role}
              onChange={(e) => handleSwitchRole(e.target.value as UserRole)}
              className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="ADMIN">ROLE: ADMIN</option>
              <option value="SECURITY_OPERATOR">ROLE: OPERATOR</option>
              <option value="ANALYST">ROLE: ANALYST</option>
              <option value="AUDITOR">ROLE: AUDITOR</option>
            </select>
          </div>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={() => setIsDarkMode((d) => !d)}
            aria-label={isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {isDarkMode ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" />
            )}
          </button>

          {/* Primary Action: Launch ALEANA Voice */}
          <button
            type="button"
            onClick={() => handleSelectNavTab('BRAIN_ALEANA')}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Launch ALEANA Voice
          </button>
        </div>
      </header>

      {/* =====================================================================
          PART B2 / B3 / B4 / B5: PERSISTENT BODY SHELL
          Left Navigation Sidebar + Independent Scrollable Main Workspace
         ===================================================================== */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Slide-Over Backdrop (<768px) */}
        {mobileDrawerOpen && (
          <div
            data-testid="mobile-drawer-backdrop"
            onClick={() => setMobileDrawerOpen(false)}
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-40 md:hidden"
            aria-hidden="true"
          />
        )}

        {/* Left Navigation Sidebar:
            - Desktop/Tablet (md+): Persistent left column (w-64 expanded = 256px, w-[72px] collapsed = 72px)
            - Mobile (<768px): Slide-over fixed drawer when mobileDrawerOpen is true
        */}
        <aside
          data-testid="left-navigation-sidebar"
          aria-label="Workspace Domain Navigation"
          className={`${
            mobileDrawerOpen
              ? 'fixed inset-y-0 left-0 z-50 flex w-64 shadow-2xl'
              : 'hidden'
          } md:static md:z-auto md:flex md:shadow-none ${
            sidebarCollapsed ? 'md:w-[72px]' : 'md:w-64'
          } shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col justify-between overflow-y-auto transition-all duration-150`}
        >
          <div className="p-3 space-y-4">
            {/* Sidebar Header & Collapse Control */}
            <div className="flex items-center justify-between px-2 py-1 border-b border-slate-100 dark:border-slate-800/80 pb-2.5">
              {(!sidebarCollapsed || mobileDrawerOpen) && (
                <div>
                  <div className="text-xs font-mono font-semibold text-sky-600 dark:text-sky-400 tabular-nums">
                    VANTA NEXUS V16.0
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    COMMAND CENTER
                  </div>
                </div>
              )}

              {/* Desktop Collapse Toggle */}
              <button
                type="button"
                data-testid="sidebar-collapse-toggle"
                onClick={() => setSidebarCollapsed((c) => !c)}
                aria-label={
                  sidebarCollapsed
                    ? 'Expand navigation sidebar'
                    : 'Collapse navigation sidebar'
                }
                title={
                  sidebarCollapsed
                    ? 'Expand sidebar (256px)'
                    : 'Collapse sidebar (72px)'
                }
                className="hidden md:inline-flex p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 mx-auto md:mx-0"
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </button>

              {/* Mobile Drawer Close Button */}
              <button
                type="button"
                data-testid="mobile-drawer-close"
                onClick={() => setMobileDrawerOpen(false)}
                aria-label="Close navigation drawer"
                className="md:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Grouped Navigation Items */}
            <nav aria-label="Primary Workspace Navigation" className="space-y-4">
              {NAVIGATION_GROUPS.map((group) => (
                <div key={group.groupLabel} className="space-y-1">
                  {(!sidebarCollapsed || mobileDrawerOpen) && (
                    <div className="px-2.5 py-1 text-[10px] font-mono font-semibold tracking-wider text-slate-400 dark:text-slate-500 uppercase">
                      {group.groupLabel}
                    </div>
                  )}

                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeTab === item.id;
                    const showText = !sidebarCollapsed || mobileDrawerOpen;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid={`nav-item-${item.id}`}
                        onClick={() => handleSelectNavTab(item.id)}
                        title={`${item.label} — ${item.shortDesc}`}
                        aria-current={active ? 'page' : undefined}
                        className={`w-full flex items-center ${
                          showText ? 'justify-start gap-3 px-3' : 'justify-center px-2'
                        } py-2.5 text-xs font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                          active
                            ? 'bg-slate-900 text-white dark:bg-sky-500/15 dark:text-sky-300 border-l-2 border-sky-500 font-semibold'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {showText && (
                          <span className="truncate">{item.label}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>

          {/* Sidebar Footer: Vision Pipeline Status & Mobile Role Selector */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
            {(!sidebarCollapsed || mobileDrawerOpen) ? (
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono tabular-nums space-y-1">
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span>VISION ENGINE</span>
                  <span
                    className={
                      visionTel?.modelStatus === 'READY' ||
                      visionTel?.modelStatus === 'RUNNING'
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-amber-600 dark:text-amber-400'
                    }
                  >
                    {visionTel?.modelStatus || 'UNINITIALIZED'}
                  </span>
                </div>
                <div className="text-slate-700 dark:text-slate-300 truncate">
                  {visionTel?.modelId || 'tfjs-coco-ssd'}
                </div>
                <div className="text-slate-500">
                  Audit: {auditCheck.valid ? 'VERIFIED' : 'CHECK'} ({auditCheck.checkedCount})
                </div>
              </div>
            ) : (
              <div
                title={`Vision Model: ${visionTel?.modelStatus || 'UNINITIALIZED'} · Audit Verified (${auditCheck.checkedCount})`}
                className="flex justify-center py-1"
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    visionTel?.modelStatus === 'READY' ||
                    visionTel?.modelStatus === 'RUNNING'
                      ? 'bg-emerald-500'
                      : 'bg-sky-500'
                  }`}
                />
              </div>
            )}

            {/* Mobile-only RBAC selector inside drawer */}
            {mobileDrawerOpen && (
              <div className="md:hidden space-y-1">
                <label
                  htmlFor="mobile-rbac-role-select"
                  className="block text-[10px] font-mono text-slate-500"
                >
                  ACTIVE RBAC ROLE
                </label>
                <select
                  id="mobile-rbac-role-select"
                  value={state.tenant.role}
                  onChange={(e) => handleSwitchRole(e.target.value as UserRole)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  <option value="ADMIN">ADMIN (Full Control)</option>
                  <option value="SECURITY_OPERATOR">SECURITY_OPERATOR</option>
                  <option value="ANALYST">ANALYST (Read + AI)</option>
                  <option value="AUDITOR">AUDITOR (Read-Only)</option>
                </select>
              </div>
            )}
          </div>
        </aside>

        {/* =====================================================================
            MAIN INDEPENDENT SCROLLABLE WORKSPACE VIEWPORT
           ===================================================================== */}
        <main
          data-testid="main-workspace"
          className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 min-w-0"
        >
          <div className="max-w-[1440px] mx-auto w-full space-y-6">
            {/* Compact Context Breadcrumb & Provenance Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              <div className="flex flex-wrap items-center gap-1.5">
                <span>{state.tenant.organizationName}</span>
                <span>/</span>
                <span className="text-slate-900 dark:text-slate-200 font-medium">
                  {state.tenant.siteName}
                </span>
                <span>·</span>
                <span>
                  OPERATOR: {state.tenant.userName} ({state.tenant.role})
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span>
                  SYNC: {sseConnected ? 'LIVE SSE' : 'LOCAL'} · REV #{state.syncRevision}
                </span>
                <span>·</span>
                <span>
                  SHA-256 LEDGER: {auditCheck.valid ? 'VERIFIED' : 'CHECK'} ({auditCheck.checkedCount})
                </span>
              </div>
            </div>

            {syncErrorBanner && (
              <div
                role="status"
                className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs font-mono text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3"
              >
                <span>{syncErrorBanner}</span>
                <button
                  type="button"
                  onClick={() => setSyncErrorBanner(null)}
                  className="underline font-semibold"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* WORKSPACE ROUTING WRAPPED IN FAULT-ISOLATION ERROR BOUNDARY */}
            <WorkspaceErrorBoundary
              workspaceName={activeNavMeta.label}
              onResetWorkspace={() => setActiveTab('OVERVIEW')}
            >
            {activeTab === 'OVERVIEW' && (
              <div className="space-y-6">
                {/* Hero / Command Overview Header + Direct Brain Command Bar */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                  <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 lg:p-6 flex flex-col justify-between space-y-4">
                    <div className="space-y-2">
                      <div className="text-xs font-mono text-sky-600 dark:text-sky-400">
                        VANTA NEXUS V16.0 · COMMAND CENTER & REAL-TIME VISION INTELLIGENCE
                      </div>
                      <h1
                        className="text-xl lg:text-2xl font-bold tracking-tight text-slate-900 dark:text-white"
                        style={{ textWrap: 'balance' }}
                      >
                        Real-Time Object Detection, 9-Layer Brain Reasoning & Bilingual Voice Operations
                      </h1>
                      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
                        Genuine TensorFlow.js COCO-SSD inference pipeline with strict provenance separation between live WebRTC camera detections and simulated baseline telemetry.
                      </p>
                    </div>

                    {/* Quick Brain Command Bar */}
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!quickBrainPrompt.trim() || quickBrainLoading) return;
                        setQuickBrainLoading(true);
                        setQuickBrainError(null);
                        try {
                          await handleSendBrainQuery(quickBrainPrompt, 'TEXT');
                          setQuickBrainPrompt('');
                          handleSelectNavTab('BRAIN_ALEANA');
                        } catch (err) {
                          setQuickBrainError(
                            err instanceof Error
                              ? err.message
                              : 'Failed to execute quick Vanta Brain query.'
                          );
                        } finally {
                          setQuickBrainLoading(false);
                        }
                      }}
                      className="flex flex-wrap items-center gap-2 pt-1"
                    >
                      <label htmlFor="overview-brain-input" className="sr-only">
                        Quick command to Vanta Brain
                      </label>
                      <input
                        id="overview-brain-input"
                        type="text"
                        value={quickBrainPrompt}
                        onChange={(e) => setQuickBrainPrompt(e.target.value)}
                        placeholder="Ask Vanta Brain (e.g., 'What objects are currently detected?' or 'Explain INC-2041')..."
                        className="flex-1 min-w-[220px] px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                      <button
                        type="submit"
                        disabled={quickBrainLoading}
                        className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                      >
                        {quickBrainLoading ? 'Executing...' : 'Ask Vanta Brain'}
                      </button>
                    </form>
                    {quickBrainError && (
                      <div
                        role="alert"
                        className="text-xs text-rose-600 dark:text-rose-400 font-mono"
                      >
                        {quickBrainError}
                      </div>
                    )}
                  </div>

                  {/* Right: Latest Vanta Brain × ALEANA Executive Synthesis */}
                  <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 lg:p-6 flex flex-col justify-between space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400">
                        <span>VANTA BRAIN × ALEANA LIVE BRIEFING</span>
                        <span>{toolsRegistry.length} TOOLS ONLINE</span>
                      </div>
                      <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                        {state.conversations[state.conversations.length - 1]?.directAnswer ||
                          state.conversations[state.conversations.length - 1]?.content}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-mono text-slate-500">
                        Bilingual: English · हिन्दी · Hinglish
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSelectNavTab('BRAIN_ALEANA')}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-sky-300 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                      >
                        Open Brain & Voice Console →
                      </button>
                    </div>
                  </div>
                </div>

                {/* =================================================================
                    PART C3: COMMAND OVERVIEW 8 VERIFIED METRIC CARDS
                    Backed by actual system state. Truthfully displays NOT CONNECTED
                    or N/A where live hardware/inference is not active.
                   ================================================================= */}
                <div
                  data-testid="overview-kpi-grid"
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
                >
                  {/* 1. System Health */}
                  <button
                    type="button"
                    onClick={() => handleSelectNavTab('AUDIT_BLUEPRINT')}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      1. System Health & Sync
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                      {sseConnected ? 'ONLINE (SSE)' : 'LOCAL READY'}
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-1">
                      Rev #{state.syncRevision} · {state.devices.filter((d) => d.authorized).length}/{state.devices.length} Devices Authorized
                    </div>
                  </button>

                  {/* 2. Connected Camera Status */}
                  <button
                    type="button"
                    onClick={() => handleSelectNavTab('CAMERAS')}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      2. Connected Camera Status
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {connectedLiveCamerasCount > 0
                        ? `${connectedLiveCamerasCount} LIVE WEBRTC`
                        : 'NOT CONNECTED'}
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-1">
                      {state.cameras.length} Configured ({state.cameras.filter((c) => c.connectorState === 'Simulated').length} Simulated · {state.cameras.filter((c) => c.connectorState === 'Degraded').length} Degraded)
                    </div>
                  </button>

                  {/* 3. Active Detections from Genuine Inference */}
                  <button
                    type="button"
                    onClick={() => handleSelectNavTab('CAMERAS')}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      3. Genuine Model Detections
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-1">
                      {genuineDetectionsCount} REAL_MODEL
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-1">
                      Active Tracks: {(state.activeTracks || []).length} Non-Biometric
                    </div>
                  </button>

                  {/* 4. Event Activity */}
                  <button
                    type="button"
                    onClick={() => handleSelectNavTab('OPERATIONS')}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      4. Verified Event Activity
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {state.events.length} EVENTS
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-1">
                      {state.events.filter((e) => e.provenance === 'Measured').length} Measured · {state.events.filter((e) => e.provenance !== 'Measured').length} Simulated
                    </div>
                  </button>

                  {/* 5. Incident Status */}
                  <button
                    type="button"
                    onClick={() => handleSelectNavTab('OPERATIONS')}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      5. Incident Queue Status
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">
                      {openIncidentsCount} ACTIVE
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-1">
                      {state.incidents.length} Total · Occupancy: {totalOccupancy}p
                    </div>
                  </button>

                  {/* 6. Model Readiness */}
                  <button
                    type="button"
                    onClick={() => handleSelectNavTab('CAMERAS')}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      6. Vision Model Readiness
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {visionTel?.modelStatus || 'UNINITIALIZED'}
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-1 truncate">
                      Init:{' '}
                      {visionTel?.modelInitTimeMs !== null &&
                      visionTel?.modelInitTimeMs !== undefined
                        ? `${visionTel.modelInitTimeMs}ms`
                        : 'N/A'}{' '}
                      · COCO-SSD
                    </div>
                  </button>

                  {/* 7. Inference Performance */}
                  <button
                    type="button"
                    onClick={() => handleSelectNavTab('CAMERAS')}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      7. Inference Performance
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {visionTel?.inferenceLatencyMs !== null &&
                      visionTel?.inferenceLatencyMs !== undefined
                        ? `${visionTel.inferenceLatencyMs} ms`
                        : 'N/A'}
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-1">
                      Frames: {visionTel?.processedFrames ?? 0} proc / {visionTel?.skippedFrames ?? 0} skip
                    </div>
                  </button>

                  {/* 8. Recent Audit Activity */}
                  <button
                    type="button"
                    onClick={() => handleSelectNavTab('AUDIT_BLUEPRINT')}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      8. SHA-256 Audit Ledger
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                      {auditCheck.checkedCount} BLOCKS
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-1 truncate">
                      Latest: {state.auditTrail[state.auditTrail.length - 1]?.action || 'GENESIS'}
                    </div>
                  </button>
                </div>

                {/* Data Analytics & Priority Incident Queue Row */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                  {/* Time-Series Event & Occupancy Analytics Chart */}
                  <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          Event Frequency, Zone Occupancy & Sync Throughput Analytics
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                          Units: Occupants (count) & Events/15m · Source: Canonical Telemetry Store (Simulated Baseline Disclosed)
                        </p>
                      </div>

                      <div
                        className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                        role="group"
                        aria-label="Analytics time range filter"
                      >
                        {(['1H', '6H', '24H'] as const).map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => setChartWindow(w)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                              chartWindow === w
                                ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Accessible Tabular Bar Visualization */}
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 pt-2 items-end min-h-[190px]">
                      {displayedSeries.slice(0, 8).map((pt) => {
                        const occHeightPct = Math.min(
                          100,
                          Math.max(18, Math.round((pt.occupancyTotal / 55) * 100))
                        );
                        const evtHeightPct = Math.min(
                          100,
                          Math.max(12, Math.round((pt.eventsCount / 15) * 100))
                        );
                        return (
                          <div
                            key={pt.timestampIso}
                            className="flex flex-col items-center justify-end h-full space-y-2"
                          >
                            <div className="w-full flex items-end justify-center gap-1.5 h-32 bg-slate-50 dark:bg-slate-950/60 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800/80">
                              <div
                                style={{ height: `${occHeightPct}%` }}
                                title={`Occupancy: ${pt.occupancyTotal} occupants`}
                                className="w-3 bg-sky-500 rounded-sm transition-all"
                              />
                              <div
                                style={{ height: `${evtHeightPct}%` }}
                                title={`Events: ${pt.eventsCount} events`}
                                className="w-3 bg-amber-500 rounded-sm transition-all"
                              />
                            </div>
                            <div className="text-center font-mono tabular-nums">
                              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                {pt.occupancyTotal}p / {pt.eventsCount}e
                              </div>
                              <div className="text-xs text-slate-500">{pt.label}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-500">
                      <span>
                        Legend: Sky Bar = Tracked Occupants (p) · Amber Bar = Security Events (e)
                      </span>
                      <span>
                        Measured Inference Latency:{' '}
                        {visionTel?.inferenceLatencyMs !== null &&
                        visionTel?.inferenceLatencyMs !== undefined
                          ? `${visionTel.inferenceLatencyMs}ms (REAL_MODEL)`
                          : 'N/A (Run COCO-SSD in Camera Workspace)'}
                      </span>
                    </div>
                  </div>

                  {/* Right: Active Incidents & Zone Risk Summary */}
                  <div className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          Priority Operational Queue
                        </h2>
                        <button
                          type="button"
                          onClick={() => handleSelectNavTab('OPERATIONS')}
                          className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
                        >
                          Manage All →
                        </button>
                      </div>

                      <div className="space-y-3">
                        {state.incidents.map((inc) => (
                          <div
                            key={inc.id}
                            className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1"
                          >
                            <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-500">
                              <span>
                                {inc.id} · {inc.severity}
                              </span>
                              <span className="font-semibold text-amber-600 dark:text-amber-400">
                                {inc.status}
                              </span>
                            </div>
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {inc.title}
                            </div>
                            <div className="text-xs text-slate-500 font-mono">
                              Zone: {inc.zoneName}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Zone Status Summary
                      </div>
                      {state.zones.map((z) => (
                        <div
                          key={z.id}
                          className="flex items-center justify-between text-xs font-mono tabular-nums"
                        >
                          <span className="text-slate-600 dark:text-slate-400 truncate">
                            {z.id} {z.name}
                          </span>
                          <span className="text-slate-900 dark:text-slate-100">
                            {z.currentOccupancy}/{z.capacityLimit} · {z.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'CAMERAS' && (
              <CameraWorkspace
                state={state}
                onReportTelemetry={handleReportCameraTelemetry}
                onUpdateVisionConfig={handleUpdateVisionConfig}
              />
            )}

            {activeTab === 'BRAIN_ALEANA' && (
              <BrainAndAleanaWorkspace
                state={state}
                toolsRegistry={toolsRegistry}
                onSendQuery={handleSendBrainQuery}
                onVerifyGemini={handleVerifyGeminiConnection}
                onExecuteTool={handleExecuteBrainTool}
                onUpdatePreferences={handleUpdatePreferences}
                onExecuteWorkflow={handleExecuteWorkflow}
                onManageMemory={handleManageMemory}
              />
            )}

            {activeTab === 'OPERATIONS' && (
              <OperationsAndPoliciesWorkspace
                state={state}
                onTransitionIncident={handleTransitionIncident}
                onTogglePolicy={handleTogglePolicy}
                onEvaluatePolicy={handleEvaluatePolicy}
              />
            )}

            {activeTab === 'DEVICES' && (
              <MultiDeviceAndTwinWorkspace
                state={state}
                mode="DEVICES"
                onPairDevice={handlePairDevice}
                onRevokeDevice={handleRevokeDevice}
              />
            )}

            {activeTab === 'DIGITAL_TWIN' && (
              <MultiDeviceAndTwinWorkspace
                state={state}
                mode="DIGITAL_TWIN"
                onPairDevice={handlePairDevice}
                onRevokeDevice={handleRevokeDevice}
              />
            )}

            {activeTab === 'AUDIT_BLUEPRINT' && (
              <AuditAndBlueprintWorkspace
                state={state}
                onRefreshAudit={handleRefreshAudit}
              />
            )}
            </WorkspaceErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
