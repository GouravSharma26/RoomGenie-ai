import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { 
  defaultSocketRegistry, 
  computeAnchorSurfacePointLocal,
  type SocketCandidate 
} from '../../spatial';
import type { FurniturePlacement, SemanticRelationship, Vector3Tuple } from '../../types/scene';

interface ExistingRelationshipProps {
  relationship: SemanticRelationship;
  anchor: FurniturePlacement;
  child: FurniturePlacement;
  isSelected: boolean;
  hasConflict: boolean;
}

const ExistingRelationshipLine: React.FC<ExistingRelationshipProps> = ({
  anchor,
  child,
  isSelected,
  hasConflict,
}) => {
  const socket = defaultSocketRegistry.getSocketDefinition(anchor.assetId);

  const { startPos, endPos } = useMemo(() => {
    let startX = anchor.position[0];
    let startZ = anchor.position[2];

    if (socket) {
      const localPoint = computeAnchorSurfacePointLocal(anchor.dimensions, anchor.scale, socket);
      const yaw = anchor.rotationEuler[1];
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      startX = anchor.position[0] + (localPoint.x * cosY + localPoint.z * sinY);
      startZ = anchor.position[2] + (-localPoint.x * sinY + localPoint.z * cosY);
    }

    const endX = child.position[0];
    const endZ = child.position[2];

    return {
      startPos: [startX, 0.025, startZ] as Vector3Tuple,
      endPos: [endX, 0.025, endZ] as Vector3Tuple,
    };
  }, [anchor, child, socket]);

  const color = hasConflict
    ? '#f43f5e' // Rose for spatial conflict
    : isSelected
    ? '#6366f1' // Indigo when either connected item is selected
    : '#64748b'; // Subtle slate when unselected

  const opacity = isSelected ? 0.95 : 0.35;

  const positions = useMemo(
    () => new Float32Array([...startPos, ...endPos]),
    [startPos, endPos]
  );

  const midPos: Vector3Tuple = [
    (startPos[0] + endPos[0]) / 2,
    0.03,
    (startPos[2] + endPos[2]) / 2,
  ];

  return (
    <group>
      {/* Floor connection line */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={color}
          linewidth={isSelected ? 2 : 1}
          transparent
          opacity={opacity}
          depthTest={false}
        />
      </lineSegments>

      {/* Anchor Contact Marker */}
      <mesh position={startPos}>
        <sphereGeometry args={[isSelected ? 0.035 : 0.02, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
      </mesh>

      {/* Child Contact Marker */}
      <mesh position={endPos}>
        <sphereGeometry args={[isSelected ? 0.035 : 0.02, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
      </mesh>

      {/* Midpoint Connection Badge / Disc */}
      {isSelected && (
        <mesh position={midPos} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.04, 0.07, 16]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.8}
            side={THREE.DoubleSide}
            depthTest={false}
          />
        </mesh>
      )}
    </group>
  );
};

interface CandidatePreviewProps {
  candidate: SocketCandidate;
}

const CandidatePreview: React.FC<CandidatePreviewProps> = ({ candidate }) => {
  const { anchorPlacement, socket, targetPosition, targetRotation, targetPlacement, valid } = candidate;

  // Compute anchor contact point in world
  const anchorContactPoint = useMemo(() => {
    const localPoint = computeAnchorSurfacePointLocal(
      anchorPlacement.dimensions,
      anchorPlacement.scale,
      socket
    );
    const yaw = anchorPlacement.rotationEuler[1];
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const worldX = anchorPlacement.position[0] + (localPoint.x * cosY + localPoint.z * sinY);
    const worldZ = anchorPlacement.position[2] + (-localPoint.x * sinY + localPoint.z * cosY);
    return [worldX, 0.03, worldZ] as Vector3Tuple;
  }, [anchorPlacement, socket]);

  const color = valid ? '#10b981' : '#f43f5e'; // Emerald if valid, Rose if conflict
  const [width, height, depth] = targetPlacement.dimensions;

  const guidePositions = useMemo(
    () => new Float32Array([...anchorContactPoint, targetPosition[0], 0.03, targetPosition[2]]),
    [anchorContactPoint, targetPosition]
  );

  return (
    <group>
      {/* Transient Magnetic Guide Line */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[guidePositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={color}
          linewidth={2}
          transparent
          opacity={0.9}
          depthTest={false}
        />
      </lineSegments>

      {/* Snapped Target Floor Base Ring */}
      <mesh position={[targetPosition[0], 0.02, targetPosition[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.18, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthTest={false}
        />
      </mesh>

      {/* Ghost Wireframe of Target Item at Prospective Transform */}
      <mesh position={targetPosition} rotation={targetRotation}>
        <boxGeometry args={[width * 1.02, height * 1.02, depth * 1.02]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={0.75}
          depthTest={false}
        />
      </mesh>

      {/* Subtle Ghost Solid Fill for Depth Cue */}
      <mesh position={targetPosition} rotation={targetRotation}>
        <boxGeometry args={[width, height, depth]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.15}
          depthTest={false}
        />
      </mesh>
    </group>
  );
};

export const RelationshipOverlay: React.FC = () => {
  const relationships = useEditorStore((state) => state.scene.relationships || []);
  const objects = useEditorStore((state) => state.scene.objects);
  const selectedId = useEditorStore((state) => state.selectedId);
  const spatialValidations = useEditorStore((state) => state.spatialValidations);
  const activeSocketCandidate = useEditorStore((state) => state.activeSocketCandidate);

  const existingPairs = useMemo(() => {
    const pairs: Array<{
      relationship: SemanticRelationship;
      anchor: FurniturePlacement;
      child: FurniturePlacement;
      isSelected: boolean;
      hasConflict: boolean;
    }> = [];

    const objMap = new Map<string, FurniturePlacement>(objects.map((o) => [o.id, o]));

    for (const rel of relationships) {
      const anchor = objMap.get(rel.anchorObjectId);
      const child = objMap.get(rel.childObjectId);
      if (!anchor || !child) continue;

      const isSelected = selectedId === anchor.id || selectedId === child.id;
      const anchorVal = spatialValidations[anchor.id];
      const childVal = spatialValidations[child.id];
      const hasConflict = Boolean((anchorVal && !anchorVal.valid) || (childVal && !childVal.valid));

      pairs.push({
        relationship: rel,
        anchor,
        child,
        isSelected,
        hasConflict,
      });
    }

    return pairs;
  }, [relationships, objects, selectedId, spatialValidations]);

  return (
    <group>
      {/* Existing Attached Relationships */}
      {existingPairs.map(({ relationship, anchor, child, isSelected, hasConflict }) => (
        <ExistingRelationshipLine
          key={relationship.id}
          relationship={relationship}
          anchor={anchor}
          child={child}
          isSelected={isSelected}
          hasConflict={hasConflict}
        />
      ))}

      {/* Transient Magnetic Attachment Preview during Drag */}
      {activeSocketCandidate && (
        <CandidatePreview candidate={activeSocketCandidate} />
      )}
    </group>
  );
};
