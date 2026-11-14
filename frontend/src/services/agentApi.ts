import type { CanonicalScene } from '../types/scene';
import type { SpatialContext } from '../spatial/ai/aiSpatialTypes';
import type { DesignPreferences, PreferencesFeedback } from '../types/preferenceTypes';
import { ensureAuthenticated } from './designApi';
import { API_BASE_URL } from './apiConfig';

export interface ProposedAction {
  name:
    | 'add_furniture'
    | 'move_object'
    | 'replace_furniture'
    | 'remove_object'
    | 'set_material'
    | 'clear_room'
    | 'attach_to_socket'
    | 'propose_zone_arrangement'
    | string;
  parameters: Record<string, any>;
}

export interface BudgetDiff {
  before_total_paise?: number;
  after_total_paise?: number;
  before_paise?: number;
  after_paise?: number;
  diff_paise: number;
  before_total_inr?: string;
  after_total_inr?: string;
  diff_inr?: string;
  room_containment_valid?: boolean;
  room_violations?: string[];
}

export interface CandidateScore {
  boundary: number;
  collision: number;
  circulation: number;
  clearance: number;
  utilization: number;
  budget: number;
  overall: number;
  weights: Record<string, number>;
  explanations?: Record<string, string>;
  budget_evaluated?: boolean;
  base_score?: number;
  preference_score?: number;
  final_score?: number;
  lambda_weight?: number;
  preference_dimensions?: Record<string, number>;
  preference_explanations?: Record<string, string>;
  preference_conflicts?: string[];
  unavailable_attributes?: string[];
}

export interface CandidateIssue {
  code: string;
  message: string;
  severity: 'fatal' | 'warning' | 'info';
  object_ids?: string[];
}

export interface OptimizationMetadata {
  version: string;
  iterations: number;
  statesEvaluated?: number;
  durationMs: number;
  repaired: boolean;
  initialValid: boolean;
  finalValid: boolean;
  initialScore: number;
  finalScore: number;
  scoreDelta: number;
  bestBadge?: string | null;
  objectives?: {
    containment: number;
    collision: number;
    circulation: number;
    clearance: number;
    accessibility: number;
    utilization: number;
    preferences: number;
    relationships: number;
  };
  appliedOperators?: string[];
}

export interface LayoutCandidateRecord {
  id: string;
  schema_version: number;
  label: string;
  description: string;
  reasoning_summary: string;
  intent?: string;
  rank?: number;
  proposed_actions: ProposedAction[];
  intended_relationships?: any[];
  candidate_scene: CanonicalScene;
  is_valid: boolean;
  is_approval_eligible: boolean;
  score: CandidateScore;
  validation_feedback: {
    is_valid: boolean;
    is_approval_eligible: boolean;
    has_collisions: boolean;
    has_boundary_breaches: boolean;
    is_budget_compliant: boolean;
    is_room_passable: boolean;
    fatal_errors: CandidateIssue[];
    advisory_warnings: CandidateIssue[];
    errors: string[];
    warnings: string[];
  };
  trade_offs?: string[];
  issues?: CandidateIssue[];
  refinement_attempts?: number;
  source_scene_hash?: string;
  created_at_ms?: number;
  budget_diff?: BudgetDiff;
  optimization_metadata?: OptimizationMetadata;
}

export interface ValidationResults {
  is_valid: boolean;
  schema_valid?: boolean;
  reference_valid?: boolean;
  domain_valid?: boolean;
  budget_valid?: boolean;
  schema_errors?: string[];
  reference_errors?: string[];
  domain_errors?: string[];
  budget_errors?: string[];
  errors: string[];
  warnings: string[];
  budget_diff: BudgetDiff;
  candidates?: LayoutCandidateRecord[];
  candidates_count?: number;
  valid_candidates_count?: number;
  selected_candidate_id?: string;
  source_scene_hash?: string;
}

export interface AgentRunRecord {
  id: string;
  session: string;
  user_prompt: string;
  status: 'proposed' | 'approved' | 'rejected' | 'failed';
  ai_response_text: string;
  proposed_actions: ProposedAction[];
  validation_results: ValidationResults;
  provider_metadata: {
    provider: string;
    model: string;
    latency_ms?: number;
    raw_metadata?: Record<string, any>;
  };
  created_at: string;
}

