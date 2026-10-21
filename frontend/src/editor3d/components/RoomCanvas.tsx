import React, { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { RoomEnvironment } from './RoomEnvironment';
import { FurnitureItem } from './FurnitureItem';
import { ViewportControls } from './ViewportControls';
import { useEditorStore } from '../store/editorStore';

export const RoomCanvas: React.FC = () => {
  const objects = useEditorStore((state) => state.scene.objects);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const selectObject = useEditorStore((state) => state.selectObject);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      } else if (e.key === 'Escape') {
        selectObject(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useEditorStore.getState().redo();
        } else {
          useEditorStore.getState().undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useEditorStore.getState().redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, selectObject]);

  return (
    <div className="w-full h-full relative select-none bg-radial from-[#131926] via-[#0b0e17] to-[#06080d]">
      <Canvas
        shadows
        camera={{ position: [5, 4.5, 6], fov: 45 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#0a0d14']} />
        
        {/* Architectural Lighting */}
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[6, 9, 5]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={0.5}
          shadow-camera-far={25}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
        />
        <pointLight position={[-4, 4, -4]} intensity={0.4} color="#a5b4fc" />

        <Suspense fallback={null}>
          <RoomEnvironment />
          {objects.map((obj) => (
            <FurnitureItem key={obj.id} placement={obj} />
          ))}
          <ViewportControls />
        </Suspense>
      </Canvas>
    </div>
  );
};
