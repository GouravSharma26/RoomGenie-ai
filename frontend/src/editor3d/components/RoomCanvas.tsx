import React, { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { RoomEnvironment } from './RoomEnvironment';
import { FurnitureItem } from './FurnitureItem';
import { ViewportControls } from './ViewportControls';
import { AlignmentGuides } from './AlignmentGuides';
import { SocketOverlay } from './SocketOverlay';
import { RelationshipOverlay } from './RelationshipOverlay';
import { WalkabilityOverlay } from './WalkabilityOverlay';
import { PreviewViewportBanner } from './PreviewViewportBanner';
import { useEditorStore } from '../store/editorStore';
import { usePreviewStore } from '../store/previewStore';

export const RoomCanvas: React.FC = () => {
  const objects = useEditorStore((state) => state.scene.objects);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const selectObject = useEditorStore((state) => state.selectObject);

  const previewStatus = usePreviewStore((state) => state.status);
  const isPreviewActive = previewStatus === 'active' || previewStatus === 'switching';
  const previewScene = usePreviewStore((state) => state.previewScene);
  const exitPreview = usePreviewStore((state) => state.exitPreview);

  const displayedObjects = isPreviewActive && previewScene ? previewScene.objects : objects;

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'Escape') {
        if (usePreviewStore.getState().status === 'active') {
          exitPreview();
          return;
        }
        const storeState = useEditorStore.getState();
        if (storeState.activeGestureSnapshot) {
          storeState.cancelInteraction();
        } else if (storeState.selectedOpeningId) {
          storeState.selectOpening(null);
        } else if (storeState.selectedWallId) {
          storeState.selectWall(null);
        } else {
          selectObject(null);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (usePreviewStore.getState().status === 'active') return;
        const storeState = useEditorStore.getState();
        if (storeState.selectedOpeningId) {
          storeState.deleteWallOpening(storeState.selectedOpeningId);
        } else {
          deleteSelected();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (usePreviewStore.getState().status === 'active') return;
        if (e.shiftKey) {
          useEditorStore.getState().redo();
        } else {
          useEditorStore.getState().undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (usePreviewStore.getState().status === 'active') return;
        useEditorStore.getState().redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, selectObject, exitPreview]);

  return (
    <div className="w-full h-full relative select-none bg-radial from-[#131926] via-[#0b0e17] to-[#06080d]">
      <PreviewViewportBanner />
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
          {displayedObjects.map((obj) => {
            const isNew = isPreviewActive && !objects.some((c) => c.id === obj.id);
            return (
              <FurnitureItem
                key={obj.id}
                placement={obj}
                isPreview={isPreviewActive}
                isNewInPreview={isNew}
              />
            );
          })}
          <AlignmentGuides />
          <SocketOverlay />
          <RelationshipOverlay />
          <WalkabilityOverlay />
          <ViewportControls />
        </Suspense>
      </Canvas>
    </div>
  );
};
