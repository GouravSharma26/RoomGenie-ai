import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';

export const WalkabilityOverlay: React.FC = () => {
  const showWalkabilityOverlay = useEditorStore((state) => state.showWalkabilityOverlay);
  const walkabilityAnalysis = useEditorStore((state) => state.walkabilityAnalysis);
  const room = useEditorStore((state) => state.scene.room);

  // 1. Generate Heatmap Floor Canvas Texture
  const heatmapTexture = useMemo(() => {
    if (!showWalkabilityOverlay || !walkabilityAnalysis) return null;

    const { costGrid } = walkabilityAnalysis;
    const { dimensions, classifications } = costGrid;
    const { numCols, numRows } = dimensions;

    const canvas = document.createElement('canvas');
    canvas.width = Math.min(Math.max(numCols * 4, 128), 1024);
    canvas.height = Math.min(Math.max(numRows * 4, 128), 1024);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cellPixelW = canvas.width / numCols;
    const cellPixelH = canvas.height / numRows;

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const idx = r * numCols + c;
        const cls = classifications[idx];

        if (cls === 'blocked') {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.40)'; // Red
          ctx.fillRect(c * cellPixelW, r * cellPixelH, cellPixelW + 0.5, cellPixelH + 0.5);
        } else if (cls === 'restricted') {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.32)'; // Amber
          ctx.fillRect(c * cellPixelW, r * cellPixelH, cellPixelW + 0.5, cellPixelH + 0.5);
        } else if (cls === 'free') {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.10)'; // Subtle emerald
          ctx.fillRect(c * cellPixelW, r * cellPixelH, cellPixelW + 0.5, cellPixelH + 0.5);
        }
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, [showWalkabilityOverlay, walkabilityAnalysis]);

  // 2. Generate 3D Line Geometries for Navigation Routes
  const routeGeometries = useMemo(() => {
    if (!showWalkabilityOverlay || !walkabilityAnalysis) return [];

    const { routes } = walkabilityAnalysis.circulation;
    const lines: { id: string; points: THREE.Vector3[]; color: string }[] = [];

    for (const [id, route] of Object.entries(routes)) {
      if (!route.found || route.worldPath.length < 2) continue;

      const points = route.worldPath.map(
        ([x, z]) => new THREE.Vector3(x, 0.02, z)
      );

      const color = route.traversesRestricted ? '#f59e0b' : '#06b6d4';
      lines.push({ id, points, color });
    }

    return lines;
  }, [showWalkabilityOverlay, walkabilityAnalysis]);

  // 3. Doorway Marker Position
  const doorwayMarkers = useMemo(() => {
    if (!showWalkabilityOverlay || !walkabilityAnalysis) return [];
    return walkabilityAnalysis.openings.map((door) => ({
      id: door.id,
      position: new THREE.Vector3(door.accessPoint[0], 0.02, door.accessPoint[1]),
      width: door.width,
    }));
  }, [showWalkabilityOverlay, walkabilityAnalysis]);

  if (!showWalkabilityOverlay || !walkabilityAnalysis || !heatmapTexture) {
    return null;
  }

  return (
    <group name="walkability-overlay">
      {/* 2D Heatmap Ground Plane */}
      <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[room.width, room.length]} />
        <meshBasicMaterial
          map={heatmapTexture}
          transparent
          opacity={0.9}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Navigation Routes */}
      {routeGeometries.map((route) => {
        const lineGeo = new THREE.BufferGeometry().setFromPoints(route.points);
        return (
          <group key={route.id}>
            <primitive object={new THREE.Line(
              lineGeo,
              new THREE.LineBasicMaterial({
                color: route.color,
                linewidth: 2,
                transparent: true,
                opacity: 0.85,
              })
            )} />
            {/* Target waypoint marker */}
            <mesh position={route.points[route.points.length - 1]}>
              <cylinderGeometry args={[0.08, 0.08, 0.02, 16]} />
              <meshBasicMaterial color={route.color} transparent opacity={0.9} />
            </mesh>
          </group>
        );
      })}

      {/* Doorway Entrance Markers */}
      {doorwayMarkers.map((door) => (
        <group key={door.id} position={door.position}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.15, 0.25, 32]} />
            <meshBasicMaterial color="#3b82f6" transparent opacity={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
};