export interface AgentSessionRecord {
  id: string;
  owner_username: string;
  design: string | null;
  title: string;
  runs?: AgentRunRecord[];
  created_at: string;
  updated_at: string;
}

export interface PromptProposalResponse {
  run: AgentRunRecord;
  candidate_scene: CanonicalScene;
  budget_diff: BudgetDiff;
  candidates?: LayoutCandidateRecord[];
  selected_candidate?: LayoutCandidateRecord;
  source_scene_hash?: string;
  schema_valid?: boolean;
  reference_valid?: boolean;
  domain_valid?: boolean;
  budget_valid?: boolean;
  requires_approval: boolean;
  preferences_feedback?: PreferencesFeedback;
}


export interface ApplyProposalResponse {
  detail: string;
  run: AgentRunRecord;
  applied_scene: CanonicalScene;
  budget_diff: BudgetDiff;
}

function getAuthHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Token ${token}`,
  };
}

export async function listAgentSessions(): Promise<AgentSessionRecord[]> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/sessions/`, {
    method: 'GET',
    headers: getAuthHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Failed to list agent sessions: HTTP ${res.status}`);
  }

  return await res.json();
}

export async function createAgentSession(
  title: string = 'Interior Design Session',
  designId?: string | null
): Promise<AgentSessionRecord> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/sessions/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify({
      title,
      design: designId || null,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create agent session: HTTP ${res.status}`);
  }

  return await res.json();
}

export async function sendAgentPrompt(
  sessionId: string,
  prompt: string,
  sceneJson?: CanonicalScene,
  spatialContext?: SpatialContext,
  candidateCount: number = 3,
  userRequirements?: Record<string, any>,
  preferences?: DesignPreferences
): Promise<PromptProposalResponse> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/sessions/${sessionId}/prompt/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify({
      prompt,
      scene_json: sceneJson,
      spatial_context: spatialContext,
      candidate_count: candidateCount,
      user_requirements: userRequirements,
      preferences,
    }),
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      errorMsg = err.detail || JSON.stringify(err);
    } catch {
      // fallback
    }
    throw new Error(`Agent prompt failed: ${errorMsg}`);
  }

  return await res.json();
}

