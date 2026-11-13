import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useEditorStore, CATALOG_CATEGORY_LOOKUP, CATALOG_TAG_LOOKUP } from '../store/editorStore';
import { 
  defaultSocketRegistry, 
  computeAnchorSurfacePointLocal,
  type SpatialSocketDefinition
} from '../../spatial';
import type { FurniturePlacement, Vector3Tuple } from '../../types/scene';

interface SingleSocketMarkerProps {
  anchor: FurniturePlacement;
  socket: SpatialSocketDefinition;
  isCompatible: boolean;
  isSnapped: boolean;
  isOccupied: boolean;
  isSelectedAnchor: boolean;
}

function computeSocketWorldData(
  anchor: FurniturePlacement,
  socket: SpatialSocketDefinition
): {
  worldPos: Vector3Tuple;
  normalAngle: number;
  pointerPos: Vector3Tuple;
} {
  const localPoint = computeAnchorSurfacePointLocal(anchor.dimensions, anchor.scale, socket);
  const yaw = anchor.rotationEuler[1];
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);

  const worldX = anchor.position[0] + (localPoint.x * cosY + localPoint.z * sinY);
  const worldY = 0.02; // Elevated slightly above floor plane to avoid z-fighting
  const worldZ = anchor.position[2] + (-localPoint.x * sinY + localPoint.z * cosY);

  const [nx, , nz] = socket.surfaceNormal;
  const worldNormX = nx * cosY + nz * sinY;
  const worldNormZ = -nx * sinY + nz * cosY;
  const normalAngle = Math.atan2(worldNormX, worldNormZ);

  // Position of outward direction pointer arrow (0.22m out from socket center)
  const pointerX = worldX + worldNormX * 0.22;
  const pointerZ = worldZ + worldNormZ * 0.22;

  return {
    worldPos: [worldX, worldY, worldZ],
    normalAngle,
    pointerPos: [pointerX, worldY, pointerZ],
  };
}

const SingleSocketMarker: React.FC<SingleSocketMarkerProps> = ({
  anchor,
  socket,
  isCompatible,
  isSnapped,
  isOccupied,
  isSelectedAnchor,
}) => {
  const { worldPos, normalAngle, pointerPos } = useMemo(
    () => computeSocketWorldData(anchor, socket),
    [anchor, socket]
  );

  // Determine dynamic visual color & styling
  const color = isSnapped
    ? '#10b981' // Emerald when magnetically snapped
    : isOccupied
    ? '#64748b' // Dimmed slate when occupied
    : isCompatible
    ? '#06b6d4' // Cyan when compatible with dragged item
    : isSelectedAnchor
    ? '#6366f1' // Indigo when parent anchor is selected
    : '#94a3b8'; // Default slate

  const opacity = isSnapped ? 0.95 : isOccupied ? 0.35 : isCompatible ? 0.85 : 0.65;
  const ringScale = isSnapped ? 1.25 : isCompatible ? 1.15 : 1.0;

  return (
    <group position={worldPos}>
      {/* Contact Ring on floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[ringScale, ringScale, 1]}>
        <ringGeometry args={[0.08, 0.16, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          depthTest={false}
        />
      </mesh>

      {/* Central Contact Point */}
      <mesh position={[0, 0.005, 0]}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
      </mesh>

      {/* Outer Glow Halo for Compatible / Snapped Socket */}
      {(isCompatible || isSnapped) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.18, 0.24, 24]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={opacity * 0.4}
            side={THREE.DoubleSide}
            depthTest={false}
          />
        </mesh>
      )}

      {/* Outward Directional Arrow Pointer */}
      <group position={[pointerPos[0] - worldPos[0], 0.005, pointerPos[2] - worldPos[2]]}>
        <mesh rotation={[0, normalAngle, 0]}>
          <coneGeometry args={[0.05, 0.12, 8]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
        </mesh>
      </group>
    </group>
  );
};

export const SocketOverlay: React.FC = () => {
  const selectedId = useEditorStore((state) => state.selectedId);
  const draggedObjectId = useEditorStore((state) => state.draggedObjectId);
  const objects = useEditorStore((state) => state.scene.objects);
  const relationships = useEditorStore((state) => state.scene.relationships || []);
  const activeSocketCandidate = useEditorStore((state) => state.activeSocketCandidate);

  // If nothing is selected and nothing is being dragged, do not render sockets
  if (!selectedId && !draggedObjectId) {
    return null;
  }

  const draggedObj = draggedObjectId ? objects.find((o) => o.id === draggedObjectId) : undefined;
  const draggedCat = draggedObj ? CATALOG_CATEGORY_LOOKUP[draggedObj.assetId] || 'decor' : undefined;
  const draggedTags = draggedObj ? CATALOG_TAG_LOOKUP[draggedObj.assetId] || [] : [];

  // Determine which anchors should show sockets:
  // 1. If dragging an object: show all anchors that could host this object
  // 2. If an anchor is selected (and not dragging): show sockets for the selected anchor
  const visibleSockets: Array<{
    anchor: FurniturePlacement;
    socket: SpatialSocketDefinition;
    isCompatible: boolean;
    isSnapped: boolean;
    isOccupied: boolean;
    isSelectedAnchor: boolean;
  }> = [];

  for (const anchor of objects) {
    // Cannot attach an object to itself
    if (draggedObjectId && anchor.id === draggedObjectId) continue;

    const sockets = defaultSocketRegistry.getSocketsForAsset(anchor.assetId);
    if (sockets.length === 0) continue;

    const isSelectedAnchor = selectedId === anchor.id;

    for (const socket of sockets) {
      const isOccupied = relationships.some(
        (r) => r.anchorObjectId === anchor.id && r.socketId === socket.id && r.childObjectId !== draggedObjectId
      );

      let isCompatible = false;
      if (draggedCat) {
        isCompatible = defaultSocketRegistry.isCompatibleWithSocket(socket, draggedCat, draggedTags);
      }

      const isSnapped = Boolean(
        activeSocketCandidate &&
        activeSocketCandidate.anchorPlacement.id === anchor.id &&
        activeSocketCandidate.socket.id === socket.id
      );

      // Show socket if:
      // a) It is on the selected anchor
      // b) Or an item is being dragged and this socket is compatible or snapped
      if (isSelectedAnchor || (draggedObjectId && isCompatible)) {
        visibleSockets.push({
          anchor,
          socket,
          isCompatible,
          isSnapped,
          isOccupied,
          isSelectedAnchor,
        });
      }
    }
  }

  if (visibleSockets.length === 0) {
    return null;
  }

  return (
    <group>
      {visibleSockets.map(({ anchor, socket, isCompatible, isSnapped, isOccupied, isSelectedAnchor }) => (
        <SingleSocketMarker
          key={`${anchor.id}-${socket.id}`}
          anchor={anchor}
          socket={socket}
          isCompatible={isCompatible}
          isSnapped={isSnapped}
          isOccupied={isOccupied}
          isSelectedAnchor={isSelectedAnchor}
        />
      ))}
    </group>
  );
};
