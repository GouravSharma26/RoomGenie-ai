import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Sparkles, 
  X, 
  Send, 
  Loader2, 
  Check, 
  AlertCircle, 
  CheckCircle2, 
  Layers, 
  PlusCircle, 
  Palette, 
  Trash2, 
  RefreshCw,
  Coins
} from 'lucide-react';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { 
  createAgentSession, 
  sendAgentPrompt, 
  applyAgentRun, 
  rejectAgentRun,
  type AgentSessionRecord, 
  type AgentRunRecord, 
  type ProposedAction,
  type BudgetDiff 
} from '../../services/agentApi';
import type { CanonicalScene } from '../../types/scene';
import { clampPositionToRoom } from '../../editor3d/validation/sceneValidation';
import { recordAgentProposal, recordAgentAcceptance } from '../../services/evaluationTelemetry';

function checkSceneHasOutOfBounds(scene?: CanonicalScene | null): boolean {
  if (!scene || !scene.room || !Array.isArray(scene.objects)) return false;
  for (const obj of scene.objects) {
    const clamped = clampPositionToRoom(obj.position, obj.dimensions, scene.room, obj.scale, obj.rotationEuler);
    if (Math.abs(clamped[0] - obj.position[0]) > 0.001 || Math.abs(clamped[2] - obj.position[2]) > 0.001) {
      return true;
    }
  }
  return false;
}

interface AiAgentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSceneApplied?: (newScene: CanonicalScene) => void;
}

interface MessageItem {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  run?: AgentRunRecord;
  candidateScene?: CanonicalScene;
  budgetDiff?: BudgetDiff;
}

const QUICK_PROMPTS = [
  'Add an armchair and create a cozy reading corner',
  'Add a modern desk and workspace',
  'Add a coffee table and indoor plants',
  'Change sofa material to midnight charcoal',
  'Clear all furniture from the room',
];

function generateMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getFormattedTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const AiAgentDrawer: React.FC<AiAgentDrawerProps> = ({
  isOpen,
  onClose,
  onSceneApplied,
}) => {
  const scene = useEditorStore((state) => state.scene);
  const loadScene = useEditorStore((state) => state.loadScene);

  const [session, setSession] = useState<AgentSessionRecord | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of conversation
  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Initialize or fetch active session on first drawer open
  useEffect(() => {
    if (!isOpen || session) return;

    let isSubscribed = true;
    void Promise.resolve().then(async () => {
      try {
        const sess = await createAgentSession('AI Interior Design Assistant');
        if (!isSubscribed) return;
        setSession(sess);
        setMessages([
          {
            id: 'welcome',
            sender: 'assistant',
            text: "Hello! I am your AI Interior Design Assistant. Tell me how you'd like to style or arrange your room (e.g., 'Add a cozy armchair', 'Change sofa color to navy', or 'Place a workstation'). Every proposal will be previewed with budget diffs for your explicit approval before modifying the 3D scene.",
            timestamp: getFormattedTime(),
          },
        ]);
      } catch (err: any) {
        if (!isSubscribed) return;
        setErrorMsg(err.message || 'Failed to initialize AI session.');
      }
    });

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, session]);

  const handleSubmitPrompt = useCallback(async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || !session || isLoading) return;

    setErrorMsg(null);
    setInputText('');

    const userMsgId = generateMessageId('user');
    const userMsg: MessageItem = {
      id: userMsgId,
      sender: 'user',
      text: trimmed,
      timestamp: getFormattedTime(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const response = await sendAgentPrompt(session.id, trimmed, scene);
      const assistantMsg: MessageItem = {
        id: response.run.id,
        sender: 'assistant',
        text: response.run.ai_response_text || 'Here is my proposed design modification:',
        timestamp: getFormattedTime(),
        run: response.run,
        candidateScene: response.candidate_scene,
        budgetDiff: response.budget_diff,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Telemetry: record AI proposal multi-tier validity & explicit room-containment violations
      const budgetDiff = response.budget_diff || response.run?.validation_results?.budget_diff;
      const hasErrors = Boolean(response.run?.validation_results?.errors && response.run.validation_results.errors.length > 0);
      const isSchemaValid = Boolean(response.candidate_scene && !hasErrors);

      // Explicit room containment check from AI evaluation
      const hasExplicitViolations = Array.isArray(budgetDiff?.room_violations) && budgetDiff.room_violations.length > 0;
      const isExplicitContainmentInvalid = budgetDiff?.room_containment_valid === false;
      const hasOutOfBoundsInCandidate = Boolean(response.candidate_scene && checkSceneHasOutOfBounds(response.candidate_scene));

      // Unit of counting: exactly one boundary violation attempt is counted if the proposal violates room containment
      const hasOutOfBoundsViolation = Boolean(
        response.candidate_scene && (isExplicitContainmentInvalid || hasExplicitViolations || hasOutOfBoundsInCandidate)
      );

      const isDomainValid = Boolean(
        response.candidate_scene &&
        response.run?.validation_results?.is_valid &&
        !hasOutOfBoundsViolation
      );

      recordAgentProposal({
        accepted: false,
        tier1Success: true,
        tier2Valid: isSchemaValid,
        tier3Valid: isDomainValid,
        hasOutOfBoundsViolation,
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'Error communicating with AI assistant.');
      recordAgentProposal({
        accepted: false,
        tier1Success: false,
        tier2Valid: false,
        tier3Valid: false,
        hasOutOfBoundsViolation: false,
      });
    } finally {
      setIsLoading(false);
    }
  }, [session, isLoading, scene]);

  const handleApplyProposal = useCallback(async (msg: MessageItem) => {
    if (!msg.run || msg.run.status !== 'proposed') return;

    const targetRunId = msg.run.id;
    setActionInProgressId(targetRunId);
    setErrorMsg(null);

    try {
      const appliedResult = await applyAgentRun(targetRunId, scene);
      
      // Update editor 3D store
      loadScene(appliedResult.applied_scene);
      if (onSceneApplied) {
        onSceneApplied(appliedResult.applied_scene);
      }

      // Telemetry: record accepted proposal
      recordAgentAcceptance();

      // Update message run status
      setMessages((prev) =>
        prev.map((m) =>
          m.run && m.run.id === targetRunId
            ? { ...m, run: { ...m.run, status: 'approved' } }
            : m
        )
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to apply design proposal.');
    } finally {
      setActionInProgressId(null);
    }
  }, [scene, loadScene, onSceneApplied]);

  const handleRejectProposal = useCallback(async (msg: MessageItem) => {
    if (!msg.run || msg.run.status !== 'proposed') return;

    const targetRunId = msg.run.id;
    setActionInProgressId(targetRunId);
    setErrorMsg(null);

    try {
      await rejectAgentRun(targetRunId);

      // Update message run status
      setMessages((prev) =>
        prev.map((m) =>
          m.run && m.run.id === targetRunId
            ? { ...m, run: { ...m.run, status: 'rejected' } }
            : m
        )
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reject proposal.');
    } finally {
      setActionInProgressId(null);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-slate-900/95 backdrop-blur-2xl border-l border-slate-800 shadow-2xl flex flex-col transition-all duration-300 ease-out">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm text-white tracking-tight">AI Design Assistant</h2>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Phase 4
              </span>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              gemini-3.8-flash &bull; 2-Phase Approval
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Close AI Assistant"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="px-4 py-2.5 bg-rose-950/80 border-b border-rose-800/80 text-rose-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="line-clamp-2">{errorMsg}</span>
          </div>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-rose-400 hover:text-white p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Messages Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            {/* Sender Bubble */}
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm shadow-md'
                  : 'bg-slate-800/90 text-slate-200 border border-slate-700/80 rounded-bl-sm shadow-sm'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.text}</p>
            </div>

            {/* Structured Proposal Preview Card if present */}
            {msg.run && (
              <div className="mt-3 w-full bg-slate-950/80 border border-indigo-500/30 rounded-xl p-3.5 space-y-3 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-xs font-semibold text-white">Proposed Modifications</span>
                  </div>
                  {msg.run.status === 'proposed' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
                      Approval Required
                    </span>
                  )}
                  {msg.run.status === 'approved' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Approved
                    </span>
                  )}
                  {msg.run.status === 'rejected' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400 border border-slate-700 flex items-center gap-1">
                      <X className="w-3 h-3" /> Discarded
                    </span>
                  )}
                </div>

                {/* Actions List */}
                <div className="space-y-1.5">
                  {msg.run.proposed_actions.map((act: ProposedAction, idx: number) => (
                    <div
                      key={idx}
                      className="bg-slate-900/90 border border-slate-800 rounded-lg p-2 text-[11px] flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        {act.name === 'add_furniture' && <PlusCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        {act.name === 'set_material' && <Palette className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
                        {act.name === 'clear_room' && <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                        {act.name !== 'add_furniture' && act.name !== 'set_material' && act.name !== 'clear_room' && (
                          <RefreshCw className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        )}
                        <span className="font-mono text-indigo-300 font-medium shrink-0">{act.name}</span>
                        <span className="text-slate-400 truncate">
                          {act.parameters?.asset_id || act.parameters?.color || act.parameters?.target_id || ''}
                        </span>
                      </div>
                      {Array.isArray(act.parameters?.position) && (
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                          [{act.parameters.position.map((n: number) => n.toFixed(1)).join(', ')}]
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Authoritative Budget Diff */}
                {msg.budgetDiff && (() => {
                  const beforePaise = msg.budgetDiff.before_total_paise ?? msg.budgetDiff.before_paise ?? 0;
                  const afterPaise = msg.budgetDiff.after_total_paise ?? msg.budgetDiff.after_paise ?? 0;
                  const diffPaise = msg.budgetDiff.diff_paise ?? (afterPaise - beforePaise);
                  return (
                    <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                        <Coins className="w-3.5 h-3.5 text-amber-400" />
                        <span>Budget Impact:</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-slate-400 line-through text-[11px]">
                          ₹{(beforePaise / 100).toLocaleString('en-IN')}
                        </span>
                        <span className="text-white font-bold">
                          ₹{(afterPaise / 100).toLocaleString('en-IN')}
                        </span>
                        <span
                          className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                            diffPaise > 0
                              ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                              : diffPaise < 0
                              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                              : 'text-slate-400'
                          }`}
                        >
                          {diffPaise > 0 ? '+' : ''}₹
                          {(diffPaise / 100).toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Validation Warnings/Errors */}
                {msg.run.validation_results?.warnings?.length > 0 && (
                  <div className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-900/50 rounded p-1.5">
                    {msg.run.validation_results.warnings.join('; ')}
                  </div>
                )}

                {/* 2-Phase Approval Controls */}
                {msg.run.status === 'proposed' && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleApplyProposal(msg)}
                      disabled={actionInProgressId === msg.run.id}
                      className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-md shadow-emerald-600/20 disabled:opacity-50"
                    >
                      {actionInProgressId === msg.run.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Approve &amp; Apply to 3D Scene</span>
                    </button>
                    <button
                      onClick={() => handleRejectProposal(msg)}
                      disabled={actionInProgressId === msg.run.id}
                      className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-300 font-medium text-xs border border-slate-700 transition active:scale-95 disabled:opacity-50"
                    >
                      Discard
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-slate-400 text-xs py-2">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            <span>AI is designing and validating room layout...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="px-4 py-2 border-t border-slate-800/80 bg-slate-950/40">
        <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider block mb-1.5">
          Suggested Prompts:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSubmitPrompt(prompt)}
              disabled={isLoading}
              className="text-[11px] text-slate-300 hover:text-white bg-slate-800/80 hover:bg-indigo-900/40 border border-slate-700/80 hover:border-indigo-500/40 px-2 py-1 rounded-md transition text-left truncate max-w-full disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Prompt Input Form */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/80">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmitPrompt(inputText);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isLoading}
            placeholder="Type design instruction (e.g., 'Add a sofa and desk')..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !inputText.trim()}
            className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition active:scale-95 disabled:opacity-40 disabled:hover:bg-indigo-600"
            title="Send prompt to AI Assistant"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
