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
 * 3. Request De-duplication: Ensures concurrent requests for the same reconstruction job
 *    only perform a single authenticated API call.
 * 4. Persistence Hydration: Automatically fetches private GLBs when restoring scenes
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

class ReconstructedAssetManager {
  private activeAssetsByJob = new Map<string, ActiveAsset>();
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
   * If owners count drops to 0, revokes the blob URL and purges it from cache.
   */
  public releaseOwner(jobId: string, ownerId: string): boolean {
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
   * Releases all claims held by a specific placement ID (e.g. when an item is deleted).
   */
  public releasePlacement(placementId: string): void {
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
   */
  public async fetchOrGetModelUrl(jobId: string, ownerId: string): Promise<string> {
    const existing = this.activeAssetsByJob.get(jobId);
    if (existing) {
      existing.owners.add(ownerId);
      return existing.blobUrl;
    }

    const inFlight = this.inFlightFetches.get(jobId);
    if (inFlight) {
      const url = await inFlight;
      const cached = this.activeAssetsByJob.get(jobId);
      if (cached) {
        cached.owners.add(ownerId);
      }
      return url;
    }

    const fetchPromise = (async () => {
      try {
        const blobUrl = await fetchReconstructedModelBlobUrl(jobId);
        return this.registerBlobUrl(jobId, blobUrl, ownerId);
      } finally {
        this.inFlightFetches.delete(jobId);
      }
    })();

    this.inFlightFetches.set(jobId, fetchPromise);
    return fetchPromise;
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
   * Returns number of active assets in memory.
   */
  public getActiveAssetCount(): number {
    return this.activeAssetsByJob.size;
  }

  /**
   * Releases all assets and revokes all active blob URLs (e.g., test cleanup or app unmount).
   */
  public releaseAll(): void {
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
    this.inFlightFetches.clear();
  }
}

export const reconstructedAssetManager = new ReconstructedAssetManager();
