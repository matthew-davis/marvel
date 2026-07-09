export interface MovieNode {
  id: string;
  type: 'movie';
  title: string;
  year: number;
  release_date: string | null;
  poster_path: string | null;
}

export interface PersonNode {
  id: string;
  type: 'person';
  name: string;
  profile_path: string | null;
}

export type GraphNode = MovieNode | PersonNode;

export interface CastRole {
  type: 'cast';
  character: string;
}

export interface CrewRole {
  type: 'crew';
  job: string;
  department: string;
}

export type Role = CastRole | CrewRole;

export interface GraphEdgeData {
  source: string;
  target: string;
  roles: Role[];
}

export interface GraphData {
  generated_at: string;
  nodes: GraphNode[];
  edges: GraphEdgeData[];
}

// 3d-force-graph replaces link.source/target (id strings) with direct node
// object references once graphData() runs, mirroring d3-force's behavior.
export interface LinkObject extends Omit<GraphEdgeData, 'source' | 'target'> {
  source: GraphNode;
  target: GraphNode;
}

export function displayName(node: GraphNode): string {
  return node.type === 'movie' ? node.title : node.name;
}

export function imagePath(node: GraphNode): string | null {
  return node.type === 'movie' ? node.poster_path : node.profile_path;
}
