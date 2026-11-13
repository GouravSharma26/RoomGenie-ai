import { cellIndex, gridToWorldCenter, worldToGrid } from './gridCoordinates';
import type { CellCoordinate } from './occupancyTypes';
import type { NavigationPath, PathfindingOptions, WalkabilityCostGrid } from './walkabilityTypes';

/**
 * Min-Heap Priority Queue for A* search.
 */
class MinHeap<T> {
  private heap: { item: T; priority: number }[] = [];

  push(item: T, priority: number) {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].item;
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.heap.length;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parentIdx = (index - 1) >> 1;
      if (this.heap[index].priority >= this.heap[parentIdx].priority) break;
      const tmp = this.heap[index];
      this.heap[index] = this.heap[parentIdx];
      this.heap[parentIdx] = tmp;
      index = parentIdx;
    }
  }

  private sinkDown(index: number) {
    const length = this.heap.length;
    while (true) {
      let smallest = index;
      const leftChild = (index << 1) + 1;
      const rightChild = leftChild + 1;

      if (leftChild < length && this.heap[leftChild].priority < this.heap[smallest].priority) {
        smallest = leftChild;
      }
      if (rightChild < length && this.heap[rightChild].priority < this.heap[smallest].priority) {
        smallest = rightChild;
      }
      if (smallest === index) break;

      const tmp = this.heap[index];
      this.heap[index] = this.heap[smallest];
      this.heap[smallest] = tmp;
      index = smallest;
    }
  }
}

/**
 * Octile heuristic distance for 8-connected grid.
 */
function octileDistance(c1: number, r1: number, c2: number, r2: number, resolution: number): number {
  const dx = Math.abs(c1 - c2);
  const dr = Math.abs(r1 - r2);
  const min = Math.min(dx, dr);
  const max = Math.max(dx, dr);
  return (min * Math.SQRT2 + (max - min)) * resolution;
}

/**
 * Tests 2D line of sight between two grid coordinates.
 * Returns true if the straight line between them does not intersect any blocked cells.
 */
export function hasLineOfSight(
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  costGrid: WalkabilityCostGrid
): boolean {
  const { dimensions, classifications } = costGrid;
  let x0 = c0;
  let y0 = r0;
  const dx = Math.abs(c1 - x0);
  const dy = Math.abs(r1 - y0);
  const sx = x0 < c1 ? 1 : -1;
  const sy = y0 < r1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (x0 < 0 || x0 >= dimensions.numCols || y0 < 0 || y0 >= dimensions.numRows) {
      return false;
    }
    const idx = cellIndex(x0, y0, dimensions.numCols);
    if (classifications[idx] === 'blocked' || classifications[idx] === 'out_of_bounds') {
      return false;
    }

    if (x0 === c1 && y0 === r1) break;

    const e2 = 2 * err;
    const stepX = e2 > -dy;
    const stepY = e2 < dx;

    if (stepX && stepY) {
      // Stepping diagonally: verify orthogonal corner cells to prevent cutting corners
      const corner1 = cellIndex(x0 + sx, y0, dimensions.numCols);
      const corner2 = cellIndex(x0, y0 + sy, dimensions.numCols);
      if (
        classifications[corner1] === 'blocked' ||
        classifications[corner2] === 'blocked' ||
        classifications[corner1] === 'out_of_bounds' ||
        classifications[corner2] === 'out_of_bounds'
      ) {
        return false;
      }
    }

    if (stepX) {
      err -= dy;
      x0 += sx;
    }
    if (stepY) {
      err += dx;
      y0 += sy;
    }
  }

  return true;
}

/**
 * Finds the nearest walkable cell to a target location within a search radius.
 */
