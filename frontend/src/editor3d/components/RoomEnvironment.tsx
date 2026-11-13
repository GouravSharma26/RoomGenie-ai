import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { buildProceduralRoomGeometries } from '../../spatial/parametric/geometry';
import { getCanonicalRoomGeometry } from '../../spatial/parametric/roomGeometry';

export const RoomEnvironment: React.FC = () => {
  const room = useEditorStore((state) => state.scene.room);
  const selectObject = useEditorStore((state) => state.selectObject);

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
      for (const w of procedural.walls) {
        w.wallGeometry.dispose();
        w.frameGeometry?.dispose();
      }
    };
  }, [procedural]);

  const handleFloorClick = () => {
    // Clicking the empty floor clears object selection
    selectObject(null);
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
      {procedural.walls.map((w) => (
        <group key={`wall-group-${w.wallId}`}>
          {/* Solid Wall Body with Door/Window Voids */}
          <mesh
            geometry={w.wallGeometry}
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
        </group>
      ))}

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
