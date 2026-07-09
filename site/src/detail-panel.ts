import type { GraphNode, Role } from './types';
import { displayName, imagePath } from './types';
import type { GraphView } from './graph-view';
import { escapeHtml } from './util';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

function roleLabel(role: Role): string {
  return role.type === 'cast' ? role.character || 'Cast' : role.job || role.department;
}

export function renderDetailPanel(
  panel: HTMLElement,
  node: GraphNode,
  view: GraphView,
  onSelect: (id: string) => void
) {
  const img = imagePath(node);
  const neighbors = [...view.getNeighbors(node.id)].sort((a, b) =>
    displayName(a).localeCompare(displayName(b))
  );

  const meta =
    node.type === 'movie'
      ? `${node.year} &middot; ${neighbors.length} credit${neighbors.length === 1 ? '' : 's'}`
      : `${neighbors.length} film${neighbors.length === 1 ? '' : 's'}`;

  const connectionItems = neighbors
    .map((n) => {
      const edge = view.getEdge(node.id, n.id);
      const roleText = edge ? edge.roles.map(roleLabel).join(', ') : '';
      return `<li class="connection-item" data-id="${n.id}">
        <span>${escapeHtml(displayName(n))}</span>
        <span class="connection-role">${escapeHtml(roleText)}</span>
      </li>`;
    })
    .join('');

  panel.innerHTML = `
    ${img ? `<img class="detail-image" src="${TMDB_IMAGE_BASE}${img}" alt="${escapeHtml(displayName(node))}" />` : ''}
    <div class="detail-body">
      <h2 class="detail-name">${escapeHtml(displayName(node))}</h2>
      <p class="detail-meta">${meta}</p>
      <p class="detail-section-label">Connections</p>
      <ul class="connection-list">${connectionItems}</ul>
    </div>
  `;

  panel.hidden = false;

  panel.querySelectorAll<HTMLLIElement>('.connection-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      if (id) onSelect(id);
    });
  });
}

export function hideDetailPanel(panel: HTMLElement) {
  panel.hidden = true;
  panel.innerHTML = '';
}
