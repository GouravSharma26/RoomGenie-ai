import React, { useRef, Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { FurniturePlacement } from '../../types/scene';
import { useEditorStore } from '../store/editorStore';
import { SAMPLE_CATALOG } from '../data/catalog';

interface FurnitureItemProps {
  placement: FurniturePlacement;
}

interface GLTFModelProps {
  url: string;
  color: string;
  roughness: number;
  metalness: number;
}

const GLTFModel: React.FC<GLTFModelProps> = ({ url, color, roughness, metalness }) => {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child: any) => {
      if (child.isMesh && child.material) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = child.material.clone();
        if (color) child.material.color.set(color);
        child.material.roughness = roughness;
        child.material.metalness = metalness;
      }
    });
    return clone;
  }, [scene, color, roughness, metalness]);

  return <primitive object={cloned} />;
};

class ModelErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export const FurnitureItem: React.FC<FurnitureItemProps> = ({ placement }) => {
  const groupRef = useRef<THREE.Group>(null);
  const selectedId = useEditorStore((state) => state.selectedId);
  const hoveredId = useEditorStore((state) => state.hoveredId);
  const selectObject = useEditorStore((state) => state.selectObject);
  const hoverObject = useEditorStore((state) => state.hoverObject);

  const isSelected = selectedId === placement.id;
  const isHovered = hoveredId === placement.id;

  const color = placement.materialOverrides?.color || '#4f46e5';
  const roughness = placement.materialOverrides?.roughness ?? 0.7;
  const metalness = placement.materialOverrides?.metalness ?? 0.1;
  const [width, height, depth] = placement.dimensions;

  const handleClick = (e: any) => {
    e.stopPropagation();
    selectObject(placement.id);
  };

  const handlePointerOver = (e: any) => {
    e.stopPropagation();
    hoverObject(placement.id);
  };

  const handlePointerOut = () => {
    hoverObject(null);
  };

