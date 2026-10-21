import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useEditorStore } from '../editor3d/store/editorStore';
import { reconstructedAssetManager } from '../services/reconstructedAssetManager';
import * as photoTo3dApi from '../services/photoTo3dApi';
import * as designApi from '../services/designApi';
import { FurnitureItem } from '../editor3d/components/FurnitureItem';
import type { FurniturePlacement } from '../types/scene';

// Mock Three.js / R3F Canvas components for jsdom
vi.mock('@react-three/drei', () => ({
  useGLTF: vi.fn(() => ({
    scene: {
      clone: () => ({
        position: { y: 0 },
        traverse: () => {},
      }),
    },
  })),
}));

vi.mock('../services/photoTo3dApi', () => ({
  fetchReconstructedModelBlobUrl: vi.fn(),
}));

describe('Reconstruction End-to-End Asset Lifecycle', () => {
  let revokeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    reconstructedAssetManager.releaseAll();
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    useEditorStore.setState({
      scene: {
        schemaVersion: 1,
        unit: 'm',
        room: { width: 5.0, length: 4.0, height: 2.8 },
        objects: [],
      },
      selectedId: null,
    });
  });

  afterEach(() => {
    revokeSpy.mockRestore();
    reconstructedAssetManager.releaseAll();
  });

  it('executes full end-to-end lifecycle: place model -> save -> reload -> hydrate -> duplicate -> delete both', async () => {
    const jobId = 'job-e2e-persistent-uuid';
    const initialBlobUrl = 'blob:http://localhost/session1-active-blob';
    const rehydratedBlobUrl = 'blob:http://localhost/session2-rehydrated-blob';

    // 1. PLACE RECONSTRUCTED MODEL
    const placementId1 = useEditorStore.getState().addCustomPlacement({
      assetId: 'custom-accent-chair',
      name: 'Custom Velvet Armchair',
      dimensions: [0.9, 0.85, 0.85],
      modelUrl: initialBlobUrl,
      reconstructionJobId: jobId,
      isCustomReconstruction: true,
    });

    let currentScene = useEditorStore.getState().scene;
    expect(currentScene.objects.length).toBe(1);
    expect(currentScene.objects[0].id).toBe(placementId1);
    expect(currentScene.objects[0].reconstructionJobId).toBe(jobId);
    expect(currentScene.objects[0].modelUrl).toBe(initialBlobUrl);
    expect(reconstructedAssetManager.getOwnersForJob(jobId)).toContain(placementId1);

    // 2. SAVE DESIGN TO BACKEND
    // Verify that saving to the backend strips ephemeral blob: URLs while retaining reconstructionJobId
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'design-e2e-123',
        title: 'Penthouse Living Room',
        scene_json: {
          schemaVersion: 1,
          unit: 'm',
          room: { width: 5.0, length: 4.0, height: 2.8 },
          objects: [
            {
              id: placementId1,
              assetId: 'custom-accent-chair',
              name: 'Custom Velvet Armchair',
              dimensions: [0.9, 0.85, 0.85],
              position: [0, 0.425, 0],
              rotationEuler: [0, 0, 0],
              scale: [1, 1, 1],
              reconstructionJobId: jobId,
              isCustomReconstruction: true,
            },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('roomgenie_auth_token', 'mock-test-token');

    const savedRecord = await designApi.saveDesignToBackend('Penthouse Living Room', currentScene);
    expect(savedRecord.id).toBe('design-e2e-123');

    // Inspect the actual JSON payload transmitted across the wire
    const lastCallBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(lastCallBody.scene_json.objects[0].reconstructionJobId).toBe(jobId);
    expect(lastCallBody.scene_json.objects[0].modelUrl).toBeUndefined(); // ephemeral blob URL stripped

    // 3. RESET / CLEAR SCENE (simulating leaving editor or page reload)
    useEditorStore.getState().clearScene();
    expect(useEditorStore.getState().scene.objects.length).toBe(0);
    expect(revokeSpy).toHaveBeenCalledWith(initialBlobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);

    // 4. RELOAD SAVED DESIGN FROM BACKEND
    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockResolvedValue(rehydratedBlobUrl);

    useEditorStore.getState().loadScene(savedRecord.scene_json);
    expect(useEditorStore.getState().scene.objects.length).toBe(1);

    const loadedObj: FurniturePlacement = useEditorStore.getState().scene.objects[0];
    expect(loadedObj.reconstructionJobId).toBe(jobId);
    expect(loadedObj.modelUrl).toBeUndefined(); // Needs hydration

    // 5. HYDRATE VIA FURNITURE ITEM COMPONENT
    // Mounting FurnitureItem triggers automatic authenticated streaming hydration
    const { unmount } = render(<FurnitureItem placement={loadedObj} />);

    await waitFor(() => {
      const activeObj = useEditorStore.getState().scene.objects[0];
      expect(activeObj.modelUrl).toBe(rehydratedBlobUrl);
    });

    expect(photoTo3dApi.fetchReconstructedModelBlobUrl).toHaveBeenCalledWith(jobId);
    expect(reconstructedAssetManager.getUrlForJob(jobId)).toBe(rehydratedBlobUrl);
    expect(reconstructedAssetManager.getOwnersForJob(jobId)).toContain(loadedObj.id);

    // 6. DUPLICATE PLACED MODEL
    useEditorStore.getState().selectObject(loadedObj.id);
    useEditorStore.getState().duplicateSelected();

    currentScene = useEditorStore.getState().scene;
    expect(currentScene.objects.length).toBe(2);

    const copy1 = currentScene.objects[0];
    const copy2 = currentScene.objects[1];
    expect(copy1.id).not.toBe(copy2.id);
    expect(copy2.reconstructionJobId).toBe(jobId);
    expect(copy2.modelUrl).toBe(rehydratedBlobUrl);

    // Asset manager now tracks both placement IDs for the same active blob URL
    const owners = reconstructedAssetManager.getOwnersForJob(jobId);
    expect(owners).toContain(copy1.id);
    expect(owners).toContain(copy2.id);

    // 7. DELETE FIRST COPY
    revokeSpy.mockClear();
    useEditorStore.getState().deleteObject(copy1.id);

    currentScene = useEditorStore.getState().scene;
    expect(currentScene.objects.length).toBe(1);
    expect(currentScene.objects[0].id).toBe(copy2.id);

    // Model URL must NOT be revoked yet because copy2 is still placed!
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);
    expect(reconstructedAssetManager.getOwnersForJob(jobId)).toEqual([copy2.id]);

    // 8. DELETE SECOND COPY (ALL COPIES REMOVED)
    useEditorStore.getState().deleteObject(copy2.id);

    currentScene = useEditorStore.getState().scene;
    expect(currentScene.objects.length).toBe(0);

    // Now all copies are deleted -> URL MUST be revoked and asset purged
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(rehydratedBlobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
    expect(reconstructedAssetManager.getUrlForJob(jobId)).toBeNull();

    // 9. CLEAN RE-SAVE CONFIRMATION
    const updatedRecord = await designApi.saveDesignToBackend('Penthouse Living Room Cleaned', currentScene);
    expect(updatedRecord).toBeDefined();

    unmount();
    vi.unstubAllGlobals();
  });
});
