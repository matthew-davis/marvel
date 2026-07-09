import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(ROOT, '../data/movies-index.json');
const MOVIES_DIR = path.join(ROOT, '../data/movies');
const PEOPLE_DIR = path.join(ROOT, '../data/people');
const GRAPH_PATH = path.join(ROOT, '../data/graph.json');

const movieNodeId = (tmdbId) => `movie:${tmdbId}`;
const personNodeId = (tmdbId) => `person:${tmdbId}`;

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf-8'));
}

async function loadPeopleCache() {
  const files = await readdir(PEOPLE_DIR);
  const cache = new Map();
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const person = await loadJson(path.join(PEOPLE_DIR, file));
    cache.set(person.id, person);
  }
  return cache;
}

async function main() {
  const index = await loadJson(INDEX_PATH);
  const peopleCache = await loadPeopleCache();

  const nodes = [];
  const personIdsSeen = new Set();
  // key: `${personId}::${movieId}` -> { source, target, roles: [...] }
  const edgesByPair = new Map();

  for (const movie of index) {
    if (!movie.tmdb_id) continue;

    let record;
    try {
      record = await loadJson(path.join(MOVIES_DIR, `${movie.tmdb_id}.json`));
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn(`Skipping ${movie.title} (${movie.year}): no cached movie data yet`);
        continue;
      }
      throw err;
    }

    nodes.push({
      id: movieNodeId(record.id),
      type: 'movie',
      title: record.title,
      year: record.year,
      release_date: record.release_date,
      poster_path: record.poster_path,
    });

    const credits = [
      ...record.cast.map((c) => ({ personId: c.id, role: { type: 'cast', character: c.character } })),
      ...record.crew.map((c) => ({ personId: c.id, role: { type: 'crew', job: c.job, department: c.department } })),
    ];

    for (const { personId, role } of credits) {
      const person = peopleCache.get(personId);
      if (!person) {
        console.warn(`Skipping credit for person ${personId} on ${record.title}: not found in data/people`);
        continue;
      }

      if (!personIdsSeen.has(personId)) {
        personIdsSeen.add(personId);
        nodes.push({
          id: personNodeId(personId),
          type: 'person',
          name: person.name,
          profile_path: person.profile_path,
        });
      }

      const pairKey = `${personId}::${record.id}`;
      if (!edgesByPair.has(pairKey)) {
        edgesByPair.set(pairKey, {
          source: personNodeId(personId),
          target: movieNodeId(record.id),
          roles: [],
        });
      }
      edgesByPair.get(pairKey).roles.push(role);
    }
  }

  const graph = {
    generated_at: new Date().toISOString(),
    nodes,
    edges: [...edgesByPair.values()],
  };

  await writeFile(GRAPH_PATH, JSON.stringify(graph) + '\n');
  console.log(`Graph written: ${nodes.length} nodes, ${graph.edges.length} edges`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
