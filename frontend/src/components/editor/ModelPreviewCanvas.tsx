import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { RotateCcw } from 'lucide-react';

interface ModelPreviewProps {
  modelUrl?: string | null;
  dimensions: [number, number, number]; // [width, height, depth]
  color?: string;
  roughness?: number;
  metalness?: number;
  autoRotate?: boolean;
  onResetCamera?: () => void;
}

interface LoadedModelProps {
  url: string;
  color?: string;
  roughness?: number;
  metalness?: number;
  dimensions: [number, number, number];
}

const LoadedGLTFModel: React.FC<LoadedModelProps> = ({
  url,
  color,
  roughness = 0.6,
  metalness = 0.1,
  dimensions,
}) => {
  const { scene } = useGLTF(url);
  const [width, height, depth] = dimensions;

  const cloned = useMemo(() => {
    const clone = scene.clone(true);
    const bbox = new THREE.Box3().setFromObject(clone);

    // Compute original model size
    const origSize = new THREE.Vector3();
    bbox.getSize(origSize);

    // Rescale model to match user-adjusted dimensions if valid
    if (origSize.x > 0.001 && origSize.y > 0.001 && origSize.z > 0.001) {
      const scaleX = width / origSize.x;
      const scaleY = height / origSize.y;
      const scaleZ = depth / origSize.z;
      // Use uniform or axis-proportional scaling
      clone.scale.set(scaleX, scaleY, scaleZ);
    }

    // Align base to sit flush at Y = 0
    const updatedBbox = new THREE.Box3().setFromObject(clone);
    clone.position.y = -updatedBbox.min.y;

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
  }, [scene, color, roughness, metalness, width, height, depth]);

  return <primitive object={cloned} />;
};

const FallbackBox: React.FC<{
  dimensions: [number, number, number];
  color?: string;
  roughness?: number;
  metalness?: number;
}> = ({ dimensions, color = '#6366f1', roughness = 0.7, metalness = 0.1 }) => {
  const [width, height, depth] = dimensions;
  return (
    <group position={[0, height / 2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
      </mesh>
      <mesh>
        <boxGeometry args={[width * 1.01, height * 1.01, depth * 1.01]} />
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.15} />
      </mesh>
    </group>
  );
};

class PreviewErrorBoundary extends React.Component<
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

export const ModelPreviewCanvas: React.FC<ModelPreviewProps> = ({
  modelUrl,
  dimensions,
  color = '#6366f1',
  roughness = 0.6,
  metalness = 0.1,
  autoRotate = true,
}) => {
  const controlsRef = useRef<any>(null);
  const [width, height, depth] = dimensions;
  const maxDim = Math.max(width, height, depth, 1.0);
  const cameraDistance = maxDim * 2.2;

  const handleResetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  return (
    <div className="w-full h-full relative select-none rounded-xl overflow-hidden bg-gradient-to-b from-slate-950 via-[#0b0e17] to-slate-950 border border-slate-800">
      {/* Top Overlay Controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleResetCamera}
          className="p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700/60 backdrop-blur-sm transition"
          title="Reset Preview Camera Angle"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Orbit Helper Tag */}
      <div className="absolute bottom-3 left-3 z-10 pointer-events-none">
        <span className="text-[10px] text-slate-400 bg-slate-900/80 border border-slate-800/80 px-2 py-0.5 rounded-md backdrop-blur-sm font-mono">
          Drag to rotate &bull; Scroll to zoom
        </span>
      </div>

      <Canvas
        shadows
        camera={{ position: [cameraDistance * 0.8, cameraDistance * 0.7, cameraDistance], fov: 45 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.5} castShadow shadow-mapSize={512} />
        <pointLight position={[-4, 3, -4]} intensity={0.5} color="#818cf8" />

        <Suspense
          fallback={
            <FallbackBox
              dimensions={dimensions}
              color={color}
              roughness={roughness}
              metalness={metalness}
            />
          }
        >
          {modelUrl ? (
            <PreviewErrorBoundary
              fallback={
                <FallbackBox
                  dimensions={dimensions}
                  color={color}
                  roughness={roughness}
                  metalness={metalness}
                />
              }
            >
              <LoadedGLTFModel
                url={modelUrl}
                color={color}
                roughness={roughness}
                metalness={metalness}
                dimensions={dimensions}
              />
            </PreviewErrorBoundary>
          ) : (
            <FallbackBox
              dimensions={dimensions}
              color={color}
              roughness={roughness}
              metalness={metalness}
            />
          )}

          {/* Ground Contact Shadow / Grid Plane */}
          <gridHelper
            args={[Math.max(maxDim * 3, 4), 16, '#312e81', '#1e1b4b']}
            position={[0, 0, 0]}
          />
          <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[maxDim * 1.5, 32]} />
            <meshBasicMaterial color="#000000" transparent opacity={0.3} />
          </mesh>

          <OrbitControls
            ref={controlsRef}
            autoRotate={autoRotate}
            autoRotateSpeed={1.0}
            enableDamping
            dampingFactor={0.05}
            minDistance={0.5}
            maxDistance={maxDim * 5}
            maxPolarAngle={Math.PI / 2 + 0.05}
          />
        </Suspense>
      </Canvas>
    </div>
  );
};
