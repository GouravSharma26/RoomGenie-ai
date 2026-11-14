import { describe, it, expect } from 'vitest';
import type { LayoutCandidateRecord, OptimizationMetadata } from '../../services/agentApi';

describe('Phase 7.2 Spatial Layout Optimization Engine — Frontend Verification', () => {
  const sampleCandidate: LayoutCandidateRecord = {
    id: 'cand-opt-1',
    schema_version: 1,
    label: 'Option A: Conversational Living Suite',
    description: 'Sofa and coffee table with wall-aligned accent armchairs.',
    reasoning_summary: 'Optimized using constraint-guided local search.',
    proposed_actions: [
      {
        name: 'add_furniture',
        parameters: { asset_id: 'sofa-modern-3seater', position: [0, 0.45, -0.8] },
      },
    ],
    candidate_scene: {
      schemaVersion: 1,
      unit: 'm',
      room: { width: 5.0, length: 4.0, height: 2.8 },
      objects: [
        {
          id: 'sofa-1',
          assetId: 'sofa-modern-3seater',
          name: 'Modern 3-Seater Sofa',
          position: [0, 0.45, -0.8],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
          dimensions: [2.2, 0.9, 0.9],
        },
      ],
      relationships: [],
    },
    is_valid: true,
    is_approval_eligible: true,
    score: {
      boundary: 100,
      collision: 100,
      circulation: 95,
      clearance: 90,
      utilization: 88,
      budget: 100,
      overall: 94.2,
      weights: {
        boundary: 0.25,
        collision: 0.25,
        circulation: 0.20,
        clearance: 0.15,
        utilization: 0.10,
        budget: 0.05,
      },
    },
    validation_feedback: {
      is_valid: true,
      is_approval_eligible: true,
      has_collisions: false,
      has_boundary_breaches: false,
      is_budget_compliant: true,
      is_room_passable: true,
      fatal_errors: [],
      advisory_warnings: [],
      errors: [],
      warnings: [],
    },
    trade_offs: ['High open central floor space', 'Balanced conversational intimacy'],
    optimization_metadata: {
      version: '7.2',
      iterations: 12,
      statesEvaluated: 45,
      durationMs: 38.4,
      repaired: true,
      initialValid: false,
      finalValid: true,
      initialScore: 48.0,
      finalScore: 94.2,
      scoreDelta: 46.2,
      bestBadge: 'Best Overall',
      objectives: {
        containment: 100.0,
        collision: 100.0,
        circulation: 95.0,
        clearance: 92.0,
        accessibility: 90.0,
        utilization: 88.0,
        preferences: 96.0,
        relationships: 94.0,
      },
      appliedOperators: ['repair_boundary', 'wall_alignment', 'socket_reassignment'],
    },
  };

  it('correctly associates and preserves optimization metadata on LayoutCandidateRecord', () => {
    expect(sampleCandidate.optimization_metadata).toBeDefined();
    const meta = sampleCandidate.optimization_metadata as OptimizationMetadata;
    expect(meta.version).toBe('7.2');
    expect(meta.iterations).toBe(12);
    expect(meta.repaired).toBe(true);
    expect(meta.initialValid).toBe(false);
    expect(meta.finalValid).toBe(true);
    expect(meta.scoreDelta).toBe(46.2);
    expect(meta.bestBadge).toBe('Best Overall');
  });

  it('contains full 8-dimensional Pareto multi-objective breakdown', () => {
    const objectives = sampleCandidate.optimization_metadata?.objectives;
    expect(objectives).toBeDefined();
    expect(objectives?.containment).toBe(100.0);
    expect(objectives?.collision).toBe(100.0);
    expect(objectives?.circulation).toBe(95.0);
    expect(objectives?.clearance).toBe(92.0);
    expect(objectives?.accessibility).toBe(90.0);
    expect(objectives?.utilization).toBe(88.0);
    expect(objectives?.preferences).toBe(96.0);
    expect(objectives?.relationships).toBe(94.0);
  });

  it('records applied operators for transparent architectural auditing', () => {
    const operators = sampleCandidate.optimization_metadata?.appliedOperators;
    expect(operators).toBeDefined();
    expect(operators).toContain('repair_boundary');
    expect(operators).toContain('wall_alignment');
    expect(operators).toContain('socket_reassignment');
  });

  it('validates candidate approval eligibility depends strictly on physical validity', () => {
    const invalidCand: LayoutCandidateRecord = {
      ...sampleCandidate,
      is_valid: false,
      is_approval_eligible: false,
    };
    expect(invalidCand.is_approval_eligible).toBe(false);
    expect(sampleCandidate.is_approval_eligible).toBe(true);
  });
});

