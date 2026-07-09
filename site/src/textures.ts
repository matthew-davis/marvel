import * as THREE from 'three';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w185';
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

const cache = new Map<string, Promise<THREE.Texture | null>>();

// Real portrait/poster textures are only ever requested for a node once it
// enters focus (selected or a direct connection) - see graph-view.ts. At
// thousands of person-nodes, eagerly loading every image up front would mean
// thousands of simultaneous TMDB requests and GPU-resident textures for
// nodes nobody is looking at.
export function loadNodeTexture(imagePath: string | null): Promise<THREE.Texture | null> {
  if (!imagePath) return Promise.resolve(null);

  const url = `${TMDB_IMAGE_BASE}${imagePath}`;
  let pending = cache.get(url);
  if (!pending) {
    pending = new Promise((resolve) => {
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          resolve(texture);
        },
        undefined,
        () => resolve(null)
      );
    });
    cache.set(url, pending);
  }
  return pending;
}

const glowSpriteCache = new Map<string, THREE.Texture>();

export function glowTexture(hexColor: string): THREE.Texture {
  const cached = glowSpriteCache.get(hexColor);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, hexColor);
  gradient.addColorStop(0.35, hexColor);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  glowSpriteCache.set(hexColor, texture);
  return texture;
}
