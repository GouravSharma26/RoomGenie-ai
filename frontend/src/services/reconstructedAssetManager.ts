/**
 * Reconstructed Asset Lifecycle Manager
 * 
 * Manages the lifecycle of private, authenticated GLB blob URLs created
 * during photo-to-3D reconstructions.
 * 
 * Key Responsibilities:
 * 1. Reference Tracking: Prevents premature revocation when a model is placed in the room.
 * 2. Automatic Cleanup: Revokes blob URLs via URL.revokeObjectURL when all owners
 *    (modal previews, room placements) have released them.
 * 3. In-flight Race Safety: Tracks pending owners while fetch is in-flight. If a placement
 *    is deleted, cleared, or replaced before fetch resolves, the obsolete owner is discarded
 *    and the blob URL is revoked if no valid owners remain.
 * 4. Request De-duplication: Ensures concurrent requests for the same reconstruction job
 *    only perform a single authenticated API call, without breaking other waiting placements
 *    if one placement is cancelled.
 * 5. Persistence Hydration: Automatically fetches private GLBs when restoring scenes
 *    with stable reconstructionJobId references.
 */

import { fetchReconstructedModelBlobUrl } from './photoTo3dApi';

export interface ActiveAsset {
  jobId: string;
  blobUrl: string;
  owners: Set<string>;
}

export interface PreviewLease {
  blobUrl: string;
  ownerId: string;
  release: () => void;
}

export class FetchCancelledError extends Error {
  constructor(ownerId: string, jobId: string) {
    super(`Fetch cancelled for owner ${ownerId} on job ${jobId}`);
    this.name = 'FetchCancelledError';
  }
}

class ReconstructedAssetManager {
  private activeAssetsByJob = new Map<string, ActiveAsset>();
  private pendingOwnersByJob = new Map<string, Set<string>>();
  private inFlightFetches = new Map<string, Promise<string>>();

  /**
   * Registers an existing blob URL for a reconstruction job and registers an owner.
   */
  public registerBlobUrl(jobId: string, blobUrl: string, ownerId: string): string {
    const existing = this.activeAssetsByJob.get(jobId);
    if (existing) {
      existing.owners.add(ownerId);
      // If a different redundant blob URL was provided for the same job, revoke the redundant one
      if (existing.blobUrl !== blobUrl && blobUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // Ignore in non-browser/test environments
        }
      }
      return existing.blobUrl;
    }

