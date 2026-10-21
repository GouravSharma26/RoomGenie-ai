import React, { useState } from 'react';
import {
  X,
  Play,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Layers,
  Save,
  Send,
  ShieldAlert,
  Info
} from 'lucide-react';
import {
  getActiveSession,
  startEvaluationSession,
  sendEvaluationCheckpoint,
  completeEvaluationSession,
  abortEvaluationSession,
  type ActiveEvaluationSession,
  type EvaluationCondition,
  type EvaluationSequence,
  type EvaluationTask,
  type ExperimentSessionRecord,
  type AbortReason,
} from '../../services/evaluationTelemetry';
import { useEditorStore } from '../../editor3d/store/editorStore';

interface EvaluationTrialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SEQUENCE_MAPPINGS: Record<EvaluationSequence, { P1: [EvaluationCondition, EvaluationTask]; P2: [EvaluationCondition, EvaluationTask] }> = {
  G1: { P1: ['manual', 'living_room'], P2: ['ai_assisted', 'home_study'] },
  G2: { P1: ['ai_assisted', 'living_room'], P2: ['manual', 'home_study'] },
  G3: { P1: ['manual', 'home_study'], P2: ['ai_assisted', 'living_room'] },
  G4: { P1: ['ai_assisted', 'home_study'], P2: ['manual', 'living_room'] },
};

