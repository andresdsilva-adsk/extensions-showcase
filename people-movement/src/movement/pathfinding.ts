import { IMPASSABLE } from "./types";

type HeapEntry = [number, number, number, number, number];

function swap(heap: HeapEntry[], i: number, j: number): void {
  const temp = heap[i];
  heap[i] = heap[j];
  heap[j] = temp;
}

function minHeapify(heap: HeapEntry[], i: number): void {
  const left = 2 * i + 1;
  const right = 2 * i + 2;
  let smallest = i;
  if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
  if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
  if (smallest !== i) {
    swap(heap, i, smallest);
    minHeapify(heap, smallest);
  }
}

function bubbleUp(heap: HeapEntry[], i: number): void {
  if (i === 0) return;
  const parent = Math.floor((i + 1) / 2) - 1;
  if (heap[parent][0] >= heap[i][0]) return;
  swap(heap, i, parent);
  bubbleUp(heap, parent);
}

function heapInsert(heap: HeapEntry[], cost: number, col: number, row: number): void {
  heap.push([cost, col, row, -1, -1]);
  bubbleUp(heap, heap.length - 1);
}

function heapRemove(heap: HeapEntry[]): HeapEntry | undefined {
  if (heap.length === 0) return undefined;
  swap(heap, 0, heap.length - 1);
  const head = heap.pop();
  minHeapify(heap, 0);
  return head;
}

const NEIGHBORS: ReadonlyArray<[number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

/**
 * Multi-source Dijkstra on a cost grid. Goals are seeded at cost 0; each step
 * adds the traversal cost of the destination cell (terrain, slope, roads, etc.).
 * Adapted from the Pathmaker extension's cost-field approach.
 */
export function dijkstraFromGoals(
  costGrid: number[][],
  goals: Array<{ col: number; row: number }>,
): number[][] {
  const nx = costGrid.length;
  const ny = costGrid[0]?.length ?? 0;
  const costs = Array.from({ length: nx }, () => Array<number>(ny).fill(-1));
  const heap: HeapEntry[] = [];

  for (const goal of goals) {
    if (goal.col < 0 || goal.col >= nx || goal.row < 0 || goal.row >= ny) continue;
    if (costGrid[goal.col][goal.row] >= IMPASSABLE) continue;
    heapInsert(heap, 0, goal.col, goal.row);
  }

  while (heap.length > 0) {
    const head = heapRemove(heap);
    if (!head) break;
    const [cost, col, row] = head;
    if (costs[col][row] !== -1) continue;
    costs[col][row] = cost;

    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= nx || nr < 0 || nr >= ny) continue;
      if (costs[nc][nr] !== -1) continue;
      const stepCost = costGrid[nc][nr];
      if (stepCost >= IMPASSABLE) continue;
      heapInsert(heap, cost + stepCost, nc, nr);
    }
  }

  return costs;
}