    const newAsset: ActiveAsset = {
      jobId,
      blobUrl,
      owners: new Set([ownerId]),
    };
    this.activeAssetsByJob.set(jobId, newAsset);
    return blobUrl;
  }

  /**
   * Acquires a temporary preview lease for the Photo-to-3D modal.
   * When released, if no room placement has claimed the job, the URL is revoked.
   */
  public acquirePreview(jobId: string, blobUrl: string): PreviewLease {
    const ownerId = `preview:${jobId}:${Date.now()}:${Math.random().toString(36).substring(2, 7)}`;
    const effectiveUrl = this.registerBlobUrl(jobId, blobUrl, ownerId);
    return {
      blobUrl: effectiveUrl,
      ownerId,
      release: () => {
        this.releaseOwner(jobId, ownerId);
      },
    };
  }

  /**
   * Registers a room canvas placement as an owner of a reconstructed model.
   */
  public claimForPlacement(jobId: string, placementId: string, fallbackBlobUrl?: string): string | null {
    const existing = this.activeAssetsByJob.get(jobId);
    if (existing) {
      existing.owners.add(placementId);
      return existing.blobUrl;
    }

    if (fallbackBlobUrl) {
      return this.registerBlobUrl(jobId, fallbackBlobUrl, placementId);
    }

    return null;
  }

  /**
   * Releases an owner's claim on a job's blob URL.
   * Removes from pending fetches if still in-flight, or from active owners if resolved.
   * If active owners count drops to 0, revokes the blob URL and purges it from cache.
   */
  public releaseOwner(jobId: string, ownerId: string): boolean {
    // 1. Remove from pending owners if in-flight
    const pending = this.pendingOwnersByJob.get(jobId);
    if (pending) {
      pending.delete(ownerId);
    }

    // 2. Remove from active owners if resolved
    const asset = this.activeAssetsByJob.get(jobId);
    if (!asset) return false;

    asset.owners.delete(ownerId);
    if (asset.owners.size === 0) {
      if (asset.blobUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(asset.blobUrl);
        } catch {
          // Ignore in test environments
        }
      }
      this.activeAssetsByJob.delete(jobId);
      return true; // Revoked
    }

    return false;
  }

  /**
   * Releases all claims held by a specific placement ID (e.g. when an item is deleted
   * or cleared, whether active or pending in-flight).
   */
  public releasePlacement(placementId: string): void {
    // Remove from all pending fetches
    for (const pendingSet of this.pendingOwnersByJob.values()) {
      pendingSet.delete(placementId);
    }

    // Remove from all active assets
    const jobsToCheck = Array.from(this.activeAssetsByJob.keys());
    for (const jobId of jobsToCheck) {
      const asset = this.activeAssetsByJob.get(jobId);
      if (asset && asset.owners.has(placementId)) {
        this.releaseOwner(jobId, placementId);
      }
    }
  }

  /**
   * Releases multiple placement IDs (e.g. on clearScene or loadScene).
   */
  public releasePlacements(placementIds: string[]): void {
    for (const pid of placementIds) {
      this.releasePlacement(pid);
    }
  }

  /**
   * Fetches or retrieves the model URL for a given job.
   * De-duplicates concurrent fetches so only 1 network request is made.
   * Ensures cancellation safety: if the placement is removed before the fetch resolves,
   * it throws FetchCancelledError and does not retain the asset.
   */
  public async fetchOrGetModelUrl(jobId: string, ownerId: string): Promise<string> {
    // 1. Check if already cached in active assets
    const existing = this.activeAssetsByJob.get(jobId);
    if (existing) {
      existing.owners.add(ownerId);
      return existing.blobUrl;
    }

    // 2. Register owner in pendingOwnersByJob
    let pending = this.pendingOwnersByJob.get(jobId);
    if (!pending) {
      pending = new Set<string>();
      this.pendingOwnersByJob.set(jobId, pending);
    }
    pending.add(ownerId);

    // 3. Get or initiate the shared fetch promise
    let fetchPromise = this.inFlightFetches.get(jobId);
    if (!fetchPromise) {
      fetchPromise = this.executeFetch(jobId);
      this.inFlightFetches.set(jobId, fetchPromise);
    }

    const blobUrl = await fetchPromise;

    // 4. Verify whether this specific owner is still valid after awaiting
    const isNowActive = this.activeAssetsByJob.get(jobId)?.owners.has(ownerId);
    if (!isNowActive) {
      throw new FetchCancelledError(ownerId, jobId);
    }

    return blobUrl;
  }

  /**
   * Internal worker executing the network fetch and handling post-fetch resolution.
   */
  private async executeFetch(jobId: string): Promise<string> {
    try {
      const blobUrl = await fetchReconstructedModelBlobUrl(jobId);

      // Snapshot valid pending owners at time of resolution
      const pending = this.pendingOwnersByJob.get(jobId);
      const validOwners = pending ? Array.from(pending) : [];

      // Check if another concurrent operation already registered an active asset (e.g. preview)
      const existingActive = this.activeAssetsByJob.get(jobId);
      if (existingActive) {
        for (const owner of validOwners) {
          existingActive.owners.add(owner);
        }
        if (existingActive.blobUrl !== blobUrl && blobUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            // Ignore
          }
        }
        return existingActive.blobUrl;
      }

      // If no valid owners remain, revoke the newly fetched URL immediately
      if (validOwners.length === 0) {
        if (blobUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            // Ignore
          }
        }
        return blobUrl;
      }

      // Register active asset with only valid non-cancelled owners
      this.activeAssetsByJob.set(jobId, {
        jobId,
        blobUrl,
        owners: new Set(validOwners),
      });

      return blobUrl;
    } finally {
      this.inFlightFetches.delete(jobId);
      this.pendingOwnersByJob.delete(jobId);
    }
  }

  /**
   * Returns active blob URL for a job if currently loaded in memory.
   */
  public getUrlForJob(jobId: string): string | null {
    return this.activeAssetsByJob.get(jobId)?.blobUrl || null;
  }

  /**
   * Returns list of owners for a job (for inspection/testing).
   */
  public getOwnersForJob(jobId: string): string[] {
    const asset = this.activeAssetsByJob.get(jobId);
    return asset ? Array.from(asset.owners) : [];
  }

  /**
   * Returns pending owner IDs for a job still in-flight (for inspection/testing).
   */
  public getPendingOwnersForJob(jobId: string): string[] {
    const pending = this.pendingOwnersByJob.get(jobId);
    return pending ? Array.from(pending) : [];
  }

  /**
   * Returns whether a fetch is currently in-flight for a job.
   */
  public hasPendingFetch(jobId: string): boolean {
    return this.inFlightFetches.has(jobId);
  }

  /**
   * Returns number of active assets in memory.
   */
  public getActiveAssetCount(): number {
    return this.activeAssetsByJob.size;
  }

  /**
   * Releases all assets and revokes all active blob URLs (e.g., test cleanup or app unmount).
   */
  public releaseAll(): void {
    this.pendingOwnersByJob.clear();
    this.inFlightFetches.clear();

    for (const asset of this.activeAssetsByJob.values()) {
      if (asset.blobUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(asset.blobUrl);
        } catch {
          // Ignore
        }
      }
    }
    this.activeAssetsByJob.clear();
  }
}

export const reconstructedAssetManager = new ReconstructedAssetManager();
