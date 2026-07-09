import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_READ_TOKEN = process.env.TMDB_READ_TOKEN;
// Optional cap on how many movies get (re)fetched this run - for local smoke
// testing only, so a dry run doesn't burn the full backfill's worth of quota.
const ENRICH_LIMIT = process.env.ENRICH_LIMIT ? parseInt(process.env.ENRICH_LIMIT, 10) : Infinity;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(ROOT, '../data/movies-index.json');
const MOVIES_DIR = path.join(ROOT, '../data/movies');
const PEOPLE_DIR = path.join(ROOT, '../data/people');
const NEEDS_REVIEW_PATH = path.join(ROOT, '../data/needs-review.json');

// Movies within this window of their theatrical release get their credits
// refetched every run, since TMDB entries are commonly corrected/expanded
// (added stunt performers, late reshoot credits) for a while after release.
// Anything older, or already up to date, is left untouched to keep weekly
// API usage low.
const REFRESH_WINDOW_MONTHS = 18;

if (!TMDB_READ_TOKEN) {
  console.error('Missing TMDB_READ_TOKEN environment variable.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tmdbFetch(pathname, params = {}) {
  const url = new URL(`${TMDB_API}${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TMDB_READ_TOKEN}`,
      Accept: 'application/json',
    },
  });
  await sleep(75); // stay comfortably under TMDB's rate limit
  if (!res.ok) {
    throw new Error(`TMDB request failed (${res.status}) for ${pathname}: ${await res.text()}`);
  }
  return res.json();
}

function normalizeTitle(title) {
  return title.toLowerCase().trim();
}

async function resolveTmdbId(movie, needsReview) {
  const results = (await tmdbFetch('/search/movie', { query: movie.title })).results ?? [];

  const exactTitleMatches = results.filter(
    (r) => normalizeTitle(r.title) === normalizeTitle(movie.title)
  );

  const withYearDiff = exactTitleMatches.map((r) => {
    const releaseYear = r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null;
    return { candidate: r, yearDiff: releaseYear === null ? null : Math.abs(releaseYear - movie.year) };
  });

  // Prefer candidates with a real release date close to the expected year -
  // TMDB has many dateless duplicate/placeholder entries that would otherwise
  // turn an obvious single match into a false "ambiguous" one.
  const dated = withYearDiff.filter((c) => c.yearDiff !== null && c.yearDiff <= 1);
  if (dated.length === 1) {
    return dated[0].candidate.id;
  }
  if (dated.length === 0 && exactTitleMatches.length === 1) {
    return exactTitleMatches[0].id;
  }

  needsReview.push({
    title: movie.title,
    year: movie.year,
    reason: results.length === 0 ? 'no candidates found' : 'ambiguous match',
    candidates: results.slice(0, 5).map((r) => ({
      id: r.id,
      title: r.title,
      release_date: r.release_date || null,
    })),
  });
  return null;
}

function monthsSince(dateString) {
  const then = new Date(dateString);
  const now = new Date();
  return (now - then) / (1000 * 60 * 60 * 24 * 30);
}

function needsMovieRefetch(existing) {
  if (!existing) return true; // never fetched
  if (!existing.release_date) return true; // unreleased - credits can still change
  return monthsSince(existing.release_date) <= REFRESH_WINDOW_MONTHS;
}

async function personFileExists(personId) {
  try {
    await readFile(path.join(PEOPLE_DIR, `${personId}.json`), 'utf-8');
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function fetchPersonDetails(personId) {
  return tmdbFetch(`/person/${personId}`);
}

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function main() {
  await mkdir(MOVIES_DIR, { recursive: true });
  await mkdir(PEOPLE_DIR, { recursive: true });

  const index = await loadJson(INDEX_PATH, []);
  const needsReview = [];
  const personIdsToCheck = new Set();

  let processed = 0;

  for (const movie of index) {
    if (processed >= ENRICH_LIMIT) break;

    if (!movie.tmdb_id) {
      const resolvedId = await resolveTmdbId(movie, needsReview);
      if (!resolvedId) continue;
      movie.tmdb_id = resolvedId;
    }

    const existing = await loadJson(path.join(MOVIES_DIR, `${movie.tmdb_id}.json`), null);
    const shouldRefetch = needsMovieRefetch(existing);

    if (!shouldRefetch) {
      for (const person of [...(existing.cast ?? []), ...(existing.crew ?? [])]) {
        personIdsToCheck.add(person.id);
      }
      continue;
    }

    console.log(`Fetching movie: ${movie.title} (${movie.year}) [tmdb:${movie.tmdb_id}]`);
    const details = await tmdbFetch(`/movie/${movie.tmdb_id}`, { append_to_response: 'credits' });
    processed += 1;

    const record = {
      id: details.id,
      title: details.title,
      year: movie.year,
      release_date: details.release_date || null,
      poster_path: details.poster_path,
      overview: details.overview,
      runtime: details.runtime,
      genres: details.genres?.map((g) => g.name) ?? [],
      cast: (details.credits?.cast ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        character: c.character,
        order: c.order,
        profile_path: c.profile_path,
      })),
      crew: (details.credits?.crew ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        job: c.job,
        department: c.department,
        profile_path: c.profile_path,
      })),
      fetched_at: new Date().toISOString(),
    };

    await writeFile(path.join(MOVIES_DIR, `${movie.tmdb_id}.json`), JSON.stringify(record, null, 2) + '\n');

    for (const person of [...record.cast, ...record.crew]) {
      personIdsToCheck.add(person.id);
    }
  }

  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');

  let peopleFetched = 0;
  for (const personId of personIdsToCheck) {
    if (await personFileExists(personId)) continue;

    console.log(`Fetching person: ${personId}`);
    const person = await fetchPersonDetails(personId);
    peopleFetched += 1;

    const record = {
      id: person.id,
      name: person.name,
      profile_path: person.profile_path,
      birthday: person.birthday,
      known_for_department: person.known_for_department,
      fetched_at: new Date().toISOString(),
    };

    await writeFile(path.join(PEOPLE_DIR, `${personId}.json`), JSON.stringify(record, null, 2) + '\n');
  }

  if (needsReview.length > 0) {
    await writeFile(NEEDS_REVIEW_PATH, JSON.stringify(needsReview, null, 2) + '\n');
    console.warn(`${needsReview.length} movie(s) need manual TMDB matching - see data/needs-review.json`);
  }

  console.log(`Done. Movies fetched/refreshed: ${processed}. New people fetched: ${peopleFetched}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
