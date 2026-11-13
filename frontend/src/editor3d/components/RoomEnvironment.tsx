import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { buildProceduralRoomGeometries } from '../../spatial/parametric/geometry';
import { getCanonicalRoomGeometry } from '../../spatial/parametric/roomGeometry';

export const RoomEnvironment: React.FC = () => {
  const room = useEditorStore((state) => state.scene.room);
  const selectObject = useEditorStore((state) => state.selectObject);

  // Architectural selection state and actions
  const selectedWallId = useEditorStore((state) => state.selectedWallId);
  const hoveredWallId = useEditorStore((state) => state.hoveredWallId);
  const selectedOpeningId = useEditorStore((state) => state.selectedOpeningId);
  const hoveredOpeningId = useEditorStore((state) => state.hoveredOpeningId);

  const selectWall = useEditorStore((state) => state.selectWall);
  const hoverWall = useEditorStore((state) => state.hoverWall);
  const selectOpening = useEditorStore((state) => state.selectOpening);
  const hoverOpening = useEditorStore((state) => state.hoverOpening);
  const clearArchitecturalSelection = useEditorStore((state) => state.clearArchitecturalSelection);

  const { width, length, height } = room;

  // Retrieve canonical room specification (works for both legacy rectangular and parametric models)
  const canonicalRoom = useMemo(() => getCanonicalRoomGeometry(room), [room]);

  // Procedurally generate deterministic floor, walls, and opening geometries
  const procedural = useMemo(
    () => buildProceduralRoomGeometries(canonicalRoom),
    [canonicalRoom]
  );

  // Clean up GPU geometries on replacement or unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      procedural.floor.floorGeometry.dispose();
      procedural.floor.ceilingGeometry?.dispose();
      procedural.floor.outlineGeometry.dispose();
      procedural.cornerJunctions?.dispose();
      for (const w of procedural.walls) {
        w.wallGeometry.dispose();
        w.frameGeometry?.dispose();
      }
    };
  }, [procedural]);

  const handleFloorClick = () => {
    // Clicking the empty floor clears both furniture and architectural selections
    selectObject(null);
    clearArchitecturalSelection();
  };

  const { bounds } = procedural.floor;
  const gridExtent = Math.max(bounds.width || width, bounds.length || length) * 1.5;
  const gridDivisions = Math.round(Math.max(bounds.width || width, bounds.length || length) * 2);

  return (
    <group>
      {/* Procedurally Triangulated Floor Mesh (supports convex and concave polygons) */}
      <mesh
        geometry={procedural.floor.floorGeometry}
        position={[0, -0.005, 0]}
        receiveShadow
        onClick={handleFloorClick}
      >
        <meshStandardMaterial
          color="#1e2230"
          roughness={0.65}
          metalness={0.05}
        />
      </mesh>

      {/* Grid Overlay aligned in metres with room center */}
      <gridHelper
        args={[gridExtent, gridDivisions, '#4f46e5', '#334155']}
        position={[bounds.center[0], 0, bounds.center[1]]}
      />

      {/* Floor Boundary Perimeter Outline */}
      <lineSegments
        geometry={procedural.floor.outlineGeometry}
        position={[0, 0.002, 0]}
      >
        <lineBasicMaterial color="#6366f1" linewidth={2} />
      </lineSegments>

      {/* Procedurally Generated Walls with Opening Cutouts */}
      {procedural.walls.map((w) => {
        const isWallSelected = selectedWallId === w.wallId;
        const isWallHovered = hoveredWallId === w.wallId && !isWallSelected;

        const wallColor = isWallSelected
          ? '#4f46e5'
          : isWallHovered
          ? '#1e293b'
          : '#0f172a';
        const wallOpacity = isWallSelected ? 0.55 : isWallHovered ? 0.45 : 0.35;

        const [x1, z1] = w.derived.startPoint;
        const [ux, uz] = w.derived.direction;
        const wallAngle = Math.atan2(uz, ux);

        return (
          <group key={`wall-group-${w.wallId}`}>
            {/* Solid Wall Body with Door/Window Voids */}
            <mesh
              geometry={w.wallGeometry}
              receiveShadow
              castShadow
              onClick={(e) => {
                e.stopPropagation();
                selectWall(w.wallId);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                hoverWall(w.wallId);
              }}
              onPointerOut={() => {
                hoverWall(null);
              }}
            >
              <meshStandardMaterial
                color={wallColor}
                transparent
                opacity={wallOpacity}
                roughness={0.6}
                metalness={0.1}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* Opening Frame / Architrave Highlights */}
            {w.frameGeometry && (
              <mesh
                geometry={w.frameGeometry}
                receiveShadow
                castShadow
              >
                <meshStandardMaterial
                  color="#38bdf8"
                  roughness={0.4}
                  metalness={0.2}
                  transparent
                  opacity={0.7}
                />
              </mesh>
            )}

            {/* Interactive Opening Hit Volumes & Selection Indicators */}
            {w.openings.map((op) => {
              const isOpSelected = selectedOpeningId === op.id;
              const isOpHovered = hoveredOpeningId === op.id && !isOpSelected;

              const opSill = op.sillHeight ?? 0;
              const sMid = op.distanceAlongWall + op.width / 2;
              const yMid = opSill + op.height / 2;

              // World coordinate of opening center
              const opWorldX = x1 + sMid * ux;
              const opWorldY = yMid;
              const opWorldZ = z1 + sMid * uz;

              return (
                <group
                  key={`opening-interactive-${op.id}`}
                  position={[opWorldX, opWorldY, opWorldZ]}
                  rotation={[0, -wallAngle, 0]}
                >
                  {/* Invisible / Semi-transparent hit volume */}
                  <mesh
                    onClick={(e) => {
                      e.stopPropagation();
                      selectOpening(op.id);
                    }}
                    onPointerOver={(e) => {
                      e.stopPropagation();
                      hoverOpening(op.id);
                    }}
                    onPointerOut={() => {
                      hoverOpening(null);
                    }}
                  >
                    <boxGeometry args={[op.width, op.height, w.derived.thickness + 0.06]} />
                    <meshBasicMaterial
                      color={isOpSelected ? '#06b6d4' : isOpHovered ? '#38bdf8' : '#000000'}
                      transparent
                      opacity={isOpSelected ? 0.35 : isOpHovered ? 0.2 : 0.0}
                      depthWrite={false}
                    />
                  </mesh>

                  {/* Selection Bounding Wireframe */}
                  {(isOpSelected || isOpHovered) && (
                    <lineSegments>
                      <edgesGeometry
                        args={[new THREE.BoxGeometry(op.width, op.height, w.derived.thickness + 0.08)]}
                      />
                      <lineBasicMaterial
                        color={isOpSelected ? '#06b6d4' : '#38bdf8'}
                        linewidth={isOpSelected ? 3 : 1}
                      />
                    </lineSegments>
                  )}
                </group>
              );
            })}
          </group>
        );
      })}

      {/* Corner Junction Filler Mesh for Seamless Miter Connections */}
      {procedural.cornerJunctions && (
        <mesh
          geometry={procedural.cornerJunctions}
          receiveShadow
          castShadow
        >
          <meshStandardMaterial
            color="#0f172a"
            transparent
            opacity={0.35}
            roughness={0.6}
            metalness={0.1}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Corner Posts / Height Markers at Polygon Footprint Vertices */}
      {canonicalRoom.footprint.map(([cx, cz], i) => (
        <mesh key={`post-${i}`} position={[cx, height / 2, cz]}>
          <cylinderGeometry args={[0.015, 0.015, height, 8]} />
          <meshBasicMaterial color="#6366f1" transparent opacity={0.6} />
        </mesh>
      ))}

      {/* Ceiling Perimeter Outline */}
      {procedural.floor.outlineGeometry && (
        <lineSegments
          geometry={procedural.floor.outlineGeometry}
          position={[0, height, 0]}
        >
          <lineBasicMaterial color="#4338ca" transparent opacity={0.3} />
        </lineSegments>
      )}
    </group>
  );
};
