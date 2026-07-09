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
const SCALE = { focused: 1.6, connected: 1.25, dimmed: 0.85, base: 1 };
const CAMERA_FOCUS_DISTANCE = 160;

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
      .onNodeClick((node: object) => this.focusNode((node as GraphNode).id))
      .onBackgroundClick(() => this.clearFocus())
      .cooldownTicks(150);

    const controls = this.graph.controls() as unknown as {
      autoRotate: boolean;
      autoRotateSpeed: number;
    };
    controls.autoRotate = !this.reducedMotion;
    controls.autoRotateSpeed = 0.35;
  }

  private labelFor(node: GraphNode): string {
    return node.type === 'movie' ? `${node.title} (${node.year})` : node.name;
  }

  private buildNodeObject(node: GraphNode): THREE.Group {
    const baseColor = new THREE.Color(node.type === 'movie' ? COLOR_MOVIE : COLOR_PERSON);
    const radius = SPHERE_RADIUS[node.type];

    const material = new THREE.MeshBasicMaterial({
      color: baseColor.clone(),
      transparent: true,
      opacity: 1,
    });
    const sphere = new THREE.Mesh(sharedGeometry, material);
    sphere.scale.setScalar(radius);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(node.type === 'movie' ? COLOR_MOVIE : COLOR_PERSON),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    glow.scale.setScalar(radius * 4.2);

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

  private linkColor(link: LinkObject): string {
    const { focusedId, connectedIds } = this.state;
    if (!focusedId) return 'rgba(154, 151, 171, 0.25)';

    const isActive =
      (link.source.id === focusedId && connectedIds.has(link.target.id)) ||
      (link.target.id === focusedId && connectedIds.has(link.source.id));

    return isActive ? 'rgba(0, 217, 255, 0.9)' : 'rgba(154, 151, 171, 0.06)';
  }

  private linkParticleCount(link: LinkObject): number {
    const { focusedId, connectedIds } = this.state;
    if (!focusedId) return 0;
    const touchesFocus =
      (link.source.id === focusedId && connectedIds.has(link.target.id)) ||
      (link.target.id === focusedId && connectedIds.has(link.source.id));
    return touchesFocus ? 2 : 0;
  }

  private refreshLinkVisuals() {
    // Re-invoking these accessors forces force-graph to recompute per-link
    // materials/particles against the latest focus state.
    this.graph.linkColor((link: object) => this.linkColor(link as LinkObject));
    this.graph.linkDirectionalParticles((link: object) => this.linkParticleCount(link as LinkObject));
  }

  private applyNodeVisualState() {
    const { focusedId, connectedIds } = this.state;

    for (const [id, visual] of this.nodeVisuals) {
      const isFocused = id === focusedId;
      const isConnected = connectedIds.has(id) && !isFocused;
      const isDimmed = focusedId !== null && !isFocused && !isConnected;

      let scaleFactor = SCALE.base;
      let opacity = 1;
      const color = visual.baseColor.clone();

      if (isFocused) {
        scaleFactor = SCALE.focused;
        opacity = 1;
        this.applyFocusTexture(id);
      } else if (isConnected) {
        scaleFactor = SCALE.connected;
        opacity = 1;
        this.applyFocusTexture(id);
      } else if (isDimmed) {
        scaleFactor = SCALE.dimmed;
        opacity = 0.18;
        const hsl = { h: 0, s: 0, l: 0 };
        color.getHSL(hsl);
        color.setHSL(hsl.h, hsl.s * 0.35, hsl.l * 0.55);
      }

      visual.sphere.scale.setScalar(visual.baseScale * scaleFactor);
      visual.glow.scale.setScalar(visual.baseScale * 4.2 * scaleFactor);
      visual.glow.material.opacity = isDimmed ? 0.08 : 0.55;
      if (!visual.textureApplied) {
        visual.material.color.copy(color);
      }
      visual.material.opacity = opacity;
    }
  }

  focusNode(nodeId: string) {
    const node = this.adjacency.nodesById.get(nodeId);
    if (!node) return;

    this.state = {
      focusedId: nodeId,
      connectedIds: this.adjacency.neighbors.get(nodeId) ?? new Set(),
    };

    this.applyNodeVisualState();
    this.refreshLinkVisuals();

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
    this.state = { focusedId: null, connectedIds: new Set() };
    this.applyNodeVisualState();
    this.refreshLinkVisuals();

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
