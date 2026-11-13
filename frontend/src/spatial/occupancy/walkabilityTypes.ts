import type { GridConfig, GridDimensions, CellCoordinate, OccupancyGrid } from './occupancyTypes';

/**
 * Functional walkability state of a grid cell.
 */
export type WalkabilityClassification =
  | 'free'            // Unhindered, open floor space (base traversal cost)
  | 'restricted'      // Soft clearance zone (functional buffer, high traversal cost)
  | 'blocked'         // Impassable physical obstacle (furniture footprint or wall)
  | 'out_of_bounds';  // Outside the room boundary

/**
 * Configuration options for walkability and clearance inflation.
 */
export interface WalkabilityConfig extends GridConfig {
  /** Pedestrian safety margin / body radius around physical furniture in metres (default 0.30m) */
  pedestrianClearance: number;
  /** Minimum comfortable walkway / corridor width in metres (default 0.70m, critical threshold 0.55m) */
  minCorridorWidth: number;
  /** Critical walkway width below which an error is generated in metres (default 0.55m) */
  criticalCorridorWidth: number;
  /** Default room door width in metres (default 0.90m) */
  defaultDoorWidth: number;
  /** Default front clearance depth for door swing / entry zone in metres (default 0.90m) */
  doorClearanceDepth: number;
  /** Base traversal cost multiplier for restricted/clearance cells (default 3.0) */
  restrictedCostMultiplier: number;
}

/**
 * Room opening / doorway representation.
 */
export interface RoomOpening {
  id: string;
  wall: 'north' | 'south' | 'east' | 'west';
  center: [number, number]; // [x, z] in world coordinates
  width: number;
  clearanceDepth: number;
  swingDirection?: 'inward' | 'outward' | 'sliding';
  accessPoint: [number, number]; // Interior landing coordinate [x, z]
  wallId?: string;
  isFallback?: boolean;
}

/**
 * 2D Cost Grid and distance field for pathfinding and walkability heatmap.
 */
export interface WalkabilityCostGrid {
  dimensions: GridDimensions;
  config: WalkabilityConfig;
  /** Traversal cost per cell index (1.0 = normal, >1.0 = penalized, Infinity = impassable) */
  costs: Float32Array;
  /** Qualitative classification per cell index */
  classifications: WalkabilityClassification[];
  /** Euclidean distance in metres to the nearest physical obstacle / wall */
  obstacleDistances: Float32Array;
  /** Furniture IDs whose clearance / footprint affects each cell */
  cellFurnitureIds: string[][];
  /** Indices of all physically blocked cells */
  blockedIndices: number[];
  /** Indices of all restricted/clearance cells */
  restrictedIndices: number[];
}

/**
 * Options controlling the A* pathfinding algorithm.
 */
export interface PathfindingOptions {
  /** Whether to allow pathing through soft clearance zones with penalty (default true) */
  allowRestricted?: boolean;
  /** Whether to smooth the generated path using 2D line-of-sight waypoint pruning (default true) */
  smoothPath?: boolean;
  /** Maximum traversal cost before declaring target unreachable (default 1000) */
  maxCost?: number;
}

/**
 * Result of calculating an A* route between two points.
 */
export interface NavigationPath {
  start: [number, number];       // World [x, z]
  goal: [number, number];        // World [x, z]
  found: boolean;
  gridPath: CellCoordinate[];    // Raw cell-by-cell path
  worldPath: [number, number][]; // World coordinates [x, z] for each waypoint
  lengthMeters: number;          // Total path physical length
  traversalCost: number;         // Integrated cost of traversed cells
  traversesRestricted: boolean;  // True if route passes through soft clearance zones
}

/**
 * Category of circulation or flow diagnostic issue.
 */
export type CirculationIssueType =
  | 'door_blocked'          // Furniture or severe obstruction blocks door swing/entry
  | 'furniture_unreachable' // Furniture cannot be reached from the entrance
  | 'narrow_passage'        // Walkway between objects or walls is below clearance width
  | 'clearance_clash'       // Multiple furniture items compete for the same clearance zone
  | 'disconnected_floor';   // Room is split into isolated walkable islands

export type CirculationIssueSeverity = 'error' | 'warning' | 'info';

/**
 * Structured diagnostic issue matching the Flow Check specification.
 */
export interface CirculationIssue {
  id: string;
  type: CirculationIssueType;
  severity: CirculationIssueSeverity;
  title: string;
  description: string;
  affectedFurnitureIds: string[];
  location?: [number, number]; // [x, z] coordinate of problem in world space
  recommendation?: string;
}

/**
 * Comprehensive circulation and walkability evaluation report.
 */
export interface CirculationReport {
  /** Holistic flow score from 0 (completely unpassable) to 100 (optimal circulation) */
  walkabilityScore: number;
  /** Ratio of furniture items reachable from the entrance (0.0 to 1.0) */
  accessibleRatio: number;
  accessibleFurnitureCount: number;
  totalFurnitureCount: number;
  /** Whether the room has a valid entrance and clear primary navigation routes */
  isRoomPassable: boolean;
  /** List of detected circulation and clearance issues */
  issues: CirculationIssue[];
  /** Calculated routes from entrance to key furniture access zones */
  routes: Record<string, NavigationPath>;
  /** Narrowest navigable passage width detected in metres */
  narrowestPassageMeters: number;
  /** Percentage of room floor that is freely traversable */
  walkableAreaRatio: number;
}

/**
 * Full output of the Phase 4 walkability analysis.
 */
export interface WalkabilityAnalysisResult {
  occupancyGrid: OccupancyGrid;
  costGrid: WalkabilityCostGrid;
  openings: RoomOpening[];
  circulation: CirculationReport;
  buildTimeMs: number;
}
