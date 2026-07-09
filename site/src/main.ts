import './tokens.css';
import './style.css';
import { loadGraphData } from './data';
import { GraphView } from './graph-view';
import { wireSearch } from './search';
import { renderDetailPanel, hideDetailPanel } from './detail-panel';
import { displayName } from './types';

async function main() {
  const container = document.getElementById('graph-container')!;
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchResults = document.getElementById('search-results')!;
  const detailPanel = document.getElementById('detail-panel')!;
  const breadcrumb = document.getElementById('breadcrumb')!;

  const data = await loadGraphData();

  const view = new GraphView(container, data, (node) => {
    if (!node) {
      hideDetailPanel(detailPanel);
      breadcrumb.innerHTML = '';
      return;
    }
    renderDetailPanel(detailPanel, node, view, (id) => view.focusNode(id));
    breadcrumb.innerHTML = `Focused on <strong>${displayName(node)}</strong> &middot; <button id="clear-focus">clear</button>`;
    document.getElementById('clear-focus')?.addEventListener('click', () => view.clearFocus());
  });

  wireSearch(searchInput, searchResults, data.nodes, (id) => view.focusNode(id));
}

main().catch((err) => {
  console.error('Failed to initialize graph', err);
  const container = document.getElementById('graph-container');
  if (container) {
    container.innerHTML = `<p style="padding:24px;font-family:monospace;color:#e8384f;">Failed to load graph data: ${
      err instanceof Error ? err.message : String(err)
    }</p>`;
  }
});
