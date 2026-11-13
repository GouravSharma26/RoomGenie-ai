import type { CanonicalScene } from '../../types/scene';
import { buildOccupancyGrid } from './occupancyBuilder';
import { buildWalkabilityCostGrid, resolveRoomOpenings } from './clearanceMapper';
import { validateCirculation } from './circulationValidator';
import type { WalkabilityAnalysisResult, WalkabilityConfig } from './walkabilityTypes';

/**
 * Unified high-level coordinator that runs complete Phase 4 walkability analysis.
 * Deterministic, non-mutating, zero-allocation caching friendly.
 */
export function analyzeWalkability(
  scene: CanonicalScene,
  customConfig?: Partial<WalkabilityConfig>,
  categoryLookup: Record<string, string> = {}
): WalkabilityAnalysisResult {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // 1. Build Physical 2D Occupancy Grid (Phase 4.1)
  const occupancyResult = buildOccupancyGrid(scene, {
    resolution: customConfig?.resolution,
  });

  if (!occupancyResult.success || !occupancyResult.grid) {
    throw new Error(occupancyResult.error || 'Failed to construct occupancy grid for walkability analysis.');
  }

  const occupancyGrid = occupancyResult.grid;

  // 2. Resolve Architectural Openings & Doorways
  const openings = resolveRoomOpenings(scene.room);

  // 3. Build Distance Field, Pedestrian Buffer & Cost Grid (Phase 4.2)
  const costGrid = buildWalkabilityCostGrid(
    scene,
    occupancyGrid,
    customConfig,
    categoryLookup
  );

  // 4. Validate Circulation, A* Pathfinding Routes & Diagnostics (Phases 4.3 & 4.4)
  const circulation = validateCirculation(scene, costGrid, openings, categoryLookup);

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const buildTimeMs = Number((endTime - startTime).toFixed(2));

  return {
    occupancyGrid,
    costGrid,
    openings,
    circulation,
    buildTimeMs,
  };
}