export const EvaluationTrialModal: React.FC<EvaluationTrialModalProps> = ({ isOpen, onClose }) => {
  const [activeSession, setActiveSessionState] = useState<ActiveEvaluationSession | null>(() => getActiveSession());
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [participantId, setParticipantId] = useState('P01');
  const [sequenceOrder, setSequenceOrder] = useState<EvaluationSequence>('G1');
  const [condition, setCondition] = useState<EvaluationCondition>('manual');
  const [taskName, setTaskName] = useState<EvaluationTask>('living_room');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<ExperimentSessionRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [abortReason, setAbortReason] = useState<AbortReason>('user_cancelled');
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);

  // Sync active session state when modal opens
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setActiveSessionState(getActiveSession());
      setErrorMsg(null);
    }
  }

  if (!isOpen) return null;

  // Derive expected trial period from 4-sequence counterbalance schedule
  let derivedPeriod: 1 | 2 | null = null;
  const seqMap = SEQUENCE_MAPPINGS[sequenceOrder];
  if (seqMap.P1[0] === condition && seqMap.P1[1] === taskName) {
    derivedPeriod = 1;
  } else if (seqMap.P2[0] === condition && seqMap.P2[1] === taskName) {
    derivedPeriod = 2;
  }

  const handleStart = async () => {
    setErrorMsg(null);
    if (!derivedPeriod) {
      setErrorMsg(`Invalid assignment: Group ${sequenceOrder} requires either Period 1 (${seqMap.P1[0]} + ${seqMap.P1[1]}) or Period 2 (${seqMap.P2[0]} + ${seqMap.P2[1]}).`);
      return;
    }

    try {
      setIsSubmitting(true);
      await startEvaluationSession({
        participantId: participantId.trim(),
        condition,
        sequenceOrder,
        taskName,
        trialPeriod: derivedPeriod,
      });

      // Standardize room template for selected task
      if (taskName === 'living_room') {
        useEditorStore.getState().setRoomDimensions({ width: 5.0, length: 4.0, height: 2.8 });
      } else {
        useEditorStore.getState().setRoomDimensions({ width: 4.5, length: 3.5, height: 2.8 });
      }

      const active = getActiveSession();
      setActiveSessionState(active);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualCheckpoint = async () => {
    try {
      setIsSubmitting(true);
      const scene = useEditorStore.getState().scene;
      const res = await sendEvaluationCheckpoint(scene);
      if (res) {
        setActiveSessionState(getActiveSession());
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleComplete = async () => {
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      const scene = useEditorStore.getState().scene;
      const record = await completeEvaluationSession(scene);
      setSuccessResult(record);
      setActiveSessionState(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAbort = async () => {
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await abortEvaluationSession(abortReason);
      setActiveSessionState(null);
      setShowAbortConfirm(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Evaluation Protocol & Telemetry
              </h2>
              <p className="text-xs text-slate-400">
                Phase 8 Research Trial Lifecycle & Metric Audit
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {errorMsg && (
            <div className="p-3 bg-red-950/60 border border-red-700/60 rounded-xl text-red-200 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successResult ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-950/40 border border-emerald-700/60 rounded-xl text-emerald-200 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  Trial Successfully Submitted & Evaluated
                </div>
                <p>
                  Authoritative metrics have been calculated server-side and recorded to the evaluation dataset.
                </p>
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-emerald-800/40 text-slate-300">
                  <div>
                    <span className="text-slate-400">Task Success (H04): </span>
                    <strong className={successResult.isTaskSuccessful ? 'text-emerald-400' : 'text-amber-400'}>
                      {successResult.isTaskSuccessful ? 'Pass' : 'Fail'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Budget Compliant (H03): </span>
                    <strong className={successResult.isBudgetCompliant ? 'text-emerald-400' : 'text-amber-400'}>
                      {successResult.isBudgetCompliant ? 'Pass' : 'Fail'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Doorway Clearance: </span>
                    <strong className={successResult.doorwayIntrusionsCount === 0 ? 'text-emerald-400' : 'text-amber-400'}>
                      {successResult.doorwayIntrusionsCount ?? 0} intrusions
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Total Edits (E2): </span>
                    <strong>{successResult.totalEdits}</strong>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => {
                    setSuccessResult(null);
                    onClose();
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition"
                >
                  Close Summary
                </button>
              </div>
            </div>
          ) : activeSession ? (
            /* Active Trial State */
            <div className="space-y-4">
              <div className="p-4 bg-indigo-950/40 border border-indigo-700/50 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                    Active Study Trial
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 border border-emerald-700 text-emerald-300">
                    In Progress
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 pt-1">
                  <div>Participant: <strong>{activeSession.participantId}</strong></div>
                  <div>Group: <strong>{activeSession.sequenceOrder}</strong> (Period {activeSession.trialPeriod})</div>
                  <div>Condition: <strong className="capitalize">{activeSession.condition.replace('_', ' ')}</strong></div>
                  <div>Task: <strong className="capitalize">{activeSession.taskName.replace('_', ' ')}</strong></div>
                  <div>Checkpoints: <strong>{activeSession.checkpointSequence}</strong></div>
                  <div>Recorded Edits: <strong>{activeSession.totalEdits}</strong></div>
                </div>
              </div>

              {showAbortConfirm ? (
                <div className="p-4 bg-amber-950/40 border border-amber-700/60 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    Confirm Trial Abort / Withdrawal
                  </div>
                  <p className="text-xs text-slate-300">
                    Aborting will lock this trial session and record the last checkpoint snapshot for dropout analysis.
                  </p>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Reason for aborting:</label>
                    <select
                      value={abortReason}
                      onChange={(e) => setAbortReason(e.target.value as AbortReason)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="user_cancelled">Participant Voluntarily Withdrawn</option>
                      <option value="browser_closed">Technical Interruption / Reload</option>
                      <option value="inactivity_timeout">Inactivity Timeout</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setShowAbortConfirm(false)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleAbort}
                      disabled={isSubmitting}
                      className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition disabled:opacity-50"
                    >
                      {isSubmitting ? 'Aborting...' : 'Confirm Abort'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex gap-2">
                    <button
                      onClick={handleManualCheckpoint}
                      disabled={isSubmitting}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save Checkpoint
                    </button>
                    <button
                      onClick={() => setShowAbortConfirm(true)}
                      disabled={isSubmitting}
                      className="px-3 py-2 bg-slate-800 hover:bg-red-950 hover:text-red-300 border border-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Abort Trial
                    </button>
                  </div>

                  <button
                    onClick={handleComplete}
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/20 inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {isSubmitting ? 'Submitting...' : 'Submit Design (Complete)'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Configure and Start Trial */
            <div className="space-y-4">
              <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-400 flex items-start gap-2">
                <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <span>
                  Configure participant assignment according to the pre-registered 4-sequence crossover protocol. Telemetry requires <code>ENABLE_EVALUATION_TELEMETRY=True</code> on the backend.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Participant Code
                  </label>
                  <input
                    type="text"
                    value={participantId}
                    onChange={(e) => setParticipantId(e.target.value)}
                    placeholder="e.g. P01"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Sequence Group
                  </label>
                  <select
                    value={sequenceOrder}
                    onChange={(e) => setSequenceOrder(e.target.value as EvaluationSequence)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
                  >
                    <option value="G1">G1: P1=(Manual, Living) / P2=(AI, Study)</option>
                    <option value="G2">G2: P1=(AI, Living) / P2=(Manual, Study)</option>
                    <option value="G3">G3: P1=(Manual, Study) / P2=(AI, Living)</option>
                    <option value="G4">G4: P1=(AI, Study) / P2=(Manual, Living)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Workflow Condition
                  </label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as EvaluationCondition)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
                  >
                    <option value="manual">Condition A: Manual Design</option>
                    <option value="ai_assisted">Condition B: AI-Assisted Design</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Design Task
                  </label>
                  <select
                    value={taskName}
                    onChange={(e) => setTaskName(e.target.value as EvaluationTask)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
                  >
                    <option value="living_room">Task 1: Living Room (5.0m x 4.0m)</option>
                    <option value="home_study">Task 2: Home Study (4.5m x 3.5m)</option>
                  </select>
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                <span className="text-slate-400">Crossover Period:</span>
                {derivedPeriod ? (
                  <span className="font-bold text-indigo-400">
                    Period {derivedPeriod} of 2
                  </span>
                ) : (
                  <span className="font-bold text-red-400">
                    Non-matching sequence combination
                  </span>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStart}
                  disabled={!derivedPeriod || isSubmitting || !participantId.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-600/20 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  {isSubmitting ? 'Starting...' : 'Start Evaluation Trial'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
