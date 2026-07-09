import Fuse from 'fuse.js';
import type { GraphNode } from './types';
import { displayName } from './types';
import { escapeHtml } from './util';

export function wireSearch(
  input: HTMLInputElement,
  resultsEl: HTMLElement,
  nodes: GraphNode[],
  onSelect: (id: string) => void
) {
  const items = nodes.map((node) => ({ node, label: displayName(node) }));
  const fuse = new Fuse(items, { keys: ['label'], threshold: 0.35 });

  const clear = () => {
    resultsEl.innerHTML = '';
  };

  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (!query) {
      clear();
      return;
    }

    const matches = fuse.search(query, { limit: 8 });
    resultsEl.innerHTML = matches
      .map(
        ({ item }) => `
          <div class="search-result" data-id="${item.node.id}">
            <span class="search-result-type">${item.node.type}</span>
            <span>${escapeHtml(item.label)}</span>
          </div>
        `
      )
      .join('');

    resultsEl.querySelectorAll<HTMLDivElement>('.search-result').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (id) {
          onSelect(id);
          input.value = '';
          clear();
        }
      });
    });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      clear();
      input.blur();
    }
  });
}
