import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Brain,
  Camera,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Cpu,
  Layers,
  Lock,
  Mic,
  Moon,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
  Terminal,
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
  DeviceEntity,
  IncidentStatus,
  UserRole,
  VantaSystemState,
} from './core/types';
import { CameraWorkspace } from './components/CameraWorkspace';
import { BrainAndAleanaWorkspace } from './components/BrainAndAleanaWorkspace';
import { OperationsAndPoliciesWorkspace } from './components/OperationsAndPoliciesWorkspace';
import { MultiDeviceAndTwinWorkspace } from './components/MultiDeviceAndTwinWorkspace';
import { AuditAndBlueprintWorkspace } from './components/AuditAndBlueprintWorkspace';

type WorkspaceTab =
  | 'OVERVIEW'
  | 'CAMERAS'
  | 'BRAIN_ALEANA'
  | 'OPERATIONS'
  | 'DEVICES'
  | 'DIGITAL_TWIN'
  | 'AUDIT_BLUEPRINT';

export default function App() {
  const [state, setState] = useState<VantaSystemState>(() =>
    createInitialVantaState()
  );
  const [toolsRegistry, setToolsRegistry] =
    useState<BrainToolDefinition[]>(BRAIN_TOOLS_REGISTRY);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('OVERVIEW');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>('');
  const [chartWindow, setChartWindow] = useState<'1H' | '6H' | '24H'>('6H');
  const [quickBrainPrompt, setQuickBrainPrompt] = useState<string>('');
  const [quickBrainLoading, setQuickBrainLoading] = useState<boolean>(false);
  const [sseConnected, setSseConnected] = useState<boolean>(false);

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

    fetch('/api/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (isMounted && data?.state) {
          setState(data.state);
          setSseConnected(true);
          if (Array.isArray(data.toolsRegistry)) {
            setToolsRegistry(data.toolsRegistry);
          }
        }
      })
      .catch(() => {
        // Retain deterministic baseline state if offline
      });

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/sync/stream');
      eventSource.onopen = () => {
        if (isMounted) setSseConnected(true);
      };
      eventSource.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data);
          if (isMounted && parsed?.state) {
            setState(parsed.state);
            setSseConnected(true);
          }
        } catch {
          // ignore malformed keepalive
        }
      };
      eventSource.onerror = () => {
        if (isMounted) setSseConnected(false);
      };
    } catch {
      // SSE optional fallback
    }

    return () => {
      isMounted = false;
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
    try {
      const res = await fetch('/api/brain/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, modality, language }),
      });
      const data = await res.json();
      if (data?.state) {
        setState(data.state);
      }
      return data?.message || null;
    } catch {
      return null;
    }
  };

  const handleExecuteBrainTool = async (
    toolName: string,
    args: Record<string, unknown> = {}
  ) => {
    try {
      const res = await fetch('/api/brain/execute-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args }),
      });
      const data = await res.json();
      if (data?.state) setState(data.state);
    } catch {
      // ignore
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

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/devices/${deviceId}/revoke`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data?.state) setState(data.state);
    } catch {
      // ignore
    }
  };

  const handleReportCameraTelemetry = async (
    cameraId: string,
    payload: {
      isLiveWebcam: boolean;
      fps: number;
      inferenceLatencyMs: number;
      motionScore: number;
    }
  ) => {
    try {
      const res = await fetch(`/api/cameras/${cameraId}/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.state) setState(data.state);
    } catch {
      // ignore
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
      const data = await res.json();
      if (data?.state) setState(data.state);
    } catch {
      // ignore
    }
  };

  const handleRefreshAudit = async () => {
    const res = await fetch('/api/state');
    const data = await res.json();
    if (data?.state) setState(data.state);
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

  const displayedSeries =
    chartWindow === '1H'
      ? state.timeSeries.slice(-4)
      : chartWindow === '6H'
      ? state.timeSeries.slice(-8)
      : state.timeSeries;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('OVERVIEW');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          VantaVisionAI
        </a>

        {/* Zone 2: 5 clean single-line navigation links */}
        <nav
          aria-label="Primary Command Navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          <button
            type="button"
            onClick={() => setActiveTab('OVERVIEW')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'OVERVIEW'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-sky-500 decoration-2'
                : ''
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('CAMERAS')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'CAMERAS'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-sky-500 decoration-2'
                : ''
            }`}
          >
            Cameras
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('BRAIN_ALEANA')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'BRAIN_ALEANA'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-sky-500 decoration-2'
                : ''
            }`}
          >
            Vanta Brain
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('OPERATIONS')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'OPERATIONS'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-sky-500 decoration-2'
                : ''
            }`}
          >
            Operations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('DIGITAL_TWIN')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'DIGITAL_TWIN'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-sky-500 decoration-2'
                : ''
            }`}
          >
            Digital Twin
          </button>
        </nav>

        {/* Zone 3: 1 primary action button */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('BRAIN_ALEANA')}
            className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Launch ALEANA Voice
          </button>
        </div>
      </header>

      {/* MAIN COMMAND SHELL: RESPONSIVE SIDEBAR + WORKSPACE VIEWPORT */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Collapsible Sidebar */}
        <aside
          aria-label="Workspace Domain Navigation"
          className={`${
            sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'
          } w-full shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between overflow-y-auto transition-all`}
        >
          <div className="p-3 space-y-4">
            {/* Sidebar Collapse Control & Sync Telemetry */}
            <div className="flex items-center justify-between px-2 py-1">
              {!sidebarCollapsed && (
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  VANTA NEXUS V11.0
                </span>
              )}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((c) => !c)}
                aria-label={
                  sidebarCollapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'
                }
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Global Unified Search */}
            {!sidebarCollapsed && (
              <div className="relative">
                <label htmlFor="global-nexus-search" className="sr-only">
                  Search cameras, incidents, devices, policies
                </label>
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="global-nexus-search"
                  type="search"
                  value={globalSearchQuery}
                  onChange={(e) => setGlobalSearchQuery(e.target.value)}
                  placeholder="Search cameras, incidents..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                {searchResults.length > 0 && (
                  <div className="mt-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 shadow-lg divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
                    {searchResults.map((res) => (
                      <button
                        key={`${res.type}-${res.id}`}
                        type="button"
                        onClick={() => {
                          setActiveTab(res.targetTab);
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
            )}

            {/* Navigation Items */}
            <div className="space-y-1">
              {(
                [
                  {
                    id: 'OVERVIEW',
                    label: 'Command Overview',
                    icon: Activity,
                  },
                  {
                    id: 'CAMERAS',
                    label: 'Camera Workspace',
                    icon: Camera,
                  },
                  {
                    id: 'BRAIN_ALEANA',
                    label: 'Vanta Brain & ALEANA',
                    icon: Brain,
                  },
                  {
                    id: 'OPERATIONS',
                    label: 'Incidents & Policies',
                    icon: ShieldAlert,
                  },
                  {
                    id: 'DEVICES',
                    label: 'Multi-Device Sync',
                    icon: Smartphone,
                  },
                  {
                    id: 'DIGITAL_TWIN',
                    label: 'Digital Twin & Replay',
                    icon: Layers,
                  },
                  {
                    id: 'AUDIT_BLUEPRINT',
                    label: 'Audit & Blueprint',
                    icon: ShieldCheck,
                  },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 text-white dark:bg-sky-500/15 dark:text-sky-300 font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom Governance & Theme Controls */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
            {!sidebarCollapsed && (
              <div className="space-y-1.5">
                <label
                  htmlFor="rbac-role-select"
                  className="block text-xs font-mono text-slate-500 dark:text-slate-400"
                >
                  ACTIVE RBAC ROLE
                </label>
                <select
                  id="rbac-role-select"
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

            <button
              type="button"
              onClick={() => setIsDarkMode((d) => !d)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  {!sidebarCollapsed && <span>Switch to Light Theme</span>}
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-slate-700 shrink-0" />
                  {!sidebarCollapsed && <span>Switch to Dark Theme</span>}
                </>
              )}
            </button>
          </div>
        </aside>

        {/* Main Scrollable Content Viewport */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 max-w-[1440px] mx-auto w-full space-y-6">
          {/* Context Breadcrumb & Real-time Cloud Sync Status Strip */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            <div>
              <span>{state.tenant.organizationName}</span>
              <span className="mx-2">/</span>
              <span className="text-slate-900 dark:text-slate-200 font-medium">
                {state.tenant.siteName}
              </span>
              <span className="mx-2">·</span>
              <span>OPERATOR: {state.tenant.userName} ({state.tenant.role})</span>
            </div>

            <div className="flex items-center gap-3">
              <span>
                CLOUD SYNC: {sseConnected ? 'LIVE SSE STREAM' : 'LOCAL STATE'} · REV #{state.syncRevision}
              </span>
              <span>·</span>
              <span>
                SHA-256 AUDIT: {auditCheck.valid ? 'VERIFIED' : 'CHECK'} ({auditCheck.checkedCount})
              </span>
            </div>
          </div>

          {/* WORKSPACE ROUTING */}
          {activeTab === 'OVERVIEW' && (
            <div className="space-y-6">
              {/* Hero / Command Overview Header + Direct Brain Command Bar */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-6 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-sky-600 dark:text-sky-400">
                      VANTA NEXUS COMMAND CENTER · ENTERPRISE INFRASTRUCTURE INTELLIGENCE
                    </div>
                    <h1
                      className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 dark:text-white"
                      style={{ textWrap: 'balance' }}
                    >
                      Unified Vision, 9-Layer Brain Reasoning & Bilingual Voice Operations
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
                      Real-time cross-device synchronization connecting authorized camera telemetry, explainable security policies, Digital Twin spatial state, and SHA-256 cryptographic audit governance.
                    </p>
                  </div>

                  {/* Quick Brain Command Bar */}
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!quickBrainPrompt.trim()) return;
                      setQuickBrainLoading(true);
                      await handleSendBrainQuery(quickBrainPrompt, 'TEXT');
                      setQuickBrainLoading(false);
                      setQuickBrainPrompt('');
                      setActiveTab('BRAIN_ALEANA');
                    }}
                    className="flex flex-wrap items-center gap-2 pt-2"
                  >
                    <label htmlFor="overview-brain-input" className="sr-only">
                      Quick command to Vanta Brain
                    </label>
                    <input
                      id="overview-brain-input"
                      type="text"
                      value={quickBrainPrompt}
                      onChange={(e) => setQuickBrainPrompt(e.target.value)}
                      placeholder="Ask Vanta Brain (e.g., 'Explain INC-2041' or 'Abhi kitne cameras active hain')..."
                      className="flex-1 min-w-[240px] px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <button
                      type="submit"
                      disabled={quickBrainLoading}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                    >
                      {quickBrainLoading ? 'Executing...' : 'Ask Vanta Brain'}
                    </button>
                  </form>
                </div>

                {/* Right: Latest Vanta Brain × ALEANA Executive Synthesis */}
                <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-6 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400">
                      <span>VANTA BRAIN × ALEANA LIVE BRIEFING</span>
                      <span>25 TOOLS ONLINE</span>
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
                      onClick={() => setActiveTab('BRAIN_ALEANA')}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-sky-300 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                    >
                      Open Brain & Voice Console →
                    </button>
                  </div>
                </div>
              </div>

              {/* Full-Width 6-Metric Operational KPI Row (Every Metric Clickable to Detailed Workspace) */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <button
                  type="button"
                  onClick={() => setActiveTab('CAMERAS')}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                >
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Camera Endpoints
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                    {state.cameras.length}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-1">
                    3 Simulated · 1 Degraded
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('DEVICES')}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                >
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Synced Devices
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                    {state.devices.filter((d) => d.authorized).length}/{state.devices.length}
                  </div>
                  <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                    Cloud Rev #{state.syncRevision}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('OPERATIONS')}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                >
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Open Incidents
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">
                    {openIncidentsCount}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-1">
                    {state.events.length} Verified Events
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('DIGITAL_TWIN')}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                >
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Facility Occupancy
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                    {totalOccupancy}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-1">
                    Across {state.zones.length} Monitored Zones
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('BRAIN_ALEANA')}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                >
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Brain Tool Registry
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-1">
                    {toolsRegistry.length}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-1">
                    9-Layer Pipeline Active
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('AUDIT_BLUEPRINT')}
                  className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-500/60 transition-colors"
                >
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    SHA-256 Audit Chain
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                    {auditCheck.checkedCount}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-1">
                    Integrity: {auditCheck.valid ? 'VERIFIED' : 'ALERT'}
                  </div>
                </button>
              </div>

              {/* Data Analytics & Telemetry Visualization Row */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* Time-Series Event & Occupancy Analytics Chart */}
                <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Event Frequency, Zone Occupancy & Sync Throughput Analytics
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                        Units: Occupants (count) & Events/15m · Source: Canonical Telemetry Store (Simulated Baseline)
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
                    <span>Legend: Sky Bar = Tracked Occupants (p) · Amber Bar = Security Events (e)</span>
                    <span>Avg CV Latency: 17ms · Provenance: Simulated Baseline</span>
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
                        onClick={() => setActiveTab('OPERATIONS')}
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
            />
          )}

          {activeTab === 'BRAIN_ALEANA' && (
            <BrainAndAleanaWorkspace
              state={state}
              toolsRegistry={toolsRegistry}
              onSendQuery={handleSendBrainQuery}
              onExecuteTool={handleExecuteBrainTool}
              onUpdatePreferences={handleUpdatePreferences}
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
        </main>
      </div>
    </div>
  );
}
