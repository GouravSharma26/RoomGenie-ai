import type { CanonicalScene } from '../types/scene';
import type { SpatialContext } from '../spatial/ai/aiSpatialTypes';
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
}

export interface CandidateIssue {
  code: string;
  message: string;
  severity: 'fatal' | 'warning' | 'info';
  object_ids?: string[];
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
  userRequirements?: Record<string, any>
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
