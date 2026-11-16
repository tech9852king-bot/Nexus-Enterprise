import React, { useState } from 'react';
import {
  Battery,
  Cloud,
  Cpu,
  History,
  Layers,
  MapPin,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react';
import { DeviceEntity, VantaSystemState } from '../core/types';

interface MultiDeviceAndTwinWorkspaceProps {
  state: VantaSystemState;
  mode: 'DEVICES' | 'DIGITAL_TWIN';
  onPairDevice: (
    deviceName: string,
    targetPlatform: DeviceEntity['platform']
  ) => Promise<{ error?: string }>;
  onRevokeDevice: (deviceId: string) => Promise<void>;
}

export const MultiDeviceAndTwinWorkspace: React.FC<
  MultiDeviceAndTwinWorkspaceProps
> = ({ state, mode, onPairDevice, onRevokeDevice }) => {
  const [newDeviceName, setNewDeviceName] = useState('Patrol Handset Delta-4');
  const [targetPlatform, setTargetPlatform] =
    useState<DeviceEntity['platform']>('Android Node');
  const [pairFeedback, setPairFeedback] = useState<string | null>(null);

  // Digital Twin & Forensic Scrubber state
  const [selectedZoneId, setSelectedZoneId] = useState<string>(
    state.zones[1]?.id || 'ZN-02'
  );
  const [replayIndex, setReplayIndex] = useState<number>(
    Math.max(0, state.timeSeries.length - 1)
  );
  const [scenarioMultiplier, setScenarioMultiplier] = useState<number>(1.0);

  const selectedZone =
    state.zones.find((z) => z.id === selectedZoneId) || state.zones[0];
  const latestPairing = state.pairingSessions[0];
  const currentReplayPoint =
    state.timeSeries[replayIndex] || state.timeSeries[state.timeSeries.length - 1];

  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairFeedback(null);
    const res = await onPairDevice(newDeviceName, targetPlatform);
    if (res.error) {
      setPairFeedback(`Error: ${res.error}`);
    } else {
      setPairFeedback(
        `Device "${newDeviceName}" (${targetPlatform}) paired via short-lived token and synchronized across Cloud Event Bus.`
      );
      setNewDeviceName('');
    }
  };

  if (mode === 'DEVICES') {
    return (
      <div className="space-y-6">
        <div className="border-b border-slate-200 dark:border-slate-800 pb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Multi-Device Infrastructure & Real-Time Cloud Synchronization
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
              Cross-platform fleet governance (Android, Tablet, Windows, Edge Bridges) · Short-lived QR pairing tokens · Live SSE Revision #{state.syncRevision}
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            CLOUD SYNC CLIENTS: {state.connectedClients} · LAST SYNC:{' '}
            {new Date(state.lastCloudSyncIso).toLocaleTimeString()}
          </div>
        </div>

        {/* QR Pairing Generator + Fleet Inventory */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left: QR Pairing & Token Provisioning */}
          <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-sky-500" />
                  Short-Lived QR Device Pairing
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Provision new field handsets, supervisor tablets, or edge camera bridges with 10-minute cryptographic tokens.
                </p>
              </div>

              <form onSubmit={handlePairSubmit} className="space-y-3 text-xs">
                <div>
                  <label
                    htmlFor="pair-device-name"
                    className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Device Hostname / Label
                  </label>
                  <input
                    id="pair-device-name"
                    type="text"
                    value={newDeviceName}
                    onChange={(e) => setNewDeviceName(e.target.value)}
                    placeholder="e.g. West Gate Android S24"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="pair-platform-select"
                    className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Target Platform Architecture
                  </label>
                  <select
                    id="pair-platform-select"
                    value={targetPlatform}
                    onChange={(e) =>
                      setTargetPlatform(e.target.value as DeviceEntity['platform'])
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  >
                    <option value="Android Node">Android Node</option>
                    <option value="Tablet Command">Tablet Command</option>
                    <option value="Windows Workstation">Windows Workstation</option>
                    <option value="Linux Edge Node">Linux Edge Node</option>
                    <option value="IP Camera Bridge">IP Camera Bridge</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                >
                  Generate Pairing Token & Authorize Device
                </button>
              </form>

              {pairFeedback && (
                <div
                  role="status"
                  className="p-3 rounded-lg border border-sky-500/40 bg-sky-500/10 text-xs text-sky-700 dark:text-sky-300"
                >
                  {pairFeedback}
                </div>
              )}
            </div>

            {latestPairing && (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center gap-4">
                {/* Deterministic SVG QR Representation */}
                <svg
                  viewBox="0 0 64 64"
                  className="w-20 h-20 shrink-0 bg-white p-1.5 rounded-lg border border-slate-200"
                  aria-label="QR pairing matrix"
                >
                  <rect x="4" y="4" width="16" height="16" fill="#0f172a" />
                  <rect x="44" y="4" width="16" height="16" fill="#0f172a" />
                  <rect x="4" y="44" width="16" height="16" fill="#0f172a" />
                  <rect x="26" y="10" width="6" height="6" fill="#0f172a" />
                  <rect x="34" y="18" width="6" height="6" fill="#0f172a" />
                  <rect x="24" y="26" width="12" height="12" fill="#0284c7" />
                  <rect x="44" y="28" width="8" height="8" fill="#0f172a" />
                  <rect x="26" y="46" width="10" height="6" fill="#0f172a" />
                  <rect x="44" y="44" width="12" height="12" fill="#0f172a" />
                </svg>

                <div className="text-xs font-mono tabular-nums space-y-1 overflow-hidden">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    TOKEN: {latestPairing.tokenId} · CODE: {latestPairing.pairingCode}
                  </div>
                  <div className="text-slate-500 truncate">
                    Target: {latestPairing.deviceName} ({latestPairing.targetPlatform})
                  </div>
                  <div className="text-slate-500 truncate">
                    URI: {latestPairing.qrPayload}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Connected Fleet Inventory */}
          <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Cross-Platform Authorized Fleet ({state.devices.length} Nodes)
              </h3>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {state.devices.filter((d) => d.authorized).length} Authorized
              </span>
            </div>

            <div className="space-y-3">
              {state.devices.map((dev) => (
                <div
                  key={dev.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {dev.id} · {dev.platform} · IP {dev.ipAddress} · {dev.pairedVia}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {dev.name}
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      State: {dev.connectorState} · CPU: {dev.cpuLoadPct}% · RAM:{' '}
                      {dev.memoryUsedMb}MB · Sync Latency: {dev.syncLatencyMs}ms
                      {dev.batteryPct !== null ? ` · Battery: ${dev.batteryPct}%` : ''}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRevokeDevice(dev.id)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                      dev.authorized
                        ? 'border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
                        : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                    }`}
                  >
                    {dev.authorized ? 'Revoke Access' : 'Re-Authorize Node'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // DIGITAL TWIN & FORENSIC METADATA TIMELINE MODE
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Operational Digital Twin & Forensic Metadata Timeline
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Live synchronized spatial graph ({state.tenant.siteName}) · Scenario load multiplier · Metadata replay (Explicitly distinct from raw video)
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
          <span className="text-slate-500">SCENARIO OCCUPANCY MULTIPLIER:</span>
          {[1.0, 1.25, 1.5].map((mult) => (
            <button
              key={mult}
              type="button"
              onClick={() => setScenarioMultiplier(mult)}
              className={`px-2.5 py-1 rounded-md border transition-colors ${
                scenarioMultiplier === mult
                  ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950 border-transparent'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {mult}x
            </button>
          ))}
        </div>
      </div>

      {/* Spatial Floorplan SVG + Selected Zone Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-950 p-5 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>
              REPRESENTATION: LIVE SYNCHRONIZED SPATIAL GRAPH · SITE: {state.tenant.siteId}
            </span>
            <span>
              TOTAL POWER DRAW:{' '}
              {(
                state.zones.reduce((a, z) => a + z.powerDrawKw, 0) * scenarioMultiplier
              ).toFixed(1)}{' '}
              kW
            </span>
          </div>

          <svg
            viewBox="0 0 200 100"
            className="w-full h-[340px] bg-slate-900/90 rounded-lg border border-slate-800"
            aria-label="Facility Digital Twin spatial map"
          >
            {/* Facility Zones */}
            {state.zones.map((z) => {
              const isSelected = z.id === selectedZone?.id;
              const simOcc = Math.round(z.currentOccupancy * scenarioMultiplier);
              const isAlert = z.status === 'ALERT' || simOcc >= z.capacityLimit;
              const zx = z.bounds.x * 2;
              const zw = z.bounds.width * 2;
              return (
                <g
                  key={z.id}
                  onClick={() => setSelectedZoneId(z.id)}
                  className="cursor-pointer"
                >
                  <rect
                    x={zx}
                    y={z.bounds.y}
                    width={zw}
                    height={z.bounds.height}
                    rx={3}
                    fill={
                      isAlert
                        ? 'rgba(244, 63, 94, 0.16)'
                        : isSelected
                        ? 'rgba(56, 189, 248, 0.16)'
                        : 'rgba(30, 41, 59, 0.7)'
                    }
                    stroke={
                      isSelected
                        ? '#38bdf8'
                        : isAlert
                        ? '#f43f5e'
                        : 'rgba(148, 163, 184, 0.35)'
                    }
                    strokeWidth={isSelected ? 1.5 : 0.8}
                  />
                  <text
                    x={zx + 5}
                    y={z.bounds.y + 9}
                    fill="#f8fafc"
                    fontSize="4.2"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight="600"
                  >
                    {z.id} · {z.name.slice(0, 24)}
                  </text>
                  <text
                    x={zx + 5}
                    y={z.bounds.y + 16}
                    fill="#94a3b8"
                    fontSize="3.6"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    Occ: {simOcc}/{z.capacityLimit} · {z.temperatureC}°C · {z.powerDrawKw}kW
                  </text>
                </g>
              );
            })}

            {/* Camera Endpoints */}
            {state.cameras.map((cam) => (
              <g key={cam.id}>
                <circle
                  cx={cam.coordinates.x * 2}
                  cy={cam.coordinates.y}
                  r={2.8}
                  fill={cam.connectorState === 'Degraded' ? '#f59e0b' : '#38bdf8'}
                />
                <text
                  x={cam.coordinates.x * 2 + 4}
                  y={cam.coordinates.y + 1.2}
                  fill="#38bdf8"
                  fontSize="3.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {cam.id}
                </text>
              </g>
            ))}
          </svg>

          <div className="text-xs text-slate-400 font-mono flex flex-wrap items-center justify-between gap-2">
            <span>Click any zone sector on the map to inspect telemetry and active policies.</span>
            <span>PROVENANCE: GRAPH TELEMETRY MAPPING (NON-PHYSICS HEURISTIC)</span>
          </div>
        </div>

        {/* Selected Zone Details */}
        {selectedZone && (
          <div className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="text-xs font-mono text-slate-500">
                  DIGITAL TWIN SECTOR INSPECTOR · {selectedZone.id}
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-1">
                  {selectedZone.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedZone.building} · {selectedZone.floor} · Clearance:{' '}
                  {selectedZone.securityLevel}
                </p>
              </div>

              <div className="space-y-2 text-xs font-mono tabular-nums">
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Simulated Occupancy:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {Math.round(selectedZone.currentOccupancy * scenarioMultiplier)} /{' '}
                    {selectedZone.capacityLimit}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Dwell Alert Threshold:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {selectedZone.dwellThresholdSec}s
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Thermal / Energy Load:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {selectedZone.temperatureC}°C ·{' '}
                    {(selectedZone.powerDrawKw * scenarioMultiplier).toFixed(1)} kW
                  </span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-500">Bound Policies:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {selectedZone.activePolicyIds.join(', ') || 'None'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-500 dark:text-slate-400">
              <strong className="text-slate-700 dark:text-slate-300 block mb-1">
                Simulation Provenance Disclosure
              </strong>
              This Digital Twin represents a live synchronized spatial asset graph. Scenario multipliers estimate occupancy and power scaling heuristically; they are not CFD physics simulations.
            </div>
          </div>
        )}
      </div>

      {/* Forensic Metadata Replay Scrubber */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <History className="w-4 h-4 text-sky-500" />
              Forensic Metadata Timeline Scrubber
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Reconstructs historical bounding-box counts, incident correlation, and sync throughput. Metadata replay does not reconstruct raw video.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-sky-600 dark:text-sky-400 font-semibold">
            WINDOW: {currentReplayPoint?.label} UTC · PROVENANCE: {currentReplayPoint?.provenance}
          </span>
        </div>

        <div className="space-y-3">
          <label
            htmlFor="forensic-scrubber"
            className="block text-xs font-mono text-slate-600 dark:text-slate-400"
          >
            Scrub Historical Telemetry Checkpoint ({replayIndex + 1} / {state.timeSeries.length})
          </label>
          <input
            id="forensic-scrubber"
            type="range"
            min={0}
            max={Math.max(0, state.timeSeries.length - 1)}
            value={replayIndex}
            onChange={(e) => setReplayIndex(Number(e.target.value))}
            className="w-full accent-sky-500"
          />

          {currentReplayPoint && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 font-mono tabular-nums text-xs">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">TIMESTAMP WINDOW</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {currentReplayPoint.label} UTC
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">RECORDED EVENTS</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {currentReplayPoint.eventsCount} events
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">FACILITY OCCUPANCY</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {currentReplayPoint.occupancyTotal} tracked entities
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="text-slate-500">CLOUD SYNC THROUGHPUT</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                  {currentReplayPoint.syncThroughputKbps} kbps
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
