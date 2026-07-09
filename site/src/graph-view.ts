import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import * as THREE from 'three';
import type { GraphData, GraphNode, LinkObject } from './types';
import { imagePath } from './types';
import { buildAdjacencyIndex, type AdjacencyIndex } from './data';
import { loadNodeTexture, glowTexture } from './textures';

const COLOR_MOVIE = '#e8384f';
const COLOR_PERSON = '#7b61ff';
const COLOR_ACCENT = '#00d9ff';

const SPHERE_RADIUS = { movie: 5.2, person: 3.6 };
const SCALE = { focused: 1.6, connected: 1.25 };
const CAMERA_FOCUS_DISTANCE = 160;

// Point-cloud sizes for the background field (everything not focused or
// connected) - tuned smaller than the old per-node glow sprites since these
// just need to read as a glowing dot cluster, not bear individual detail.
const POINT_SIZE = { movie: 14, person: 9.5 };
const POINT_OPACITY = { base: 0.85, dimmed: 0.1 };
const LINK_OPACITY = { base: 0.25, dimmed: 0.06 };
const LINK_COLOR = 0x9a97ab;

const sharedGeometry = new THREE.SphereGeometry(1, 16, 16);

interface NodeVisual {
  group: THREE.Group;
  sphere: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  baseColor: THREE.Color;
  baseScale: number;
  textureApplied: boolean;
}

type FocusState = {
  focusedId: string | null;
  connectedIds: Set<string>;
};

export class GraphView {
  private graph: ForceGraph3DInstance;
  private adjacency: AdjacencyIndex;
  private nodeVisuals = new Map<string, NodeVisual>();
  private state: FocusState = { focusedId: null, connectedIds: new Set() };
  private reducedMotion: boolean;
  private onFocusChange: (node: GraphNode | null) => void;

  // The background field (thousands of nodes, not currently focused or
  // connected) is rendered as two batched THREE.Points clouds instead of
  // individual meshes - a handful of draw calls total instead of one per
  // node. Only the small focused+connected set gets a real per-node
  // THREE.Group (see buildNodeObject/nodeVisuals), which is what actually
  // needs individual scale/texture/opacity control.
  private moviePoints!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private personPoints!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private moviePointIndex = new Map<string, number>();
  private personPointIndex = new Map<string, number>();

  // Same idea for links: 3d-force-graph renders every link as its own
  // individual Line object as soon as a per-link accessor (linkColor, in our
  // case) is used, which at ~34k edges was actually the dominant draw-call
  // cost - far more than the nodes. Batch all edges into one LineSegments for
  // the default/dimmed look, and let the library only render the handful of
  // links actually touching the current focus (with its particle effect).
  private backgroundLinks!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  constructor(container: HTMLElement, data: GraphData, onFocusChange: (node: GraphNode | null) => void) {
    this.onFocusChange = onFocusChange;
    this.adjacency = buildAdjacencyIndex(data.nodes, data.edges);
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.graph = new ForceGraph3D(container, {
      rendererConfig: { alpha: true, antialias: true },
    })
      .backgroundColor('rgba(0,0,0,0)')
      .graphData({
        nodes: data.nodes as unknown as object[],
        links: data.edges.map((e) => ({ ...e })) as unknown as object[],
      })
      .nodeThreeObject((node: object) => this.buildNodeObject(node as GraphNode))
      .nodeThreeObjectExtend(false)
      .nodeLabel((node: object) => this.labelFor(node as GraphNode))
      .linkWidth(0.6)
      .linkColor((link: object) => this.linkColor(link as LinkObject))
      .linkDirectionalParticles((link: object) => this.linkParticleCount(link as LinkObject))
      .linkDirectionalParticleWidth(2.2)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleColor(() => COLOR_ACCENT)
      .linkVisibility((link: object) => this.isActiveLink(link as LinkObject))
      .nodeVisibility((node: object) => this.isVisibleNode(node as GraphNode))
      .onNodeClick((node: object) => this.focusNode((node as GraphNode).id))
      .onBackgroundClick(() => this.clearFocus())
      .onEngineTick(() => this.syncPositions())
      .onEngineStop(() => this.syncPositions())
      .cooldownTicks(150);

    this.buildPointClouds(data.nodes);
    this.buildLinkBatch(data.edges.length);
    // Nothing was visible before this (fresh load), so the diff against an
    // empty previous set just applies the initial (all-dimmed) state.
    this.applyFocusTransition(new Set());

    const controls = this.graph.controls() as unknown as {
      autoRotate: boolean;
      autoRotateSpeed: number;
    };
    controls.autoRotate = !this.reducedMotion;
    controls.autoRotateSpeed = 0.35;
  }

