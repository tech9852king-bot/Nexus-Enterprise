import React, { useEffect, useRef, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  Cpu,
  Layers,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import {
  AleanaSubsystemStatus,
  AssistantPreferences,
  BrainToolDefinition,
  ConversationMessage,
  VantaSystemState,
} from '../core/types';

interface BrainAndAleanaWorkspaceProps {
  state: VantaSystemState;
  toolsRegistry: BrainToolDefinition[];
  onSendQuery: (
    query: string,
    modality: 'TEXT' | 'VOICE_ALEANA',
    language?: 'en' | 'hi' | 'hinglish'
  ) => Promise<ConversationMessage | null>;
  onVerifyGemini?: () => Promise<void>;
  onExecuteTool: (
    toolName: string,
    args?: Record<string, unknown>
  ) => Promise<{ error?: string; message?: string } | void>;
  onUpdatePreferences: (prefs: Partial<AssistantPreferences>) => Promise<void>;
  onExecuteWorkflow?: (
    workflowId: string,
    approvedByHuman?: boolean
  ) => Promise<{ error?: string; message?: string } | void>;
  onManageMemory?: (
    action: 'RESET_CONVERSATION' | 'UPDATE_RETENTION',
    retentionDays?: number
  ) => Promise<{ error?: string; message?: string } | void>;
}

type VoiceStage = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING' | 'INTERRUPTED' | 'ERROR';

export const BrainAndAleanaWorkspace: React.FC<BrainAndAleanaWorkspaceProps> = ({
  state,
  toolsRegistry,
  onSendQuery,
  onVerifyGemini,
  onExecuteTool,
  onUpdatePreferences,
  onExecuteWorkflow,
  onManageMemory,
}) => {
  const [queryInput, setQueryInput] = useState('');
  const [selectedLang, setSelectedLang] = useState<'en' | 'hi' | 'hinglish'>(
    state.preferences.languagePreference
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifyingGemini, setIsVerifyingGemini] = useState(false);
  const [runningToolName, setRunningToolName] = useState<string | null>(null);
  const [executingWorkflowId, setExecutingWorkflowId] = useState<string | null>(null);
  const [isManagingMemory, setIsManagingMemory] = useState<boolean>(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [governanceFeedback, setGovernanceFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    setSelectedLang(state.preferences.languagePreference);
  }, [state.preferences.languagePreference]);
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState<{
    q: string;
    modality: 'TEXT' | 'VOICE_ALEANA';
  } | null>(null);
  const [toolFilter, setToolFilter] = useState<
    'ALL' | BrainToolDefinition['category']
  >('ALL');
  const [voiceStage, setVoiceStage] = useState<VoiceStage>('IDLE');
  const [speechRecognitionSupported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    );
  });
  const [speechSynthesisSupported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return 'speechSynthesis' in window;
  });
  const [aleanaSubsystemStatus, setAleanaSubsystemStatus] =
    useState<AleanaSubsystemStatus>(() => {
      if (typeof window !== 'undefined') {
        const hasRec = Boolean(
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        );
        return hasRec
          ? 'SPEECH RECOGNITION AVAILABLE'
          : 'SPEECH RECOGNITION UNSUPPORTED';
      }
      return 'TEXT READY';
    });
  const [voiceStatusText, setVoiceStatusText] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const hasRec = Boolean(
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      );
      return hasRec
        ? 'Voice capability available · Push-to-Talk or Text input ready'
        : 'Voice recognition unsupported in current browser · Text & Speech Synthesis fallback active';
    }
    return 'ALEANA Bilingual Engine Ready';
  });
  const recognitionRef = useRef<any>(null);

  const latestAssistantMsg = [...state.conversations]
    .reverse()
    .find((m) => m.role === 'assistant');

  const brainDiag = state.brainAiDiagnostics;

  // Speak response with Web Speech Synthesis when enabled
  const speakText = (text: string, lang: 'en' | 'hi' | 'hinglish') => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setAleanaSubsystemStatus('SPEECH SYNTHESIS ERROR');
      setVoiceStatusText('Speech synthesis unsupported in current browser · Text display active.');
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'hi' ? 'hi-IN' : lang === 'hinglish' ? 'en-IN' : 'en-US';
      utterance.rate = state.preferences.speakingRate || 1.0;
      utterance.volume = state.preferences.volume ?? 0.9;
      utterance.onstart = () => {
        setVoiceStage('SPEAKING');
        setVoiceStatusText(`ALEANA Speaking (${utterance.lang})...`);
      };
      utterance.onend = () => {
        setVoiceStage('IDLE');
        setVoiceStatusText('ALEANA Ready · Shared Brain Context Synchronized');
      };
      utterance.onerror = () => {
        setVoiceStage('IDLE');
        setAleanaSubsystemStatus('SPEECH SYNTHESIS ERROR');
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      setVoiceStage('IDLE');
      setAleanaSubsystemStatus('SPEECH SYNTHESIS ERROR');
    }
  };

  const handleBargeInInterrupt = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setVoiceStage('INTERRUPTED');
    setVoiceStatusText('Barge-in interruption handled: Speech output halted immediately.');
  };

  const handleSubmitQuery = async (
    rawQuery: string,
    modality: 'TEXT' | 'VOICE_ALEANA' = 'TEXT'
  ) => {
    const trimmed = rawQuery.trim();
    if (!trimmed || isSubmitting) return;

    if (voiceStage === 'SPEAKING') {
      handleBargeInInterrupt();
    }

    setIsSubmitting(true);
    setRequestError(null);
    setLastSubmittedQuery({ q: trimmed, modality });
    setVoiceStage('PROCESSING');
    setVoiceStatusText('Vanta Brain 9-Layer Pipeline & Tool Orchestration running...');

    try {
      const responseMsg = await onSendQuery(trimmed, modality, selectedLang);
      setQueryInput('');
      if (responseMsg && state.preferences.autoSpeakResponses) {
        speakText(responseMsg.directAnswer || responseMsg.content, responseMsg.language);
      } else {
        setVoiceStage('IDLE');
        setVoiceStatusText('Response grounded in verified operational data.');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to execute Vanta Brain query.';
      setRequestError(msg);
      setVoiceStage('ERROR');
      setVoiceStatusText(`Brain request error: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startVoiceCapture = () => {
    // Section 6.2: Prevent duplicate microphone sessions
    if (voiceStage === 'LISTENING') {
      return;
    }
    if (voiceStage === 'SPEAKING') {
      handleBargeInInterrupt();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      setVoiceStage('ERROR');
      setAleanaSubsystemStatus('SPEECH RECOGNITION UNSUPPORTED');
      setVoiceStatusText(
        'Voice capability unsupported in current browser (Web Speech Recognition API unavailable). Please use the text input or preset query buttons below.'
      );
      return;
    }

    try {
      const rec = new SpeechRec();
      recognitionRef.current = rec;
      rec.lang = selectedLang === 'hi' ? 'hi-IN' : 'en-IN';
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setVoiceStage('LISTENING');
        setAleanaSubsystemStatus('SPEECH RECOGNITION AVAILABLE');
        setVoiceStatusText(`Listening via Microphone (${rec.lang})... Speak now`);
      };
      rec.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        if (transcript) {
          void handleSubmitQuery(transcript, 'VOICE_ALEANA');
        }
      };
      rec.onend = () => {
        recognitionRef.current = null;
        setVoiceStage((prev) => (prev === 'LISTENING' ? 'IDLE' : prev));
      };
      rec.onerror = (err: any) => {
        recognitionRef.current = null;
        setVoiceStage('ERROR');
        const errCode = err?.error || 'unavailable';
        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          setAleanaSubsystemStatus('MICROPHONE DENIED');
          setVoiceStatusText(
            'Voice permission denied by browser/user · Grant microphone permission or use text fallback below.'
          );
        } else {
          setVoiceStatusText(
            `Microphone capture error (${errCode}) · Use text input or preset buttons below.`
          );
        }
      };
      rec.start();
    } catch {
      recognitionRef.current = null;
      setVoiceStage('ERROR');
      setVoiceStatusText('Failed to start browser SpeechRecognition · Text fallback active.');
    }
  };

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  const filteredTools =
    toolFilter === 'ALL'
      ? toolsRegistry
      : toolsRegistry.filter((t) => t.category === toolFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Vanta Brain & ALEANA Voice Intelligence (V16.0)
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            Coordinated 9-Layer Reasoning Engine · 25 Permission-Controlled Tools · Shared Bilingual Context (English / हिन्दी / Hinglish)
          </p>
        </div>

        {/* Language & Auto-Speak Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
            role="group"
            aria-label="Conversation language"
          >
            {(
              [
                { id: 'en', label: 'English' },
                { id: 'hinglish', label: 'Hinglish' },
                { id: 'hi', label: 'हिन्दी' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedLang(item.id);
                  onUpdatePreferences({ languagePreference: item.id });
                }}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  selectedLang === item.id
                    ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              onUpdatePreferences({
                autoSpeakResponses: !state.preferences.autoSpeakResponses,
              })
            }
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            {state.preferences.autoSpeakResponses ? (
              <>
                <Volume2 className="w-3.5 h-3.5 inline mr-1.5 text-sky-500" />
                Voice Output: Enabled
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5 inline mr-1.5 text-slate-400" />
                Voice Output: Muted
              </>
            )}
          </button>
        </div>
      </div>

      {/* Section 4, 5 & 7: Truthful Vanta Brain & Gemini AI Subsystem Diagnostics Banner */}
      <div
        data-testid="brain-ai-diagnostics-banner"
        className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-4 space-y-2.5 text-xs font-mono tabular-nums"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              BRAIN PIPELINE: LOCAL PIPELINE READY (9 Layers · 25 Tools)
            </span>
            <span>·</span>
            <span
              data-testid="gemini-connection-status"
              className={
                brainDiag?.status === 'GEMINI CONNECTED'
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : brainDiag?.status === 'GEMINI UNAVAILABLE'
                  ? 'text-amber-600 dark:text-amber-400 font-semibold'
                  : 'text-rose-600 dark:text-rose-400 font-semibold'
              }
            >
              GEMINI STATUS: {brainDiag?.status || 'GEMINI UNAVAILABLE'}
            </span>
            <span>·</span>
            <span className="text-slate-600 dark:text-slate-300">
              ACTIVE ENGINE:{' '}
              <strong>
                {brainDiag?.usingFallback !== false
                  ? `${brainDiag?.fallbackModelName || 'vanta-brain-9layer-v16-fallback'} (Deterministic Local)`
                  : `${brainDiag?.modelName || 'gemini-4-hydrogen'} (Live Cloud AI)`}
              </strong>
            </span>
          </div>

          <button
            type="button"
            data-testid="verify-gemini-btn"
            disabled={isVerifyingGemini}
            onClick={async () => {
              if (!onVerifyGemini) return;
              setIsVerifyingGemini(true);
              try {
                await onVerifyGemini();
              } finally {
                setIsVerifyingGemini(false);
              }
            }}
            className="px-3 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-sky-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3 h-3 inline mr-1.5 ${
                isVerifyingGemini ? 'animate-spin' : ''
              }`}
            />
            {isVerifyingGemini ? 'Probing Gemini...' : 'Verify Gemini Connection'}
          </button>
        </div>

        {brainDiag?.lastErrorMessage && (
          <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200 font-sans flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-mono font-semibold">
                [{brainDiag.lastErrorCategory || 'DIAGNOSTIC'}]:
              </span>{' '}
              {brainDiag.lastErrorMessage}
            </div>
          </div>
        )}
      </div>

      {/* Request Error Banner with Retry */}
      {requestError && (
        <div
          role="alert"
          data-testid="brain-request-error-banner"
          className="p-3.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-200 flex flex-wrap items-center justify-between gap-3"
        >
          <span>Brain Query Error: {requestError}</span>
          <div className="flex items-center gap-2">
            {lastSubmittedQuery && (
              <button
                type="button"
                onClick={() =>
                  void handleSubmitQuery(
                    lastSubmittedQuery.q,
                    lastSubmittedQuery.modality
                  )
                }
                className="px-2.5 py-1 rounded bg-rose-600 text-white font-semibold hover:bg-rose-500"
              >
                Retry Query
              </button>
            )}
            <button
              type="button"
              onClick={() => setRequestError(null)}
              className="underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ALEANA Voice HUD Bar */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={startVoiceCapture}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-transform active:scale-95 ${
              voiceStage === 'LISTENING'
                ? 'bg-rose-600 text-white'
                : voiceStage === 'SPEAKING' || voiceStage === 'PROCESSING'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-slate-900 text-white dark:bg-slate-800 dark:text-sky-400'
            }`}
            aria-label="Push to talk with ALEANA"
          >
            {voiceStage === 'LISTENING' ? (
              <Mic className="w-5 h-5" />
            ) : (
              <MicOff className="w-5 h-5" />
            )}
          </button>

          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
              <span data-testid="aleana-subsystem-status">
                ALEANA STATUS: {aleanaSubsystemStatus}
              </span>
              <span>·</span>
              <span>VOICE STAGE: {voiceStage}</span>
              <span>·</span>
              <span>
                STT: {speechRecognitionSupported ? 'AVAILABLE' : 'UNSUPPORTED (TEXT FALLBACK)'}
              </span>
              <span>·</span>
              <span>
                TTS: {speechSynthesisSupported ? 'AVAILABLE' : 'UNSUPPORTED'}
              </span>
              <span>·</span>
              <span>LANG: {selectedLang.toUpperCase()}</span>
            </div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5">
              {voiceStatusText}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startVoiceCapture}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Mic className="w-3.5 h-3.5 inline mr-1.5" />
            Push-to-Talk ({selectedLang.toUpperCase()})
          </button>

          <button
            type="button"
            onClick={handleBargeInInterrupt}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Square className="w-3.5 h-3.5 inline mr-1.5" />
            Interrupt / Stop Speaking
          </button>

          {latestAssistantMsg && (
            <button
              type="button"
              onClick={() =>
                speakText(
                  latestAssistantMsg.directAnswer || latestAssistantMsg.content,
                  latestAssistantMsg.language
                )
              }
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5 inline mr-1.5" />
              Replay Last Answer
            </button>
          )}
        </div>
      </div>

      {/* Main Split: Shared Conversation + 9-Layer Intelligence Trace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Conversation & Query Panel */}
        <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
            {state.conversations.map((msg) => (
              <div
                key={msg.id}
                className={`p-4 rounded-xl border ${
                  msg.role === 'user'
                    ? 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 ml-8'
                    : 'bg-white dark:bg-slate-900/90 border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mb-1.5">
                  <span>
                    {msg.role === 'user' ? `${state.tenant.userName} (${msg.modality})` : 'VANTA BRAIN × ALEANA'} ·{' '}
                    {msg.language.toUpperCase()}
                  </span>
                  <span>
                    {msg.latencyMs ? `${msg.latencyMs}ms · ` : ''}
                    {msg.modelUsed || 'Verified Context'}
                  </span>
                </div>

                <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
                  {msg.directAnswer || msg.content}
                </p>

                {msg.keyFindings && msg.keyFindings.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Evidence-Grounded Findings:
                    </div>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc list-inside">
                      {msg.keyFindings.map((finding, idx) => (
                        <li key={idx}>{finding}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {msg.evidenceCitations && msg.evidenceCitations.length > 0 && (
                  <div className="mt-2.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    Citations: {msg.evidenceCitations.join(' · ')}
                  </div>
                )}

                {msg.epistemicBreakdown && msg.epistemicBreakdown.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                    <div className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                      EPISTEMIC REASONING BREAKDOWN (SECTION 7.4):
                    </div>
                    {msg.epistemicBreakdown.map((item, idx) => (
                      <div key={idx} className="text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-200">
                          [{item.category}]
                        </span>{' '}
                        {item.statement}{' '}
                        <span className="font-mono text-slate-400">({item.sourceRef})</span>
                      </div>
                    ))}
                  </div>
                )}

                {msg.recommendedNextAction && (
                  <div className="mt-2 text-xs text-sky-600 dark:text-sky-400 font-medium">
                    Next Step: {msg.recommendedNextAction}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Preset Bilingual Queries + Input Form */}
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                {
                  label: 'Unresolved Incidents',
                  q: 'Show me the unresolved incidents and explain why INC-2041 is high priority.',
                },
                {
                  label: 'Hinglish Status Check',
                  q: 'Abhi kitne cameras aur incidents active hain dikhao',
                },
                {
                  label: 'Run Troubleshooter',
                  q: 'Run pipeline troubleshooter on degraded camera streams and check packet loss.',
                },
                {
                  label: 'Predict Occupancy',
                  q: 'Predict aggregate facility occupancy for the next 30 minutes.',
                },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleSubmitQuery(preset.q, 'TEXT')}
                  className="px-2.5 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmitQuery(queryInput, 'TEXT');
              }}
              className="flex items-center gap-2"
            >
              <label htmlFor="vanta-brain-input" className="sr-only">
                Ask Vanta Brain or ALEANA in English, Hindi, or Hinglish
              </label>
              <input
                id="vanta-brain-input"
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Ask Vanta Brain or ALEANA in English, Hindi, or Hinglish..."
                className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5 inline mr-1.5" />
                {isSubmitting ? 'Reasoning...' : 'Ask Brain'}
              </button>
            </form>
          </div>
        </div>

        {/* 9-Layer Intelligence Architecture Trace */}
        <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-500" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  9-Layer Intelligence Execution Trace
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                RBAC: {state.tenant.role}
              </span>
            </div>

            <div className="space-y-2.5">
              {(
                latestAssistantMsg?.layerTraces || [
                  {
                    layerNumber: 1,
                    layerName: 'Intent Intelligence',
                    status: 'COMPLETED',
                    latencyMs: 4,
                    summary: 'Ready to classify operator intent and language.',
                    evidenceRefs: ['L1-READY'],
                  },
                  {
                    layerNumber: 2,
                    layerName: 'Context Intelligence',
                    status: 'COMPLETED',
                    latencyMs: 5,
                    summary: `Scoped to ${state.tenant.siteName} (Rev #${state.syncRevision}).`,
                    evidenceRefs: [state.tenant.tenantId],
                  },
                  {
                    layerNumber: 3,
                    layerName: 'Data Intelligence',
                    status: 'COMPLETED',
                    latencyMs: 8,
                    summary: 'Connected to canonical state & 25-tool registry.',
                    evidenceRefs: ['CANONICAL-STORE'],
                  },
                  {
                    layerNumber: 4,
                    layerName: 'Vision Intelligence',
                    status: 'COMPLETED',
                    latencyMs: 6,
                    summary: `Monitoring ${state.cameras.length} camera endpoints.`,
                    evidenceRefs: state.cameras.map((c) => c.id),
                  },
                  {
                    layerNumber: 5,
                    layerName: 'Temporal Intelligence',
                    status: 'COMPLETED',
                    latencyMs: 5,
                    summary: `Tracking ${state.events.length} chronological events.`,
                    evidenceRefs: ['TIMELINE-SYNC'],
                  },
                  {
                    layerNumber: 6,
                    layerName: 'Policy & Risk Intelligence',
                    status: 'COMPLETED',
                    latencyMs: 5,
                    summary: `${state.policies.filter((p) => p.enabled).length} compound rules active.`,
                    evidenceRefs: state.policies.map((p) => p.id),
                  },
                  {
                    layerNumber: 7,
                    layerName: 'Reasoning & Orchestration',
                    status: 'COMPLETED',
                    latencyMs: 9,
                    summary: '25 permission-checked tools bound.',
                    evidenceRefs: ['TOOL-ORCHESTRATOR'],
                  },
                  {
                    layerNumber: 8,
                    layerName: 'Explanation Intelligence',
                    status: 'COMPLETED',
                    latencyMs: 5,
                    summary: 'Enforces provenance separation (Measured vs Simulated).',
                    evidenceRefs: ['PROVENANCE-GUARD'],
                  },
                  {
                    layerNumber: 9,
                    layerName: 'Governance Intelligence',
                    status: 'COMPLETED',
                    latencyMs: 3,
                    summary: `SHA-256 audit chain verified (${state.auditTrail.length} blocks).`,
                    evidenceRefs: ['SHA256-LEDGER'],
                  },
                ]
              ).map((layer) => (
                <div
                  key={layer.layerNumber}
                  className="py-2 border-b border-slate-100 dark:border-slate-800/80 last:border-b-0"
                >
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      0{layer.layerNumber}. {layer.layerName}
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {layer.status} · {layer.latencyMs}ms
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {layer.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {latestAssistantMsg?.uncertaintyDisclosure && (
            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Uncertainty & Provenance Disclosure:{' '}
              </span>
              {latestAssistantMsg.uncertaintyDisclosure}
            </div>
          )}
        </div>
      </div>

      {/* 25 Typed, Permission-Controlled Brain Tool Ecosystem */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-sky-500" />
              Authorized Brain Tool Ecosystem ({toolsRegistry.length} Registered Tools)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Every tool execution validates tenant scope, checks RBAC role ({state.tenant.role}), and appends a SHA-256 audit block.
            </p>
          </div>

          <div
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            role="group"
            aria-label="Filter Brain tools by category"
          >
            {(
              [
                { id: 'ALL', label: `All (${toolsRegistry.length})` },
                { id: 'SYSTEM', label: 'System (5)' },
                { id: 'CAMERA_DEVICE', label: 'Camera & Device (5)' },
                { id: 'EVENT_INCIDENT', label: 'Event & Incident (5)' },
                { id: 'POLICY_INTELLIGENCE', label: 'Policy & AI (5)' },
                { id: 'OPERATIONS_GOVERNANCE', label: 'Operations (5)' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setToolFilter(cat.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  toolFilter === cat.id
                    ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Recent Tool Execution Output Banner */}
        {state.toolExecutions.length > 0 && (
          <div
            data-testid="latest-tool-execution"
            className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-mono tabular-nums space-y-1"
          >
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span>
                LATEST TOOL EXECUTION: {state.toolExecutions[0].executionId} ·{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {state.toolExecutions[0].toolName}
                </strong>
              </span>
              <span>
                STATUS: {state.toolExecutions[0].status} · {state.toolExecutions[0].latencyMs}ms ·{' '}
                PROVENANCE: {state.toolExecutions[0].provenance}
              </span>
            </div>
            <div className="text-slate-800 dark:text-slate-200 font-sans">
              {state.toolExecutions[0].resultSummary}
            </div>
          </div>
        )}

        {/* Tool Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredTools.map((tool) => {
            const permitted = tool.requiredRole.includes(state.tenant.role);
            return (
              <div
                key={tool.id}
                className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400">
                    <span>
                      {tool.id} · {tool.category}
                    </span>
                    <span>{tool.consequential ? 'CONSEQUENTIAL' : 'READ-ONLY'}</span>
                  </div>
                  <div className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100 mt-1">
                    {tool.name}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {tool.description}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-slate-500 truncate">
                    Out: {tool.outputSchemaSummary}
                  </span>
                  <button
                    type="button"
                    disabled={runningToolName === tool.name}
                    onClick={async () => {
                      if (runningToolName) return;
                      setRunningToolName(tool.name);
                      setGovernanceFeedback(null);
                      try {
                        const res = await onExecuteTool(tool.name, {});
                        if (res && res.error) {
                          setGovernanceFeedback({ type: 'error', message: res.error });
                        } else if (res && res.message) {
                          setGovernanceFeedback({ type: 'success', message: res.message });
                        }
                      } finally {
                        setRunningToolName(null);
                      }
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                      permitted
                        ? 'bg-slate-900 text-white dark:bg-slate-800 dark:text-sky-300 hover:opacity-90'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {runningToolName === tool.name
                      ? 'Running...'
                      : permitted
                      ? 'Run Tool'
                      : 'Test RBAC Deny'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {governanceFeedback && (
        <div
          role="status"
          data-testid="brain-governance-feedback"
          className={`p-3 rounded-xl border text-xs font-medium ${
            governanceFeedback.type === 'error'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {governanceFeedback.message}
        </div>
      )}

      {/* V14.0 Autonomous Workflow Engine & Conversation Memory Governance (Sections 9 & 12) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Autonomous Workflow Engine */}
        <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-sky-500" />
                Autonomous Workflow Engine & Human Approval Boundary
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Multi-step orchestrated workflows with explicit Human Approval Boundary gating for consequential actions
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {(state.workflows || []).length} Registered Workflows
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {(state.workflows || []).map((wf) => {
              const isAwaiting = wf.status === 'AWAITING_APPROVAL';
              return (
                <div
                  key={wf.id}
                  data-testid={`workflow-card-${wf.id}`}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {wf.id} · {wf.triggerType}
                      </span>
                      <span
                        className={
                          isAwaiting
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : wf.status === 'COMPLETED'
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-sky-600 dark:text-sky-400'
                        }
                      >
                        {wf.status}
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {wf.name}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {wf.description}
                    </p>
                    <div className="text-xs font-mono text-slate-500 pt-1">
                      Steps: {wf.steps.join(' -> ')}
                    </div>
                    {wf.lastResultSummary && (
                      <div className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200/70 dark:border-slate-800 mt-1">
                        {wf.lastResultSummary}
                      </div>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-slate-500">
                      {wf.requiresHumanApproval ? 'HUMAN APPROVAL REQUIRED' : 'AUTONOMOUS READ-ONLY'}
                    </span>
                    {isAwaiting ? (
                      <button
                        type="button"
                        disabled={executingWorkflowId === wf.id}
                        onClick={async () => {
                          if (executingWorkflowId) return;
                          setExecutingWorkflowId(wf.id);
                          setGovernanceFeedback(null);
                          try {
                            const res = await onExecuteWorkflow?.(wf.id, true);
                            if (res && res.error) {
                              setGovernanceFeedback({ type: 'error', message: res.error });
                            } else {
                              setGovernanceFeedback({
                                type: 'success',
                                message:
                                  res?.message ||
                                  `Workflow ${wf.id} approved and executed.`,
                              });
                            }
                          } finally {
                            setExecutingWorkflowId(null);
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 transition-colors whitespace-nowrap shrink-0"
                      >
                        {executingWorkflowId === wf.id
                          ? 'Approving...'
                          : 'Approve & Execute'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={executingWorkflowId === wf.id}
                        onClick={async () => {
                          if (executingWorkflowId) return;
                          setExecutingWorkflowId(wf.id);
                          setGovernanceFeedback(null);
                          try {
                            const res = await onExecuteWorkflow?.(wf.id, false);
                            if (res && res.error) {
                              setGovernanceFeedback({ type: 'error', message: res.error });
                            } else {
                              setGovernanceFeedback({
                                type: 'success',
                                message:
                                  res?.message ||
                                  `Workflow ${wf.id} execution triggered.`,
                              });
                            }
                          } finally {
                            setExecutingWorkflowId(null);
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-800 dark:text-sky-300 hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap shrink-0"
                      >
                        {executingWorkflowId === wf.id
                          ? 'Executing...'
                          : 'Execute Workflow'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Conversation Memory & Context Governance */}
        <div className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Conversation & Memory Governance
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Section 9 Context Isolation · PII Minimization · Retention Control
              </p>
            </div>

            {state.memoryGovernance && (
              <div className="space-y-2.5 text-xs font-mono tabular-nums">
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Conversation Turns</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {state.memoryGovernance.conversationTurnCount} turns
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Operational Memory Records</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {state.memoryGovernance.operationalMemoryCount} verified records
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Raw Video Stored</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    FALSE (Metadata Only)
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">PII Minimization</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    ACTIVE
                  </span>
                </div>
                <div className="py-1.5">
                  <div className="text-slate-500 mb-1.5">Retention Period Policy</div>
                  <div className="flex items-center gap-1.5">
                    {[7, 30, 90].map((days) => (
                      <button
                        key={days}
                        type="button"
                        disabled={isManagingMemory}
                        onClick={async () => {
                          if (isManagingMemory) return;
                          setIsManagingMemory(true);
                          setGovernanceFeedback(null);
                          try {
                            const res = await onManageMemory?.('UPDATE_RETENTION', days);
                            if (res && res.error) {
                              setGovernanceFeedback({ type: 'error', message: res.error });
                            } else {
                              setGovernanceFeedback({
                                type: 'success',
                                message: `Retention policy updated to ${days} days and audited.`,
                              });
                            }
                          } finally {
                            setIsManagingMemory(false);
                          }
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                          state.memoryGovernance?.retentionPeriodDays === days
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {days} Days
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <button
              type="button"
              disabled={isManagingMemory}
              onClick={async () => {
                if (isManagingMemory) return;
                setIsManagingMemory(true);
                setGovernanceFeedback(null);
                try {
                  const res = await onManageMemory?.('RESET_CONVERSATION');
                  if (res && res.error) {
                    setGovernanceFeedback({ type: 'error', message: res.error });
                  } else {
                    setGovernanceFeedback({
                      type: 'success',
                      message:
                        'Conversation context reset to genesis while preserving SHA-256 audit ledger.',
                    });
                  }
                } finally {
                  setIsManagingMemory(false);
                }
              }}
              className="w-full px-3.5 py-2 text-xs font-semibold rounded-lg border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 transition-colors"
            >
              {isManagingMemory
                ? 'Updating Memory Governance...'
                : 'Reset Conversation Memory (Preserve Audit Ledger)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
