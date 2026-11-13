import type { SpatialSocketDefinition } from './relationshipTypes';

/**
 * Declarative socket definitions for RoomGenie AI furniture catalogue.
 * Strictly defines connection faces, normals, compatible categories,
 * and ergonomic gap limits.
 */
export const CANONICAL_SOCKET_DEFINITIONS: SpatialSocketDefinition[] = [
  // --- Modern 3-Seater Sofa ---
  {
    id: 'sofa-front-table',
    name: 'Front Coffee Table',
    anchorAssetId: 'sofa-modern-3seater',
    anchorCategory: 'seating',
    allowedCategories: ['tables'],
    allowedAssetTags: ['living-room'],
    surfaceNormal: [0, 0, 1], // Front face (+Z)
    lateralRatio: 0,          // Centered
    facingMode: 'same-direction',
    baseRelativeYaw: 0,
    recommendedGap: 0.45,     // 45cm standard legroom between sofa and table
    minGap: 0.30,             // 30cm minimum knee clearance
    maxGap: 0.70,             // 70cm maximum arm reach
  },
  {
    id: 'sofa-left-accent',
    name: 'Left Accent Armchair',
    anchorAssetId: 'sofa-modern-3seater',
    anchorCategory: 'seating',
    allowedCategories: ['seating'],
    allowedAssetTags: ['accent', 'reading'],
    surfaceNormal: [-1, 0, 0], // Left side face (-X)
    lateralRatio: 0.35,        // Shifted forward toward conversation center
    facingMode: 'face-anchor', // Turns to face sofa
    baseRelativeYaw: Math.PI / 4, // 45 degree conversation angle
    recommendedGap: 0.50,
    minGap: 0.35,
    maxGap: 1.00,
  },
  {
    id: 'sofa-right-accent',
    name: 'Right Accent Armchair',
    anchorAssetId: 'sofa-modern-3seater',
    anchorCategory: 'seating',
    allowedCategories: ['seating'],
    allowedAssetTags: ['accent', 'reading'],
    surfaceNormal: [1, 0, 0],  // Right side face (+X)
    lateralRatio: 0.35,        // Shifted forward toward conversation center
    facingMode: 'face-anchor', // Turns to face sofa
    baseRelativeYaw: -Math.PI / 4, // -45 degree conversation angle
    recommendedGap: 0.50,
    minGap: 0.35,
    maxGap: 1.00,
  },

  // --- Nordic Queen Platform Bed ---
  {
    id: 'bed-left-nightstand',
    name: 'Left Bedside Nightstand',
    anchorAssetId: 'bed-queen-platform',
    anchorCategory: 'beds',
    allowedCategories: ['tables'],
    allowedAssetTags: ['bedroom'],
    surfaceNormal: [-1, 0, 0], // Left side face (-X)
    lateralRatio: -0.65,       // Aligned near headboard (-Z in bed local coordinates)
    facingMode: 'same-direction',
    baseRelativeYaw: 0,
    recommendedGap: 0.08,      // 8cm neat bedside gap
    minGap: 0.03,              // 3cm minimum clearance
    maxGap: 0.35,
  },
  {
    id: 'bed-right-nightstand',
    name: 'Right Bedside Nightstand',
    anchorAssetId: 'bed-queen-platform',
    anchorCategory: 'beds',
    allowedCategories: ['tables'],
    allowedAssetTags: ['bedroom'],
    surfaceNormal: [1, 0, 0],  // Right side face (+X)
    lateralRatio: -0.65,       // Aligned near headboard
    facingMode: 'same-direction',
    baseRelativeYaw: 0,
    recommendedGap: 0.08,
    minGap: 0.03,
    maxGap: 0.35,
  },

  // --- Ergonomic Study Desk ---
  {
    id: 'desk-knee-well-chair',
    name: 'Task / Study Chair',
    anchorAssetId: 'desk-workspace-study',
    anchorCategory: 'tables',
    allowedCategories: ['seating'],
    allowedAssetTags: ['workspace', 'accent', 'living-room'],
    surfaceNormal: [0, 0, 1],  // Front face (+Z / user side)
    lateralRatio: 0,           // Centered in front of knee well
    facingMode: 'face-anchor', // Chair faces toward the desk
    baseRelativeYaw: 0,
    recommendedGap: 0.20,      // 20cm pull-out distance
    minGap: 0.05,              // 5cm pushed in
    maxGap: 0.65,
  },
];
