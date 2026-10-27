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
  Info,
  Check,
  ClipboardCopy,
  FileText,
  Sparkles,
} from 'lucide-react';
import {
  getActiveSession,
  getPendingSession,
  clearPendingSession,
  saveActiveSession,
  clearActiveSession,
  attachActivityListeners,
  startEvaluationSession,
  sendEvaluationCheckpoint,
  completeEvaluationSession,
  abortEvaluationSession,
  generateSessionUUID,
  generateSecureSecret,
  type ActiveEvaluationSession,
  type PendingEvaluationSession,
  type EvaluationCondition,
  type EvaluationSequence,
  type EvaluationTask,
  type ExperimentSessionRecord,
  type AbortReason,
} from '../../services/evaluationTelemetry';
import {
  SUS_QUESTIONS,
  calculateSusScore,
  validateSusResponses,
  type SusScoreResult,
} from '../../services/susScoring';
import { useEditorStore } from '../../editor3d/store/editorStore';
import type { CanonicalScene } from '../../types/scene';

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
  const initialPending = getPendingSession();
  const [activeSession, setActiveSessionState] = useState<ActiveEvaluationSession | null>(() => getActiveSession());
  const [pendingSession, setPendingSessionState] = useState<PendingEvaluationSession | null>(initialPending);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [participantId, setParticipantId] = useState(initialPending?.participantId || 'P01');
  const [sequenceOrder, setSequenceOrder] = useState<EvaluationSequence>(initialPending?.sequenceOrder || 'G1');
  const [condition, setCondition] = useState<EvaluationCondition>(initialPending?.condition || 'manual');
  const [taskName, setTaskName] = useState<EvaluationTask>(initialPending?.taskName || 'living_room');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<ExperimentSessionRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [abortReason, setAbortReason] = useState<AbortReason>('user_cancelled');
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);

  // Developer Dry Run & Survey States
  const [isDryRun, setIsDryRun] = useState(true);
  const [isSurveyStep, setIsSurveyStep] = useState(false);
  const [pendingScene, setPendingScene] = useState<CanonicalScene | null>(null);
  const [susResponses, setSusResponses] = useState<Record<number, number>>({});
  const [susValidationErrors, setSusValidationErrors] = useState<string | null>(null);
  const [computedSus, setComputedSus] = useState<SusScoreResult | null>(null);
  const [showRecordJson, setShowRecordJson] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // Sync active and pending session state when modal opens
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      const active = getActiveSession();
      const pending = getPendingSession();
      setActiveSessionState(active);
      setPendingSessionState(pending);
      if (pending && !active) {
        setParticipantId(pending.participantId);
        setSequenceOrder(pending.sequenceOrder);
        setCondition(pending.condition);
        setTaskName(pending.taskName);
      }
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

  const handleRetryPending = async () => {
    if (!pendingSession) return;
    setErrorMsg(null);
    try {
      setIsSubmitting(true);
      await startEvaluationSession({
        sessionId: pendingSession.sessionId,
        sessionSecret: pendingSession.sessionSecret,
        participantId: pendingSession.participantId,
        condition: pendingSession.condition,
        sequenceOrder: pendingSession.sequenceOrder,
        taskName: pendingSession.taskName,
        trialPeriod: pendingSession.trialPeriod,
      });

      if (pendingSession.taskName === 'living_room') {
        useEditorStore.getState().setRoomDimensions({ width: 5.0, length: 4.0, height: 2.8 });
      } else {
        useEditorStore.getState().setRoomDimensions({ width: 4.5, length: 3.5, height: 2.8 });
      }

      const active = getActiveSession();
      setActiveSessionState(active);
      setPendingSessionState(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDiscardPending = () => {
    clearPendingSession();
    setPendingSessionState(null);
    setErrorMsg(null);
  };

  const handleStart = async () => {
    setErrorMsg(null);
    if (!derivedPeriod) {
      setErrorMsg(`Invalid assignment: Group ${sequenceOrder} requires either Period 1 (${seqMap.P1[0]} + ${seqMap.P1[1]}) or Period 2 (${seqMap.P2[0]} + ${seqMap.P2[1]}).`);
      return;
    }

    try {
      setIsSubmitting(true);

      if (isDryRun) {
        // Developer Dry Run: Local simulation with synthetic identifiers without hitting backend
        const syntheticSession: ActiveEvaluationSession = {
          sessionId: generateSessionUUID(),
          sessionSecret: generateSecureSecret(),
          participantId: participantId.trim(),
          condition,
          sequenceOrder,
          taskName,
          trialPeriod: derivedPeriod,
          startTime: new Date().toISOString(),
          checkpointSequence: 0,
          totalEdits: 0,
          undoRedoCount: 0,
          attemptedOutOfBoundsCount: 0,
          agentProposalsCount: 0,
          agentAcceptedCount: 0,
          agentTier1SuccessCount: 0,
          agentTier2SchemaValidCount: 0,
          agentTier3DomainValidCount: 0,
          idleIntervals: [],
        };
        saveActiveSession(syntheticSession);
        attachActivityListeners();
        setActiveSessionState(syntheticSession);
        setPendingSessionState(null);
      } else {
        const isMatchingPending = pendingSession &&
          pendingSession.participantId === participantId.trim() &&
          pendingSession.condition === condition &&
          pendingSession.sequenceOrder === sequenceOrder &&
          pendingSession.taskName === taskName;

        await startEvaluationSession({
          sessionId: isMatchingPending ? pendingSession.sessionId : undefined,
          sessionSecret: isMatchingPending ? pendingSession.sessionSecret : undefined,
          participantId: participantId.trim(),
          condition,
          sequenceOrder,
          taskName,
          trialPeriod: derivedPeriod,
        });

        const active = getActiveSession();
        setActiveSessionState(active);
        setPendingSessionState(null);
      }

      // Standardize room template for selected task
      if (taskName === 'living_room') {
        useEditorStore.getState().setRoomDimensions({ width: 5.0, length: 4.0, height: 2.8 });
      } else {
        useEditorStore.getState().setRoomDimensions({ width: 4.5, length: 3.5, height: 2.8 });
      }
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
      if (isDryRun) {
        const cur = getActiveSession();
        if (cur) {
          cur.checkpointSequence += 1;
          saveActiveSession(cur);
          setActiveSessionState({ ...cur });
        }
      } else {
        const res = await sendEvaluationCheckpoint(scene);
        if (res) {
          setActiveSessionState(getActiveSession());
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 1 of completion: Advance to SUS survey questionnaire
  const handleInitiateComplete = () => {
    setErrorMsg(null);
    setSusValidationErrors(null);
    const scene = useEditorStore.getState().scene;
    setPendingScene(scene);
    setIsSurveyStep(true);
  };

  // Quick fill sample SUS responses for fast developer dry-run testing
  const handleFillSampleSurvey = () => {
    const sample: Record<number, number> = {
      1: 5, 2: 1, 3: 4, 4: 2, 5: 5,
      6: 1, 7: 5, 8: 2, 9: 4, 10: 1,
    };
    setSusResponses(sample);
    setSusValidationErrors(null);
  };

  // Step 2 of completion: Validate SUS responses and submit final design + survey
  const handleSubmitSurveyAndComplete = async () => {
    setSusValidationErrors(null);
    const validation = validateSusResponses(susResponses);
    if (!validation.isValid) {
      setSusValidationErrors(validation.errorMessage || 'Please answer all 10 questions to continue.');
      return;
    }

    let calculated: SusScoreResult;
    try {
      calculated = calculateSusScore(susResponses);
      setComputedSus(calculated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSusValidationErrors(msg);
      return;
    }

    try {
      setIsSubmitting(true);
      const scene = pendingScene || useEditorStore.getState().scene;

      if (isDryRun) {
        // Developer Dry Run: Generate synthetic completed record locally
        const cur = getActiveSession();
        const durationSec = cur ? Math.round((Date.now() - new Date(cur.startTime).getTime()) / 100) / 10 : 120.0;
        const syntheticRecord: ExperimentSessionRecord = {
          schemaVersion: 1,
          sessionId: cur?.sessionId || generateSessionUUID(),
          participantId: cur?.participantId || participantId.trim(),
          condition: cur?.condition || condition,
          sequenceOrder: cur?.sequenceOrder || sequenceOrder,
          taskName: cur?.taskName || taskName,
          trialPeriod: cur?.trialPeriod || derivedPeriod || 1,
          sessionStatus: 'completed',
          checkpointSequence: (cur?.checkpointSequence || 0) + 1,
          startTime: cur?.startTime || new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationSeconds: durationSec,
          activeDurationSeconds: Math.max(0, durationSec - 15.0),
          abortedAt: null,
          abortReason: null,
          idleIntervals: cur?.idleIntervals || [],
          totalIdleDurationSeconds: 15.0,
          maxSingleIdleGapSeconds: 15.0,
          hasProlongedInterruption: false,
          budgetTotalPaise: 4500000,
          budgetCeilingPaise: taskName === 'living_room' ? 6000000 : 4000000,
          isBudgetCompliant: true,
          attemptedOutOfBoundsCount: cur?.attemptedOutOfBoundsCount || 0,
          finalSceneOutOfBoundsCount: 0,
          aabbOverlapPairsCount: 0,
          doorwayIntrusionsCount: 0,
          isTaskSuccessful: true,
          totalEdits: cur?.totalEdits || 5,
          undoRedoCount: cur?.undoRedoCount || 0,
          agentProposalsCount: cur?.agentProposalsCount || 0,
          agentAcceptedCount: cur?.agentAcceptedCount || 0,
          agentTier1SuccessCount: cur?.agentTier1SuccessCount || 0,
          agentTier2SchemaValidCount: cur?.agentTier2SchemaValidCount || 0,
          agentTier3DomainValidCount: cur?.agentTier3DomainValidCount || 0,
          checkpointSceneSnapshot: scene,
          finalSceneSnapshot: scene,
          susScore: calculated.score,
          susResponses: calculated.normalizedResponses,
        };

        clearActiveSession();
        clearPendingSession();
        setSuccessResult(syntheticRecord);
        setActiveSessionState(null);
        setIsSurveyStep(false);
      } else {
        const record = await completeEvaluationSession(scene, susResponses);
        setSuccessResult(record);
        setActiveSessionState(null);
        setIsSurveyStep(false);
      }
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
      if (isDryRun) {
        clearActiveSession();
        clearPendingSession();
        setActiveSessionState(null);
        setShowAbortConfirm(false);
      } else {
        await abortEvaluationSession(abortReason);
        setActiveSessionState(null);
        setShowAbortConfirm(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyJson = async () => {
    if (!successResult) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(successResult, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Evaluation Protocol & Telemetry
                </h2>
                {isDryRun && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 border border-amber-700 text-amber-300 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Developer Dry Run
                  </span>
                )}
              </div>
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

          {/* State 1: Post-Trial SUS Survey Step */}
          {isSurveyStep ? (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-950/40 border border-indigo-700/50 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-indigo-400 text-sm">
                    <FileText className="w-4 h-4" />
                    System Usability Scale (SUS) Survey
                  </div>
                  <button
                    onClick={handleFillSampleSurvey}
                    className="px-2.5 py-1 rounded-lg bg-indigo-900/60 hover:bg-indigo-800/80 border border-indigo-700 text-indigo-200 text-[11px] font-semibold transition"
                    title="Fill synthetic responses for fast dry-run verification"
                  >
                    Fill Sample Responses
                  </button>
                </div>
                <p className="text-xs text-slate-300">
                  Standard 10-item questionnaire (Brooke, 1996). Please rate your agreement with each statement from <strong>1 (Strongly Disagree)</strong> to <strong>5 (Strongly Agree)</strong>.
                </p>
              </div>

              {susValidationErrors && (
                <div className="p-3 bg-red-950/60 border border-red-700/60 rounded-xl text-red-200 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{susValidationErrors}</span>
                </div>
              )}

              <div className="space-y-3 max-h-[46vh] overflow-y-auto pr-1">
                {SUS_QUESTIONS.map((questionText, idx) => {
                  const qNum = idx + 1;
                  const currentVal = susResponses[qNum];
                  return (
                    <div
                      key={qNum}
                      className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2"
                    >
                      <div className="text-xs font-medium text-slate-200">
                        <span className="font-bold text-indigo-400 mr-1.5">{qNum}.</span>
                        {questionText}
                      </div>
                      <div className="flex items-center justify-between gap-1 pt-1">
                        <span className="text-[10px] text-slate-500 w-20">Strongly Disagree</span>
                        <div className="flex items-center gap-3">
                          {[1, 2, 3, 4, 5].map((val) => (
                            <label
                              key={val}
                              className={`flex flex-col items-center gap-1 cursor-pointer px-2 py-1 rounded-lg border text-xs font-semibold transition ${
                                currentVal === val
                                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/30'
                                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`sus-q-${qNum}`}
                                value={val}
                                checked={currentVal === val}
                                onChange={() => {
                                  setSusResponses((prev) => ({ ...prev, [qNum]: val }));
                                  setSusValidationErrors(null);
                                }}
                                className="sr-only"
                              />
                              <span>{val}</span>
                            </label>
                          ))}
                        </div>
                        <span className="text-[10px] text-slate-500 w-20 text-right">Strongly Agree</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <button
                  onClick={() => setIsSurveyStep(false)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
                >
                  Back to Trial
                </button>
                <button
                  onClick={handleSubmitSurveyAndComplete}
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/20 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isSubmitting ? 'Evaluating...' : 'Validate & Submit Usability Survey'}
                </button>
              </div>
            </div>
          ) : successResult ? (
            /* State 2: Final Evaluated Summary */
            <div className="space-y-4">
              <div className="p-4 bg-emerald-950/40 border border-emerald-700/60 rounded-xl text-emerald-200 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm">
                    <CheckCircle2 className="w-5 h-5" />
                    Trial Successfully Evaluated & Recorded
                  </div>
                  {isDryRun && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 border border-amber-700 text-amber-300">
                      Dry Run Synthetic Record
                    </span>
                  )}
                </div>
                <p>
                  Authoritative spatial constraints, budget metrics, and standardized System Usability Scale (SUS) scores have been verified.
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
                  <div>
                    <span className="text-slate-400">Active Duration: </span>
                    <strong>{successResult.activeDurationSeconds}s</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">SUS Usability Score: </span>
                    <strong className="text-indigo-400">
                      {computedSus ? `${computedSus.score} / 100 (Grade ${computedSus.grade} — ${computedSus.description})` : (successResult.susScore !== undefined && successResult.susScore !== null ? `${successResult.susScore} / 100` : 'Verified')}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Expandable JSON Record Export Inspection */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowRecordJson(!showRecordJson)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white transition"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-400" />
                    Inspect Export Record (JSON Schema)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {showRecordJson ? 'Hide' : 'Expand'}
                  </span>
                </button>
                {showRecordJson && (
                  <div className="p-3 pt-0 border-t border-slate-800/80 space-y-2">
                    <pre className="text-[11px] font-mono text-slate-300 bg-slate-900/90 p-3 rounded-lg overflow-x-auto max-h-48">
                      {JSON.stringify(successResult, null, 2)}
                    </pre>
                    <div className="flex justify-end">
                      <button
                        onClick={handleCopyJson}
                        className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        {copiedJson ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <ClipboardCopy className="w-3.5 h-3.5" />
                            Copy Record JSON
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => {
                    setSuccessResult(null);
                    setComputedSus(null);
                    onClose();
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition"
                >
                  Close Summary
                </button>
              </div>
            </div>
          ) : activeSession ? (
            /* State 3: Active Trial in Progress */
            <div className="space-y-4">
              <div className="p-4 bg-indigo-950/40 border border-indigo-700/50 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                    Active Study Trial
                  </span>
                  <div className="flex items-center gap-2">
                    {isDryRun && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 border border-amber-700 text-amber-300">
                        Dry Run
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 border border-emerald-700 text-emerald-300">
                      In Progress
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 pt-1">
                  <div>Participant: <strong>{activeSession.participantId}</strong></div>
                  <div>Group: <strong>{activeSession.sequenceOrder}</strong> (Period {activeSession.trialPeriod})</div>
                  <div>Condition: <strong className="capitalize">{activeSession.condition.replace('_', ' ')}</strong></div>
                  <div>Task: <strong className="capitalize">{activeSession.taskName.replace('_', ' ')}</strong></div>
                  <div>Checkpoints: <strong>{activeSession.checkpointSequence}</strong></div>
                  <div>Recorded Edits: <strong>{activeSession.totalEdits}</strong></div>
                  <div>Boundary Violations: <strong>{activeSession.attemptedOutOfBoundsCount}</strong></div>
                  <div>Undo/Redo Actions: <strong>{activeSession.undoRedoCount}</strong></div>
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
                    onClick={handleInitiateComplete}
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/20 inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Submit Design (Complete)
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* State 4: Configure and Start Trial */
            <div className="space-y-4">
              {pendingSession && (
                <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-amber-400 text-sm">
                      <RotateCcw className="w-4 h-4 text-amber-400" />
                      Pending / Lost Start Session Detected
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-900/60 border border-amber-600 text-amber-300">
                      Unconfirmed
                    </span>
                  </div>
                  <p className="text-amber-200/90 leading-relaxed">
                    A previous trial start request for Participant <strong>{pendingSession.participantId}</strong> ({pendingSession.sequenceOrder}, {pendingSession.condition.replace('_', ' ')}, {pendingSession.taskName.replace('_', ' ')}) was initiated, but the server response was interrupted or the page reloaded. You can retry with the preserved credentials or discard to start fresh.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleRetryPending}
                      disabled={isSubmitting}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center gap-1.5 transition disabled:opacity-50 shadow-md shadow-amber-600/20"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {isSubmitting ? 'Retrying...' : 'Retry / Resume Session'}
                    </button>
                    <button
                      onClick={handleDiscardPending}
                      disabled={isSubmitting}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition disabled:opacity-50"
                    >
                      Discard Pending
                    </button>
                  </div>
                </div>
              )}

              {/* Developer Dry Run Mode Toggle */}
              <div className="p-3 bg-slate-950/80 border border-indigo-900/50 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <div>
                    <div className="text-xs font-bold text-white">Developer Dry Run Mode</div>
                    <div className="text-[11px] text-slate-400">
                      Local simulation with synthetic metrics (telemetry remains disabled by default).
                    </div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDryRun}
                    onChange={(e) => setIsDryRun(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-400 flex items-start gap-2">
                <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <span>
                  Configure participant assignment according to the pre-registered 4-sequence crossover protocol.
                  {isDryRun
                    ? ' Dry Run active: runs client-side with synthetic metrics and SUS validation.'
                    : ' Live mode requires ENABLE_EVALUATION_TELEMETRY=True on the backend.'}
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
                  {isSubmitting
                    ? 'Starting...'
                    : isDryRun
                    ? 'Start Developer Dry Run'
                    : pendingSession
                    ? 'Retry / Start Evaluation Trial'
                    : 'Start Evaluation Trial'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
