import React, { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEditorStore } from '../store/editorStore';

export const ViewportControls: React.FC = () => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const cameraResetNonce = useEditorStore((state) => state.cameraResetNonce);
  const viewMode = useEditorStore((state) => state.viewMode);
  const room = useEditorStore((state) => state.scene.room);

  // Reset Camera action when cameraResetNonce changes
  useEffect(() => {
    if (!controlsRef.current) return;

    if (viewMode === 'top') {
      camera.position.set(0, Math.max(room.width, room.length) * 1.6, 0.001);
      camera.lookAt(0, 0, 0);
      controlsRef.current.target.set(0, 0, 0);
    } else {
      const dist = Math.max(room.width, room.length) * 1.2;
      camera.position.set(dist * 0.7, dist * 0.7, dist * 0.9);
      camera.lookAt(0, room.height * 0.3, 0);
      controlsRef.current.target.set(0, room.height * 0.2, 0);
    }
    controlsRef.current.update();
  }, [cameraResetNonce, viewMode, camera, room]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={1.5}
      maxDistance={35}
      maxPolarAngle={Math.PI / 2 - 0.02} // Prevent camera going below floor
      minPolarAngle={0.05}
    />
  );
};
