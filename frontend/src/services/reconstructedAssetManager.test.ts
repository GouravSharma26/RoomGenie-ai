import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reconstructedAssetManager } from './reconstructedAssetManager';
import * as photoTo3dApi from './photoTo3dApi';
import { useEditorStore } from '../editor3d/store/editorStore';
import { serializeCanonicalScene, parseCanonicalScene } from '../editor3d/validation/sceneValidation';
import type { CanonicalScene } from '../types/scene';

vi.mock('./photoTo3dApi', () => ({
  fetchReconstructedModelBlobUrl: vi.fn(),
}));

describe('reconstructedAssetManager Lifecycle & Regressions', () => {
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
    });
  });

  afterEach(() => {
    revokeSpy.mockRestore();
    reconstructedAssetManager.releaseAll();
  });

  it('cancelling before placement cleans up temporary preview URLs immediately', () => {
    const jobId = 'job-cancel-test';
    const blobUrl = 'blob:http://localhost/temp-preview-glb';

    // 1. Modal acquires preview lease
    const lease = reconstructedAssetManager.acquirePreview(jobId, blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);
    expect(reconstructedAssetManager.getUrlForJob(jobId)).toBe(blobUrl);

    // 2. User cancels / closes modal without placing
    lease.release();

    // 3. Verify URL was immediately revoked and asset purged
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
    expect(reconstructedAssetManager.getUrlForJob(jobId)).toBeNull();
  });

  it('placing a reconstructed model and closing the modal does not revoke the model URL', () => {
    const jobId = 'job-placed-test';
    const blobUrl = 'blob:http://localhost/persistent-model-glb';

    // 1. Modal acquires preview lease
    const lease = reconstructedAssetManager.acquirePreview(jobId, blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);

    // 2. User places model into room canvas
    const placementId = useEditorStore.getState().addCustomPlacement({
      assetId: 'custom-seating',
      name: 'Modern Reconstructed Armchair',
      dimensions: [0.9, 0.85, 0.85],
      modelUrl: blobUrl,
      reconstructionJobId: jobId,
    });

    // Verify placement now owns the model
    expect(reconstructedAssetManager.getOwnersForJob(jobId)).toContain(placementId);

    // 3. Modal unmounts and releases its preview lease
    lease.release();

    // 4. Verify URL was NOT revoked because the placement still owns it
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);
    expect(reconstructedAssetManager.getUrlForJob(jobId)).toBe(blobUrl);

    // Verify the placed furniture object retains access to the model URL
    const placedItem = useEditorStore.getState().scene.objects.find((o) => o.id === placementId);
    expect(placedItem).toBeDefined();
    expect(placedItem?.modelUrl).toBe(blobUrl);
    expect(placedItem?.reconstructionJobId).toBe(jobId);
  });

  it('deleting the placed furniture releases its resources and revokes the URL', () => {
    const jobId = 'job-delete-test';
    const blobUrl = 'blob:http://localhost/model-to-delete-glb';

    // 1. Place custom model
    const placementId = useEditorStore.getState().addCustomPlacement({
      assetId: 'custom-table',
      name: 'Custom Oak Table',
      dimensions: [1.2, 0.45, 0.6],
      modelUrl: blobUrl,
      reconstructionJobId: jobId,
    });

    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);

    // 2. Delete the placement from room
    useEditorStore.getState().deleteObject(placementId);

    // 3. Verify resource was released and revoked
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
  });

  it('handles duplicated placements with reference counting so deleting one does not break the other', () => {
    const jobId = 'job-duplicate-test';
    const blobUrl = 'blob:http://localhost/duplicated-chair-glb';

    // 1. Place initial model
    const initialId = useEditorStore.getState().addCustomPlacement({
      assetId: 'custom-chair',
      name: 'Nordic Chair',
      dimensions: [0.6, 0.8, 0.6],
      modelUrl: blobUrl,
      reconstructionJobId: jobId,
    });

    useEditorStore.getState().selectObject(initialId);

    // 2. Duplicate selected model
    useEditorStore.getState().duplicateSelected();
    const objects = useEditorStore.getState().scene.objects;
    expect(objects.length).toBe(2);

    const duplicateId = objects.find((o) => o.id !== initialId)!.id;
    const owners = reconstructedAssetManager.getOwnersForJob(jobId);
    expect(owners).toContain(initialId);
    expect(owners).toContain(duplicateId);

    // 3. Delete the first item
    useEditorStore.getState().deleteObject(initialId);

    // URL must NOT be revoked yet because duplicateId is still in the room
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);

    // 4. Delete the duplicated item
    useEditorStore.getState().deleteObject(duplicateId);

    // Now all owners are gone -> URL must be revoked
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
  });

  it('scene clear revokes all placed reconstruction resources', () => {
    const url1 = 'blob:http://localhost/item1-glb';
    const url2 = 'blob:http://localhost/item2-glb';

    useEditorStore.getState().addCustomPlacement({
      assetId: 'custom-1',
      name: 'Item 1',
      dimensions: [1, 1, 1],
      modelUrl: url1,
      reconstructionJobId: 'job-1',
    });

    useEditorStore.getState().addCustomPlacement({
      assetId: 'custom-2',
      name: 'Item 2',
      dimensions: [1, 1, 1],
      modelUrl: url2,
      reconstructionJobId: 'job-2',
    });

    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(2);

    // Clear entire scene
    useEditorStore.getState().clearScene();

    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith(url1);
    expect(revokeSpy).toHaveBeenCalledWith(url2);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
  });

  it('scene serialization strips ephemeral blob: URLs while retaining stable reconstructionJobId', () => {
    const activeBlobUrl = 'blob:http://localhost/ephemeral-session-glb';
    const testScene: CanonicalScene = {
      schemaVersion: 1,
      unit: 'm',
      room: { width: 5.0, length: 4.0, height: 2.8 },
      objects: [
        {
          id: 'test-reconstruction',
          assetId: 'custom-armchair',
          name: 'Leather Armchair',
          dimensions: [0.9, 0.85, 0.85],
          position: [0, 0.425, 0],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
          modelUrl: activeBlobUrl,
          reconstructionJobId: 'job-stable-uuid-999',
          isCustomReconstruction: true,
        },
      ],
    };

    // Serialize scene
    const serializedJson = serializeCanonicalScene(testScene);
    // Ephemeral blob URL must not be persisted to disk/DB
    expect(serializedJson).not.toContain('blob:');
    expect(serializedJson).toContain('job-stable-uuid-999');

    // Parse back
    const restoredScene = parseCanonicalScene(serializedJson);
    expect(restoredScene).not.toBeNull();
    const restoredObj = restoredScene!.objects[0];
    expect(restoredObj.reconstructionJobId).toBe('job-stable-uuid-999');
    expect(restoredObj.isCustomReconstruction).toBe(true);
    expect(restoredObj.modelUrl).toBeUndefined();
  });

  it('de-duplicates concurrent fetch requests for the same reconstruction job', async () => {
    const jobId = 'job-concurrency-test';
    const resolvedBlobUrl = 'blob:http://localhost/concurrent-model-glb';

    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(resolvedBlobUrl), 50))
    );

    // Initiate two simultaneous fetches
    const promise1 = reconstructedAssetManager.fetchOrGetModelUrl(jobId, 'placement-a');
    const promise2 = reconstructedAssetManager.fetchOrGetModelUrl(jobId, 'placement-b');

    const [url1, url2] = await Promise.all([promise1, promise2]);

    expect(url1).toBe(resolvedBlobUrl);
    expect(url2).toBe(resolvedBlobUrl);

    // fetchReconstructedModelBlobUrl should have only been invoked ONCE
    expect(photoTo3dApi.fetchReconstructedModelBlobUrl).toHaveBeenCalledTimes(1);
    expect(photoTo3dApi.fetchReconstructedModelBlobUrl).toHaveBeenCalledWith(jobId);

    // Both placements are registered owners
    const owners = reconstructedAssetManager.getOwnersForJob(jobId);
    expect(owners).toContain('placement-a');
    expect(owners).toContain('placement-b');
  });

  it('cleans up previous preview when a new preview is generated without placement', () => {
    const job1 = 'job-preview-1';
    const url1 = 'blob:http://localhost/preview1-glb';
    const job2 = 'job-preview-2';
    const url2 = 'blob:http://localhost/preview2-glb';

    // 1. First preview
    const lease1 = reconstructedAssetManager.acquirePreview(job1, url1);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);

    // 2. User reconfigures and generates second model (releasing first)
    lease1.release();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(url1);

    const lease2 = reconstructedAssetManager.acquirePreview(job2, url2);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);
    expect(reconstructedAssetManager.getUrlForJob(job2)).toBe(url2);

    lease2.release();
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith(url2);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
  });
});
