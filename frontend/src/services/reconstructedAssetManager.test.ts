import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reconstructedAssetManager, FetchCancelledError } from './reconstructedAssetManager';
import * as photoTo3dApi from './photoTo3dApi';
import { useEditorStore } from '../editor3d/store/editorStore';
import { serializeCanonicalScene, parseCanonicalScene } from '../editor3d/validation/sceneValidation';
import type { CanonicalScene } from '../types/scene';

vi.mock('./photoTo3dApi', () => ({
  fetchReconstructedModelBlobUrl: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('reconstructedAssetManager Lifecycle & In-Flight Race Regressions', () => {
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

  // --- Synchronous Lifecycle & Store Integration ---

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

  // --- In-Flight Race Condition & Deferred Promise Regression Tests ---

  it('DETERMINISTIC RACE: delete a placement before its model fetch resolves', async () => {
    const jobId = 'job-deferred-delete';
    const blobUrl = 'blob:http://localhost/deferred-delete-glb';
    const deferred = createDeferred<string>();

    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockReturnValue(deferred.promise);

    // 1. Add placement to store
    const placementId = useEditorStore.getState().addCustomPlacement({
      assetId: 'custom-sofa',
      name: 'Modern Sofa',
      dimensions: [1.8, 0.8, 0.9],
      reconstructionJobId: jobId,
    });

    // 2. Start hydration fetch
    const fetchPromise = reconstructedAssetManager.fetchOrGetModelUrl(jobId, placementId);

    // Verify pending fetch tracking
    expect(reconstructedAssetManager.hasPendingFetch(jobId)).toBe(true);
    expect(reconstructedAssetManager.getPendingOwnersForJob(jobId)).toContain(placementId);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);

    // 3. User deletes the placement while fetch is still in-flight
    useEditorStore.getState().deleteObject(placementId);

    // Verify pending owner was cancelled
    expect(reconstructedAssetManager.getPendingOwnersForJob(jobId)).not.toContain(placementId);

    // 4. Resolve the network fetch
    deferred.resolve(blobUrl);

    // The fetch promise for the cancelled placement should throw FetchCancelledError
    await expect(fetchPromise).rejects.toThrow(FetchCancelledError);

    // 5. Verify the returned blob URL was immediately revoked and NOT cached in active assets
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
    expect(reconstructedAssetManager.getUrlForJob(jobId)).toBeNull();
  });

  it('DETERMINISTIC RACE: clear scene while hydration fetch is pending', async () => {
    const jobId = 'job-deferred-clear';
    const blobUrl = 'blob:http://localhost/deferred-clear-glb';
    const deferred = createDeferred<string>();

    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockReturnValue(deferred.promise);

    const pid1 = useEditorStore.getState().addCustomPlacement({
      assetId: 'item-1',
      name: 'Item 1',
      dimensions: [1, 1, 1],
      reconstructionJobId: jobId,
    });
    const pid2 = useEditorStore.getState().addCustomPlacement({
      assetId: 'item-2',
      name: 'Item 2',
      dimensions: [1, 1, 1],
      reconstructionJobId: jobId,
    });

    const promise1 = reconstructedAssetManager.fetchOrGetModelUrl(jobId, pid1);
    const promise2 = reconstructedAssetManager.fetchOrGetModelUrl(jobId, pid2);

    expect(reconstructedAssetManager.getPendingOwnersForJob(jobId)).toEqual(
      expect.arrayContaining([pid1, pid2])
    );

    // Clear entire scene while in-flight
    useEditorStore.getState().clearScene();

    expect(reconstructedAssetManager.getPendingOwnersForJob(jobId).length).toBe(0);

    deferred.resolve(blobUrl);

    await expect(promise1).rejects.toThrow(FetchCancelledError);
    await expect(promise2).rejects.toThrow(FetchCancelledError);

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
  });

  it('DETERMINISTIC RACE: loadScene (scene replace) while hydration fetch is pending', async () => {
    const jobId = 'job-deferred-replace';
    const blobUrl = 'blob:http://localhost/deferred-replace-glb';
    const deferred = createDeferred<string>();

    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockReturnValue(deferred.promise);

    const oldPid = useEditorStore.getState().addCustomPlacement({
      assetId: 'old-item',
      name: 'Old Item',
      dimensions: [1, 1, 1],
      reconstructionJobId: jobId,
    });

    const oldPromise = reconstructedAssetManager.fetchOrGetModelUrl(jobId, oldPid);

    // Replace scene with new scene containing no reconstructed items
    const freshScene: CanonicalScene = {
      schemaVersion: 1,
      unit: 'm',
      room: { width: 4.0, length: 4.0, height: 2.5 },
      objects: [],
    };
    useEditorStore.getState().loadScene(freshScene);

    expect(reconstructedAssetManager.getPendingOwnersForJob(jobId)).not.toContain(oldPid);

    deferred.resolve(blobUrl);

    await expect(oldPromise).rejects.toThrow(FetchCancelledError);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
  });

  it('DETERMINISTIC RACE: two placements share a fetch; delete one before resolution and verify the other still loads', async () => {
    const jobId = 'job-shared-race';
    const blobUrl = 'blob:http://localhost/shared-race-glb';
    const deferred = createDeferred<string>();

    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockReturnValue(deferred.promise);

    const pid1 = useEditorStore.getState().addCustomPlacement({
      assetId: 'shared-1',
      name: 'Shared 1',
      dimensions: [1, 1, 1],
      reconstructionJobId: jobId,
    });
    const pid2 = useEditorStore.getState().addCustomPlacement({
      assetId: 'shared-2',
      name: 'Shared 2',
      dimensions: [1, 1, 1],
      reconstructionJobId: jobId,
    });

    const promise1 = reconstructedAssetManager.fetchOrGetModelUrl(jobId, pid1);
    const promise2 = reconstructedAssetManager.fetchOrGetModelUrl(jobId, pid2);

    expect(photoTo3dApi.fetchReconstructedModelBlobUrl).toHaveBeenCalledTimes(1);
    expect(reconstructedAssetManager.getPendingOwnersForJob(jobId)).toEqual(
      expect.arrayContaining([pid1, pid2])
    );

    // Delete placement 1 before resolution
    useEditorStore.getState().deleteObject(pid1);

    expect(reconstructedAssetManager.getPendingOwnersForJob(jobId)).not.toContain(pid1);
    expect(reconstructedAssetManager.getPendingOwnersForJob(jobId)).toContain(pid2);

    // Resolve network fetch
    deferred.resolve(blobUrl);

    // Placement 1 was cancelled
    await expect(promise1).rejects.toThrow(FetchCancelledError);

    // Placement 2 successfully loads!
    const result2 = await promise2;
    expect(result2).toBe(blobUrl);

    // URL must NOT be revoked because placement 2 is an active owner
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);
    expect(reconstructedAssetManager.getOwnersForJob(jobId)).toEqual([pid2]);

    // When placement 2 is later deleted, resources are released and revoked
    useEditorStore.getState().deleteObject(pid2);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
  });

  it('DETERMINISTIC RACE: all waiting owners disappear before resolution; verify resulting URL is revoked and not cached', async () => {
    const jobId = 'job-all-disappear';
    const blobUrl = 'blob:http://localhost/disappeared-glb';
    const deferred = createDeferred<string>();

    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockReturnValue(deferred.promise);

    const pA = 'placement-a';
    const pB = 'placement-b';

    const promiseA = reconstructedAssetManager.fetchOrGetModelUrl(jobId, pA);
    const promiseB = reconstructedAssetManager.fetchOrGetModelUrl(jobId, pB);

    // Both disappear
    reconstructedAssetManager.releasePlacement(pA);
    reconstructedAssetManager.releasePlacement(pB);

    expect(reconstructedAssetManager.getPendingOwnersForJob(jobId).length).toBe(0);

    deferred.resolve(blobUrl);

    await expect(promiseA).rejects.toThrow(FetchCancelledError);
    await expect(promiseB).rejects.toThrow(FetchCancelledError);

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);
    expect(reconstructedAssetManager.hasPendingFetch(jobId)).toBe(false);
  });

  it('a later request for the same job still works cleanly after cancellation or failure', async () => {
    const jobId = 'job-retry-cleanly';
    const failDeferred = createDeferred<string>();

    // 1. Initial attempt fails with network error
    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockReturnValueOnce(failDeferred.promise);

    const failPromise = reconstructedAssetManager.fetchOrGetModelUrl(jobId, 'p-fail');
    failDeferred.reject(new Error('Simulated network timeout'));

    await expect(failPromise).rejects.toThrow('Simulated network timeout');

    // Verify in-flight maps and pending owners are completely clean
    expect(reconstructedAssetManager.hasPendingFetch(jobId)).toBe(false);
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(0);

    // 2. Second attempt succeeds
    const successDeferred = createDeferred<string>();
    vi.mocked(photoTo3dApi.fetchReconstructedModelBlobUrl).mockReturnValueOnce(successDeferred.promise);

    const successPromise = reconstructedAssetManager.fetchOrGetModelUrl(jobId, 'p-success');
    expect(reconstructedAssetManager.hasPendingFetch(jobId)).toBe(true);

    successDeferred.resolve('blob:http://localhost/retry-success-glb');
    const finalUrl = await successPromise;

    expect(finalUrl).toBe('blob:http://localhost/retry-success-glb');
    expect(reconstructedAssetManager.getActiveAssetCount()).toBe(1);
    expect(reconstructedAssetManager.getOwnersForJob(jobId)).toContain('p-success');
  });
});
