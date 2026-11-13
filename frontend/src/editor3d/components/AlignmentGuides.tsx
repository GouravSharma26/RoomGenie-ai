import React, { useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { SnapGuide } from '../../spatial';

interface SingleGuideProps {
  guide: SnapGuide;
}

const SingleGuide: React.FC<SingleGuideProps> = ({ guide }) => {
  const color =
    guide.type === 'wall'
      ? '#10b981' // emerald for wall snap
      : guide.type === 'center'
      ? '#8b5cf6' // vibrant violet for center-to-center
      : guide.type === 'edge'
      ? '#06b6d4' // cyan for edge-to-edge
      : '#818cf8'; // light indigo for grid snap

  const positions = useMemo(
    () => new Float32Array([...guide.start, ...guide.end]),
    [guide.start, guide.end]
  );

  return (
    <group>
      {/* Alignment Guide Line */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={color}
          linewidth={2}
          transparent
          opacity={0.95}
          depthTest={false}
        />
      </lineSegments>

      {/* Guide Endpoint Markers */}
      <mesh position={guide.start}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
      </mesh>
      <mesh position={guide.end}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
      </mesh>
    </group>
  );
};

export const AlignmentGuides: React.FC = () => {
  const activeSnapGuides = useEditorStore((state) => state.activeSnapGuides);

  if (!activeSnapGuides || activeSnapGuides.length === 0) {
    return null;
  }

  return (
    <group>
      {activeSnapGuides.map((guide) => (
        <SingleGuide key={guide.id} guide={guide} />
      ))}
    </group>
  );
};