export function findNearestWalkableCell(
  targetWorld: [number, number],
  costGrid: WalkabilityCostGrid,
  maxRadiusMeters: number = 2.0
): CellCoordinate | null {
  const { dimensions, classifications, config } = costGrid;
  const startCoord = worldToGrid(targetWorld[0], targetWorld[1], dimensions);
  const radiusCells = Math.ceil(maxRadiusMeters / config.resolution);

  if (startCoord) {
    const startIdx = cellIndex(startCoord.col, startCoord.row, dimensions.numCols);
    if (
      classifications[startIdx] !== 'blocked' &&
      classifications[startIdx] !== 'out_of_bounds'
    ) {
      return startCoord;
    }
  }

  const baseCol = startCoord ? startCoord.col : Math.floor(dimensions.numCols / 2);
  const baseRow = startCoord ? startCoord.row : Math.floor(dimensions.numRows / 2);

  let bestCoord: CellCoordinate | null = null;
  let bestDistSq = Infinity;

  for (let r = -radiusCells; r <= radiusCells; r++) {
    for (let c = -radiusCells; c <= radiusCells; c++) {
      const curCol = baseCol + c;
      const curRow = baseRow + r;
      if (curCol < 0 || curCol >= dimensions.numCols || curRow < 0 || curRow >= dimensions.numRows) {
        continue;
      }
      const idx = cellIndex(curCol, curRow, dimensions.numCols);

      if (classifications[idx] !== 'blocked' && classifications[idx] !== 'out_of_bounds') {
        const center = gridToWorldCenter(curCol, curRow, dimensions);
        const distSq =
          (center[0] - targetWorld[0]) ** 2 + (center[1] - targetWorld[1]) ** 2;

        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestCoord = { col: curCol, row: curRow };
        }
      }
    }
  }

  return bestCoord;
}

/**
 * Executes A* pathfinding on the WalkabilityCostGrid.
 */
