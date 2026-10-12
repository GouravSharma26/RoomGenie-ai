import React from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';

export const RoomEnvironment: React.FC = () => {
  const room = useEditorStore((state) => state.scene.room);
  const selectObject = useEditorStore((state) => state.selectObject);

  const { width, length, height } = room;
  const halfW = width / 2;
  const halfL = length / 2;

  const handleFloorClick = () => {
    // Clicking the empty floor clears object selection
    selectObject(null);
  };

  return (
    <group>
      {/* Floor Mesh */}
      <mesh
        position={[0, -0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={handleFloorClick}
      >
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial
          color="#1e2230"
          roughness={0.65}
          metalness={0.05}
        />
      </mesh>

      {/* Grid Overlay aligned in metres */}
      <gridHelper
        args={[Math.max(width, length) * 1.5, Math.round(Math.max(width, length) * 2), '#4f46e5', '#334155']}
        position={[0, 0, 0]}
      />

      {/* Floor Boundary Border Outline */}
      <lineSegments position={[0, 0.005, 0]}>
        <edgesGeometry
          args={[new THREE.BoxGeometry(width, 0.01, length)]}
        />
        <lineBasicMaterial color="#6366f1" linewidth={2} />
      </lineSegments>

      {/* Semi-transparent Wall Guides */}
      {/* Back Wall (-Z) */}
      <mesh position={[0, height / 2, -halfL]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#0f172a"
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Left Wall (-X) */}
      <mesh position={[-halfW, height / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[length, height]} />
        <meshStandardMaterial
          color="#0f172a"
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Corner Posts / Height Markers */}
      {[
        [-halfW, -halfL],
        [halfW, -halfL],
        [-halfW, halfL],
        [halfW, halfL],
      ].map(([cx, cz], i) => (
        <mesh key={`post-${i}`} position={[cx, height / 2, cz]}>
          <cylinderGeometry args={[0.015, 0.015, height, 8]} />
          <meshBasicMaterial color="#6366f1" transparent opacity={0.6} />
        </mesh>
      ))}

      {/* Ceiling Envelope Outline */}
      <lineSegments position={[0, height, 0]}>
        <edgesGeometry
          args={[new THREE.BoxGeometry(width, 0.01, length)]}
        />
        <lineBasicMaterial color="#4338ca" transparent opacity={0.3} />
      </lineSegments>
    </group>
  );
};