  private makePointCloud(
    count: number,
    color: string,
    size: number
  ): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const material = new THREE.PointsMaterial({
      map: glowTexture(color),
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: POINT_OPACITY.base,
      depthWrite: false,
      // Normal (not additive) blending - the point cloud is each node's
      // primary color identity now, not just a halo layered over a solid
      // sphere like the old per-node glow sprite. Additive blending washed
      // out to solid white in dense clusters where thousands of points
      // overlap; normal blending keeps the red/purple hue visible there.
      blending: THREE.NormalBlending,
    });
    const points = new THREE.Points(geometry, material);
    // Positions start at the origin and only get filled in via
    // syncPositions() once the simulation runs; recomputing a bounding
    // sphere from that stale all-zero buffer would wrongly frustum-cull the
    // whole cloud once the camera moves away from the origin. These objects
    // represent the entire graph and are cheap regardless, so just disable
    // culling for them.
    points.frustumCulled = false;
    return points;
  }

  private buildPointClouds(nodes: GraphNode[]) {
    const movieNodes = nodes.filter((n) => n.type === 'movie');
    const personNodes = nodes.filter((n) => n.type === 'person');

    movieNodes.forEach((n, i) => this.moviePointIndex.set(n.id, i));
    personNodes.forEach((n, i) => this.personPointIndex.set(n.id, i));

    this.moviePoints = this.makePointCloud(movieNodes.length, COLOR_MOVIE, POINT_SIZE.movie);
    this.personPoints = this.makePointCloud(personNodes.length, COLOR_PERSON, POINT_SIZE.person);

    this.graph.scene().add(this.moviePoints);
    this.graph.scene().add(this.personPoints);
  }

  private buildLinkBatch(edgeCount: number) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeCount * 2 * 3), 3));
    const material = new THREE.LineBasicMaterial({
      color: LINK_COLOR,
      transparent: true,
      opacity: LINK_OPACITY.base,
      depthWrite: false,
    });
    this.backgroundLinks = new THREE.LineSegments(geometry, material);
    this.backgroundLinks.frustumCulled = false;
    this.graph.scene().add(this.backgroundLinks);
  }

  private syncPositions() {
    const { nodes, links } = this.graph.graphData() as unknown as {
      nodes: (GraphNode & { x?: number; y?: number; z?: number })[];
      links: LinkObject[];
    };
    const moviePos = this.moviePoints.geometry.attributes.position.array as Float32Array;
    const personPos = this.personPoints.geometry.attributes.position.array as Float32Array;

    for (const node of nodes) {
      const { x = 0, y = 0, z = 0 } = node;
      const index = node.type === 'movie' ? this.moviePointIndex.get(node.id) : this.personPointIndex.get(node.id);
      if (index === undefined) continue;
      const arr = node.type === 'movie' ? moviePos : personPos;
      arr[index * 3] = x;
      arr[index * 3 + 1] = y;
      arr[index * 3 + 2] = z;
    }

    this.moviePoints.geometry.attributes.position.needsUpdate = true;
    this.personPoints.geometry.attributes.position.needsUpdate = true;

    const linkPos = this.backgroundLinks.geometry.attributes.position.array as Float32Array;
    links.forEach((link, i) => {
      const s = link.source as unknown as { x?: number; y?: number; z?: number };
      const t = link.target as unknown as { x?: number; y?: number; z?: number };
      linkPos[i * 6] = s.x ?? 0;
      linkPos[i * 6 + 1] = s.y ?? 0;
      linkPos[i * 6 + 2] = s.z ?? 0;
      linkPos[i * 6 + 3] = t.x ?? 0;
      linkPos[i * 6 + 4] = t.y ?? 0;
      linkPos[i * 6 + 5] = t.z ?? 0;
    });
    this.backgroundLinks.geometry.attributes.position.needsUpdate = true;
  }

  private labelFor(node: GraphNode): string {
    return node.type === 'movie' ? `${node.title} (${node.year})` : node.name;
  }

  private buildNodeObject(node: GraphNode): THREE.Group {
    // nodeVisibility (see constructor) means this is only ever invoked by
    // 3d-force-graph for a node that's currently focused or a direct
    // connection - the thousands of background nodes never get an Object3D
    // at all, so there's nothing for the renderer to draw calls on or for
    // raycasting to traverse for them. We know which case this is right now,
    // so set the correct scale immediately rather than waiting for a
    // separate reconciliation pass.
    const baseColor = new THREE.Color(node.type === 'movie' ? COLOR_MOVIE : COLOR_PERSON);
    const radius = SPHERE_RADIUS[node.type];
    const isFocused = node.id === this.state.focusedId;
    const scaleFactor = isFocused ? SCALE.focused : SCALE.connected;

    const material = new THREE.MeshBasicMaterial({
      color: baseColor.clone(),
      transparent: true,
      opacity: 1,
    });
    const sphere = new THREE.Mesh(sharedGeometry, material);
    sphere.scale.setScalar(radius * scaleFactor);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(node.type === 'movie' ? COLOR_MOVIE : COLOR_PERSON),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    glow.scale.setScalar(radius * 4.2 * scaleFactor);

    const group = new THREE.Group();
    group.add(glow);
    group.add(sphere);

    this.nodeVisuals.set(node.id, {
      group,
      sphere,
      material,
      glow,
      baseColor,
      baseScale: radius,
      textureApplied: false,
    });

    this.applyFocusTexture(node.id);

    return group;
  }

  private async applyFocusTexture(nodeId: string) {
    const node = this.adjacency.nodesById.get(nodeId);
    const visual = this.nodeVisuals.get(nodeId);
    if (!node || !visual || visual.textureApplied) return;

    const texture = await loadNodeTexture(imagePath(node));
    if (!texture) return;

    visual.material.map = texture;
    visual.material.color.set(0xffffff);
    visual.material.needsUpdate = true;
    visual.textureApplied = true;
  }

  private isActiveLink(link: LinkObject): boolean {
    const { focusedId, connectedIds } = this.state;
    if (!focusedId) return false;
    return (
      (link.source.id === focusedId && connectedIds.has(link.target.id)) ||
      (link.target.id === focusedId && connectedIds.has(link.source.id))
    );
  }

  private isVisibleNode(node: GraphNode): boolean {
    return node.id === this.state.focusedId || this.state.connectedIds.has(node.id);
  }

  private currentVisibleIds(): Set<string> {
    const ids = new Set(this.state.connectedIds);
    if (this.state.focusedId) ids.add(this.state.focusedId);
    return ids;
  }

  private linkColor(link: LinkObject): string {
    return this.isActiveLink(link) ? 'rgba(0, 217, 255, 0.9)' : 'rgba(154, 151, 171, 0.06)';
  }

  private linkParticleCount(link: LinkObject): number {
    return this.isActiveLink(link) ? 2 : 0;
  }

  // Applies a state transition: diffs the visible-node set (previousIds must
  // be captured by the caller before mutating this.state), tells
  // force-graph to create/reuse/dispose node & link objects accordingly, and
  // reconciles scale/texture for whatever ends up visible. A node that's
  // visible both before and after (e.g. a shared neighbor between the old
  // and new focus) has its object *reused* by force-graph rather than
  // recreated - buildNodeObject won't fire again for it, so its scale still
  // needs updating here explicitly.
  private applyFocusTransition(previousIds: Set<string>) {
    const nextIds = this.currentVisibleIds();
    for (const id of previousIds) {
      if (!nextIds.has(id)) this.nodeVisuals.delete(id);
    }

    this.graph.nodeVisibility((node: object) => this.isVisibleNode(node as GraphNode));
    this.graph.linkColor((link: object) => this.linkColor(link as LinkObject));
    this.graph.linkDirectionalParticles((link: object) => this.linkParticleCount(link as LinkObject));
    this.graph.linkVisibility((link: object) => this.isActiveLink(link as LinkObject));

    for (const id of nextIds) {
      const visual = this.nodeVisuals.get(id);
      if (!visual) continue;
      const isFocused = id === this.state.focusedId;
      const scaleFactor = isFocused ? SCALE.focused : SCALE.connected;
      visual.sphere.scale.setScalar(visual.baseScale * scaleFactor);
      visual.glow.scale.setScalar(visual.baseScale * 4.2 * scaleFactor);
      this.applyFocusTexture(id);
    }

    const dimmed = this.state.focusedId !== null;
    this.moviePoints.material.opacity = dimmed ? POINT_OPACITY.dimmed : POINT_OPACITY.base;
    this.personPoints.material.opacity = dimmed ? POINT_OPACITY.dimmed : POINT_OPACITY.base;
    this.backgroundLinks.material.opacity = dimmed ? LINK_OPACITY.dimmed : LINK_OPACITY.base;
  }

  focusNode(nodeId: string) {
    const node = this.adjacency.nodesById.get(nodeId);
    if (!node) return;

    const previousIds = this.currentVisibleIds();
    this.state = {
      focusedId: nodeId,
      connectedIds: this.adjacency.neighbors.get(nodeId) ?? new Set(),
    };
    this.applyFocusTransition(previousIds);

    const controls = this.graph.controls() as unknown as { autoRotate: boolean };
    controls.autoRotate = false;

    const graphNode = node as unknown as { x?: number; y?: number; z?: number };
    const { x = 0, y = 0, z = 0 } = graphNode;
    const distRatio = 1 + CAMERA_FOCUS_DISTANCE / Math.max(Math.hypot(x, y, z), 1);

    this.graph.cameraPosition(
      { x: x * distRatio, y: y * distRatio, z: z * distRatio },
      { x, y, z },
      this.reducedMotion ? 0 : 1200
    );

    this.onFocusChange(node);
  }

  clearFocus() {
    const previousIds = this.currentVisibleIds();
    this.state = { focusedId: null, connectedIds: new Set() };
    this.applyFocusTransition(previousIds);

    const controls = this.graph.controls() as unknown as { autoRotate: boolean };
    controls.autoRotate = !this.reducedMotion;

    this.onFocusChange(null);
  }

  getNode(nodeId: string): GraphNode | undefined {
    return this.adjacency.nodesById.get(nodeId);
  }

  getNeighbors(nodeId: string): GraphNode[] {
    const ids = this.adjacency.neighbors.get(nodeId);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.adjacency.nodesById.get(id))
      .filter((n): n is GraphNode => Boolean(n));
  }

  getEdge(nodeIdA: string, nodeIdB: string) {
    return (
      this.adjacency.edgesByPairKey.get(`${nodeIdA}::${nodeIdB}`) ??
      this.adjacency.edgesByPairKey.get(`${nodeIdB}::${nodeIdA}`)
    );
  }
}