  // Render stylized procedural geometry as native mesh or fallback
  const renderProceduralGeometry = () => {
    if (placement.assetId.includes('sofa')) {
      return (
        <group>
          {/* Main Seat Base */}
          <mesh position={[0, -height * 0.25, 0]} castShadow receiveShadow>
            <boxGeometry args={[width * 0.95, height * 0.3, depth * 0.85]} />
            <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
          </mesh>

          {/* Cushions */}
          {[-width * 0.28, 0, width * 0.28].map((x, i) => (
            <mesh key={`cushion-${i}`} position={[x, -height * 0.05, depth * 0.05]} castShadow>
              <boxGeometry args={[width * 0.27, height * 0.18, depth * 0.65]} />
              <meshStandardMaterial color={color} roughness={0.6} />
            </mesh>
          ))}
          {/* Backrest */}
          <mesh position={[0, height * 0.2, -depth * 0.3]} castShadow>
            <boxGeometry args={[width * 0.95, height * 0.6, depth * 0.25]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          {/* Left Armrest */}
          <mesh position={[-width * 0.44, 0.05, 0]} castShadow>
            <boxGeometry args={[width * 0.12, height * 0.5, depth * 0.85]} />
            <meshStandardMaterial color={color} roughness={0.65} />
          </mesh>
          {/* Right Armrest */}
          <mesh position={[width * 0.44, 0.05, 0]} castShadow>
            <boxGeometry args={[width * 0.12, height * 0.5, depth * 0.85]} />
            <meshStandardMaterial color={color} roughness={0.65} />
          </mesh>
          {/* Wooden Legs */}
          {[
            [-width * 0.4, -height * 0.45, -depth * 0.35],
            [width * 0.4, -height * 0.45, -depth * 0.35],
            [-width * 0.4, -height * 0.45, depth * 0.35],
            [width * 0.4, -height * 0.45, depth * 0.35],
          ].map(([lx, ly, lz], i) => (
            <mesh key={`leg-${i}`} position={[lx, ly, lz]} castShadow>
              <cylinderGeometry args={[0.03, 0.02, height * 0.15, 12]} />
              <meshStandardMaterial color="#451a03" roughness={0.5} metalness={0.1} />
            </mesh>
          ))}
        </group>
      );
    }

    if (placement.assetId.includes('table')) {
      return (
        <group>
          {/* Tabletop */}
          <mesh position={[0, height * 0.4, 0]} castShadow receiveShadow>
            <boxGeometry args={[width, height * 0.1, depth]} />
            <meshStandardMaterial color={color} roughness={0.4} />
          </mesh>
          {/* Table Legs */}
          {[
            [-width * 0.42, -height * 0.05, -depth * 0.42],
            [width * 0.42, -height * 0.05, -depth * 0.42],
            [-width * 0.42, -height * 0.05, depth * 0.42],
            [width * 0.42, -height * 0.05, depth * 0.42],
          ].map(([lx, ly, lz], i) => (
            <mesh key={`leg-${i}`} position={[lx, ly, lz]} castShadow>
              <cylinderGeometry args={[0.025, 0.02, height * 0.85, 12]} />
              <meshStandardMaterial color="#292524" roughness={0.6} metalness={0.2} />
            </mesh>
          ))}
        </group>
      );
    }

    if (placement.assetId.includes('desk')) {
      return (
        <group>
          {/* Desktop Board */}
          <mesh position={[0, height * 0.45, 0]} castShadow receiveShadow>
            <boxGeometry args={[width, height * 0.08, depth]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
          {/* Metal Side Frames */}
          <mesh position={[-width * 0.45, -0.05, 0]} castShadow>
            <boxGeometry args={[0.05, height * 0.9, depth * 0.9]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.7} />
          </mesh>
          <mesh position={[width * 0.45, -0.05, 0]} castShadow>
            <boxGeometry args={[0.05, height * 0.9, depth * 0.9]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.7} />
          </mesh>
          {/* Crossbar */}
          <mesh position={[0, -0.15, -depth * 0.35]} castShadow>
            <boxGeometry args={[width * 0.85, 0.04, 0.04]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.7} />
          </mesh>
        </group>
      );
    }

    if (placement.assetId.includes('chair')) {
      return (
        <group>
          {/* Seat Cushion */}
          <mesh position={[0, -height * 0.1, 0]} castShadow>
            <boxGeometry args={[width * 0.85, height * 0.25, depth * 0.8]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          {/* Backrest */}
          <mesh position={[0, height * 0.25, -depth * 0.3]} castShadow>
            <boxGeometry args={[width * 0.8, height * 0.55, depth * 0.2]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          {/* Wooden Angled Legs */}
          {[
            [-width * 0.35, -height * 0.35, -depth * 0.3],
            [width * 0.35, -height * 0.35, -depth * 0.3],
            [-width * 0.35, -height * 0.35, depth * 0.3],
            [width * 0.35, -height * 0.35, depth * 0.3],
          ].map(([lx, ly, lz], i) => (
            <mesh key={`leg-${i}`} position={[lx, ly, lz]} rotation={[0, 0, (lx < 0 ? 1 : -1) * 0.1]} castShadow>
              <cylinderGeometry args={[0.025, 0.015, height * 0.35, 12]} />
              <meshStandardMaterial color="#78350f" roughness={0.5} />
            </mesh>
          ))}
        </group>
      );
    }

    // Default: Bookshelf / Storage
    return (
      <group>
        {/* Outer Frame */}
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
        {/* Shelves cutout styling */}
        {[-height * 0.3, -height * 0.1, height * 0.1, height * 0.3].map((y, i) => (
          <mesh key={`shelf-${i}`} position={[0, y, depth * 0.05]} castShadow>
            <boxGeometry args={[width * 0.9, 0.03, depth * 0.9]} />
            <meshStandardMaterial color="#475569" roughness={0.5} />
          </mesh>
        ))}
      </group>
    );
  };

  const catalogItem = SAMPLE_CATALOG.find((item) => item.id === placement.assetId);

  // Render GLB asset if available with automatic procedural geometry fallback
  const renderFurniture = () => {
    if (catalogItem?.modelUrl) {
      return (
        <ModelErrorBoundary fallback={renderProceduralGeometry()}>
          <Suspense fallback={renderProceduralGeometry()}>
            <GLTFModel
              url={catalogItem.modelUrl}
              color={color}
              roughness={roughness}
              metalness={metalness}
            />
          </Suspense>
        </ModelErrorBoundary>
      );
    }
    return renderProceduralGeometry();
  };

  return (
    <group
      ref={groupRef}
      position={placement.position}
      rotation={placement.rotationEuler}
      scale={placement.scale}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {renderFurniture()}

      {/* Selection & Hover Wireframe / Glow Highlight */}
      {(isSelected || isHovered) && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[width * 1.05, height * 1.05, depth * 1.05]} />
          <meshBasicMaterial
            color={isSelected ? '#6366f1' : '#a5b4fc'}
            wireframe
            transparent
            opacity={isSelected ? 0.9 : 0.4}
          />
        </mesh>
      )}

      {/* Selection Base Indicator Disc */}
      {isSelected && (
        <mesh position={[0, -height / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.1, Math.max(width, depth) * 0.65, 32]} />
          <meshBasicMaterial color="#6366f1" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
};