export async function fetchUserPreferences(): Promise<DesignPreferences> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/preferences/`, {
    headers: getAuthHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch user preferences: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function saveUserPreferences(preferences: Partial<DesignPreferences>): Promise<DesignPreferences> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/preferences/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(preferences),
  });
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      errorMsg = err.detail || JSON.stringify(err);
    } catch {
      // fallback
    }
    throw new Error(`Failed to save preferences: ${errorMsg}`);
  }
  return await res.json();
}

export async function resetUserPreferences(): Promise<{ detail: string; preferences: DesignPreferences }> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/preferences/`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`Failed to reset preferences: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function applyAgentRun(
  runId: string,
  sceneJson?: CanonicalScene,
  candidateId?: string
): Promise<ApplyProposalResponse> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/runs/${runId}/apply/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify({
      scene_json: sceneJson,
      candidate_id: candidateId,
    }),
  });


  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      errorMsg = err.detail || JSON.stringify(err);
    } catch {
      // fallback
    }
    throw new Error(`Failed to apply agent proposal: ${errorMsg}`);
  }

  return await res.json();
}

export async function rejectAgentRun(
  runId: string
): Promise<{ detail: string; run: AgentRunRecord }> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/runs/${runId}/reject/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      errorMsg = err.detail || JSON.stringify(err);
    } catch {
      // fallback
    }
    throw new Error(`Failed to reject agent proposal: ${errorMsg}`);
  }

  return await res.json();
}

export interface CandidateExplanation {
  candidate_id: string;
  label: string;
  headline: string;
  rank_rationale?: string;
  why_recommended: string[];
  key_strengths?: string[];
  key_metrics: {
    boundary_score: number;
    collision_score: number;
    circulation_score: number;
    clearance_score: number;
    utilization_score: number;
    budget_score: number;
    overall_score: number;
    occupied_floor_pct?: number;
    open_floor_m2?: number;
    furniture_count?: number;
    door_clearance_min_m?: number;
    budget_paise?: number;
  };
  factual_metrics?: Record<string, any>;
  alignment_reasons: string[];
  trade_offs: string[];
  spatial_adjustments: string[];
}

export interface CandidateComparisonDetail {
  candidate_a_id: string;
  candidate_b_id: string;
  candidate_a_label: string;
  candidate_b_label: string;
  overall_score_delta: number;
  open_space_delta_m2: number;
  circulation_delta: number;
  position_displacements: Array<{
    object_id: string;
    name: string;
    asset_id: string;
    distance_meters: number;
    yaw_difference_deg: number;
    position_a: [number, number];
    position_b: [number, number];
    description: string;
  }>;
  key_trade_offs: string[];
  recommendation_summary: string;
}

export interface LearnedPreferenceState {
  user_id: number;
  model_version: number;
  feedback_count: number;
  adjusted_weights: Record<string, number>;
  confidence_scores: Record<string, number>;
  explanations: Record<string, string>;
  is_active: boolean;
  last_updated_iso?: string;
}

export interface RefinementResponse {
  is_ambiguous?: boolean;
  ambiguity_reason?: string;
  clarification_prompt?: string;
  refined_candidates: LayoutCandidateRecord[];
  refinement_request: {
    raw_prompt: string;
    intent_category: string;
    target_object_ids: string[];
    protected_object_ids: string[];
    is_ambiguous: boolean;
    ambiguity_reason?: string;
  };
  base_candidate_id: string;
  count: number;
}

export async function submitCandidateFeedback(data: {
  run_id: string;
  candidate_id: string;
  feedback_type: 'liked' | 'disliked' | 'selected' | 'rejected' | 'modified';
  structured_reasons?: string[];
  feedback_text?: string;
}): Promise<any> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/feedback/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      errorMsg = err.detail || JSON.stringify(err);
    } catch {
      // fallback
    }
    throw new Error(`Failed to submit feedback: ${errorMsg}`);
  }
  return await res.json();
}

export async function submitPairwiseComparison(data: {
  run_id: string;
  candidate_a_id: string;
  candidate_b_id: string;
  outcome: 'a_preferred' | 'b_preferred' | 'tie' | 'both_disliked';
  structured_reasons?: string[];
  comparison_text?: string;
}): Promise<any> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/feedback/compare/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      errorMsg = err.detail || JSON.stringify(err);
    } catch {
      // fallback
    }
    throw new Error(`Failed to submit comparison: ${errorMsg}`);
  }
  return await res.json();
}

export async function getLearnedPreferences(): Promise<LearnedPreferenceState> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/feedback/learned-preferences/`, {
    method: 'GET',
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to fetch learned preferences: HTTP ${res.status}`);
  return await res.json();
}

export async function resetLearnedPreferences(): Promise<LearnedPreferenceState> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/feedback/learned-preferences/reset/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to reset learned preferences: HTTP ${res.status}`);
  return await res.json();
}

export async function getCandidateExplanation(runId: string, candidateId: string): Promise<CandidateExplanation> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/runs/${runId}/candidates/${candidateId}/explain/`, {
    method: 'GET',
    headers: getAuthHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to fetch explanation: HTTP ${res.status}`);
  return await res.json();
}

export async function compareCandidatesDetailed(
  runId: string,
  candidateAId: string,
  candidateBId: string
): Promise<CandidateComparisonDetail> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/runs/${runId}/candidates/compare-detailed/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify({
      candidate_a_id: candidateAId,
      candidate_b_id: candidateBId,
    }),
  });
  if (!res.ok) throw new Error(`Failed to compare candidates: HTTP ${res.status}`);
  return await res.json();
}

export async function refineCandidateLayout(
  runId: string,
  candidateId: string,
  instruction: string
): Promise<RefinementResponse> {
  const token = await ensureAuthenticated();
  const res = await fetch(`${API_BASE_URL}/api/v1/agent/runs/${runId}/candidates/${candidateId}/refine/`, {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify({
      instruction,
    }),
  });
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      errorMsg = err.detail || JSON.stringify(err);
    } catch {
      // fallback
    }
    throw new Error(`Failed to refine candidate: ${errorMsg}`);
  }
  return await res.json();
}
