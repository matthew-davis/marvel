import type { GraphData, GraphNode, GraphEdgeData } from './types';

export async function loadGraphData(): Promise<GraphData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/graph.json`);
  if (!res.ok) throw new Error(`Failed to load graph.json: ${res.status} ${res.statusText}`);
  return res.json();
}

export interface AdjacencyIndex {
  nodesById: Map<string, GraphNode>;
  neighbors: Map<string, Set<string>>;
  edgesByPairKey: Map<string, GraphEdgeData>;
}

export function buildAdjacencyIndex(nodes: GraphNode[], edges: GraphEdgeData[]): AdjacencyIndex {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const neighbors = new Map<string, Set<string>>();
  const edgesByPairKey = new Map<string, GraphEdgeData>();

  for (const node of nodes) neighbors.set(node.id, new Set());

  for (const edge of edges) {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
    edgesByPairKey.set(`${edge.source}::${edge.target}`, edge);
  }

  return { nodesById, neighbors, edgesByPairKey };
}
