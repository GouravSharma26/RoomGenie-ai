import type { SnapConfig } from './snappingTypes';

/**
 * Standard default configuration for Smart Magnetic Snapping
 * Units are SI metres.
 */
export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  wallSnap: true,
  wallTolerance: 0.15,      // 15cm magnetic radius to walls
  wallOffset: 0.0,          // 0cm (flush placement by default)
  alignmentSnap: true,
  alignmentTolerance: 0.05, // 5cm magnetic radius to other items
  gridSnap: true,
  gridSize: 0.05,           // 5cm standard CAD design grid
  hysteresisFactor: 1.25,   // 25% extra stickiness before releasing snap
};

export const SUPPORTED_GRID_SIZES = [
  { label: '1 cm', value: 0.01 },
  { label: '2.5 cm', value: 0.025 },
  { label: '5 cm (Standard)', value: 0.05 },
  { label: '10 cm', value: 0.10 },
  { label: '25 cm', value: 0.25 },
] as const;