export function findPath(
  startWorld: [number, number],
  goalWorld: [number, number],
  costGrid: WalkabilityCostGrid,
  options: PathfindingOptions = {}
): NavigationPath {
  const { dimensions, config, costs, classifications } = costGrid;
  const { allowRestricted = true, smoothPath = true, maxCost = 1500 } = options;

  // Resolve start and goal coordinates
  let startCoord = worldToGrid(startWorld[0], startWorld[1], dimensions);
  let goalCoord = worldToGrid(goalWorld[0], goalWorld[1], dimensions);

  // If start is blocked or out of bounds, find nearest walkable cell
  if (!startCoord || classifications[cellIndex(startCoord.col, startCoord.row, dimensions.numCols)] === 'blocked') {
    const adjusted = findNearestWalkableCell(startWorld, costGrid, 1.5);
    if (!adjusted) {
      return {
        start: startWorld,
        goal: goalWorld,
        found: false,
        gridPath: [],
        worldPath: [],
        lengthMeters: 0,
        traversalCost: Infinity,
        traversesRestricted: false,
      };
    }
    startCoord = adjusted;
  }

  // If goal is inside a furniture body or out of bounds, find nearest walkable cell around perimeter
  if (!goalCoord || classifications[cellIndex(goalCoord.col, goalCoord.row, dimensions.numCols)] === 'blocked') {
    const adjusted = findNearestWalkableCell(goalWorld, costGrid, 2.0);
    if (!adjusted) {
      return {
        start: startWorld,
        goal: goalWorld,
        found: false,
        gridPath: [],
        worldPath: [],
        lengthMeters: 0,
        traversalCost: Infinity,
        traversesRestricted: false,
      };
    }
    goalCoord = adjusted;
  }

  const startId = cellIndex(startCoord.col, startCoord.row, dimensions.numCols);
  const goalId = cellIndex(goalCoord.col, goalCoord.row, dimensions.numCols);

  // 8-neighbor directions: [dCol, dRow, distanceStep]
  const sqrt2 = Math.SQRT2;
  const directions = [
    [0, -1, 1.0],  // North
    [1, 0, 1.0],   // East
    [0, 1, 1.0],   // South
    [-1, 0, 1.0],  // West
    [1, -1, sqrt2],  // North-East
    [1, 1, sqrt2],   // South-East
    [-1, 1, sqrt2],  // South-West
    [-1, -1, sqrt2], // North-West
  ];

  const totalCells = dimensions.numCols * dimensions.numRows;
  const gScore = new Float32Array(totalCells).fill(Infinity);
  const cameFrom = new Int32Array(totalCells).fill(-1);
  const inClosedSet = new Uint8Array(totalCells);

  const openSet = new MinHeap<number>();

  gScore[startId] = 0;
  openSet.push(
    startId,
    octileDistance(startCoord.col, startCoord.row, goalCoord.col, goalCoord.row, config.resolution)
  );

  let goalReached = false;

  while (openSet.size > 0) {
    const currentId = openSet.pop()!;

    if (currentId === goalId) {
      goalReached = true;
      break;
    }

    if (inClosedSet[currentId]) continue;
    inClosedSet[currentId] = 1;

    const currentG = gScore[currentId];
    if (currentG > maxCost) continue;

    const curCol = currentId % dimensions.numCols;
    const curRow = Math.floor(currentId / dimensions.numCols);

    for (const [dc, dr, weight] of directions) {
      const nCol = curCol + dc;
      const nRow = curRow + dr;

      if (nCol < 0 || nCol >= dimensions.numCols || nRow < 0 || nRow >= dimensions.numRows) {
        continue;
      }

      const neighborId = nRow * dimensions.numCols + nCol;
      if (inClosedSet[neighborId]) continue;

      const neighborClass = classifications[neighborId];
      if (neighborClass === 'blocked' || neighborClass === 'out_of_bounds') {
        continue;
      }

      if (!allowRestricted && neighborClass === 'restricted') {
        continue;
      }

      // CORNER-CUTTING PREVENTION:
      // If moving diagonally, both adjacent orthogonal cells must not be blocked
      if (dc !== 0 && dr !== 0) {
        const orth1 = cellIndex(curCol + dc, curRow, dimensions.numCols);
        const orth2 = cellIndex(curCol, curRow + dr, dimensions.numCols);
        if (
          classifications[orth1] === 'blocked' ||
          classifications[orth2] === 'blocked'
        ) {
          continue; // Diagonal cuts through corner of obstacle
        }
      }

      const cellCost = costs[neighborId];
      const tentativeG = currentG + weight * config.resolution * cellCost;

      if (tentativeG < gScore[neighborId]) {
        cameFrom[neighborId] = currentId;
        gScore[neighborId] = tentativeG;
        const h = octileDistance(nCol, nRow, goalCoord.col, goalCoord.row, config.resolution);
        openSet.push(neighborId, tentativeG + h);
      }
    }
  }

  if (!goalReached) {
    return {
      start: startWorld,
      goal: goalWorld,
      found: false,
      gridPath: [],
      worldPath: [],
      lengthMeters: 0,
      traversalCost: Infinity,
      traversesRestricted: false,
    };
  }

  // Reconstruct path
  const rawGridPath: CellCoordinate[] = [];
  let curr = goalId;
  let traversesRestricted = false;

  while (curr !== -1) {
    const col = curr % dimensions.numCols;
    const row = Math.floor(curr / dimensions.numCols);
    rawGridPath.push({ col, row });
    if (classifications[curr] === 'restricted') {
      traversesRestricted = true;
    }
    curr = cameFrom[curr];
  }
  rawGridPath.reverse();

  // Convert to world coordinates
  let worldWaypoints: [number, number][] = rawGridPath.map((coord) =>
    gridToWorldCenter(coord.col, coord.row, dimensions)
  );

  // Line-of-sight Path Smoothing (String pulling)
  if (smoothPath && rawGridPath.length > 2) {
    const smoothed: [number, number][] = [worldWaypoints[0]];
    const smoothedGrid: CellCoordinate[] = [rawGridPath[0]];

    let anchorIdx = 0;
    while (anchorIdx < rawGridPath.length - 1) {
      let furthest = anchorIdx + 1;
      for (let testIdx = rawGridPath.length - 1; testIdx > anchorIdx + 1; testIdx--) {
        if (
          hasLineOfSight(
            rawGridPath[anchorIdx].col,
            rawGridPath[anchorIdx].row,
            rawGridPath[testIdx].col,
            rawGridPath[testIdx].row,
            costGrid
          )
        ) {
          furthest = testIdx;
          break;
        }
      }
      smoothed.push(worldWaypoints[furthest]);
      smoothedGrid.push(rawGridPath[furthest]);
      anchorIdx = furthest;
    }

    worldWaypoints = smoothed;
  }

  // Calculate physical length
  let lengthMeters = 0;
  for (let i = 1; i < worldWaypoints.length; i++) {
    const p1 = worldWaypoints[i - 1];
    const p2 = worldWaypoints[i];
    lengthMeters += Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  }

  return {
    start: startWorld,
    goal: goalWorld,
    found: true,
    gridPath: rawGridPath,
    worldPath: worldWaypoints,
    lengthMeters: Number(lengthMeters.toFixed(3)),
    traversalCost: Number(gScore[goalId].toFixed(2)),
    traversesRestricted,
  };
}
