import type { SpatialSocketDefinition } from './relationshipTypes';
import { CANONICAL_SOCKET_DEFINITIONS } from './socketDefinitions';

/**
 * Socket Registry providing queries for furniture sockets and semantic compatibility checks.
 */
export class SocketRegistry {
  private definitions: Map<string, SpatialSocketDefinition>;

  constructor(customDefinitions: SpatialSocketDefinition[] = CANONICAL_SOCKET_DEFINITIONS) {
    this.definitions = new Map();
    for (const def of customDefinitions) {
      this.definitions.set(def.id, def);
    }
  }

  /**
   * Retrieves all available sockets exposed by an anchor furniture asset.
   * Unsupported furniture returns an empty array (no fabricated sockets).
   */
  public getSocketsForAsset(assetId: string, category?: string): SpatialSocketDefinition[] {
    const assetSockets: SpatialSocketDefinition[] = [];
    for (const def of this.definitions.values()) {
      if (def.anchorAssetId && def.anchorAssetId === assetId) {
        assetSockets.push(def);
      } else if (!def.anchorAssetId && category && def.anchorCategory === category) {
        assetSockets.push(def);
      }
    }
    return assetSockets;
  }

  /**
   * Looks up a specific socket definition by ID.
   */
  public getSocketDefinition(socketId: string): SpatialSocketDefinition | undefined {
    return this.definitions.get(socketId);
  }

  /**
   * Evaluates whether a candidate child furniture item is semantically compatible with a socket.
   * Checks category compatibility and optional style tag overlap.
   */
  public isCompatibleWithSocket(
    socket: SpatialSocketDefinition,
    childCategory: string,
    childTags: string[] = []
  ): boolean {
    if (!socket.allowedCategories.includes(childCategory)) {
      return false;
    }

    if (socket.allowedAssetTags && socket.allowedAssetTags.length > 0) {
      const hasMatchingTag = socket.allowedAssetTags.some((tag) => childTags.includes(tag));
      if (!hasMatchingTag) {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns all registered socket definitions.
   */
  public getAllDefinitions(): SpatialSocketDefinition[] {
    return Array.from(this.definitions.values());
  }
}

export const defaultSocketRegistry = new SocketRegistry();
