import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'node:fs/promises';

const WIKI_PAGE = 'List of films based on Marvel Comics publications';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'marvel-graph-discover/1.0 (https://github.com/matthew-davis/marvel)';
const INDEX_PATH = new URL('../data/movies-index.json', import.meta.url);

// Heading ids (from the parsed HTML's div.mw-heading > h2/h3/h4) whose tables
// list actual films. Repeated heading names get a Wikipedia-assigned "_2"
// suffix; both instances are wanted here, so no need to disambiguate by parent.
const INCLUDE_HEADING_IDS = new Set([
  'Feature_films',
  'Serials_and_short_films',
  'From_Marvel_imprints',
  'Short_films',
  'Direct-to-video_and_television_films',
  'From_Malibu_Comics',
  'Theatrically_released_films',
  'Direct-to-video_and_television_films_2',
  'Short_films_2',
  'From_Icon_Comics',
]);

// Deliberately excluded: TV episodes repackaged/sold as standalone "films",
// and Lego direct-to-video shorts - real Wikipedia sections, low graph value.
// (Episodes_as_films, Episodes_as_films_2, Lego_films are simply omitted
// from INCLUDE_HEADING_IDS above rather than listed here.)

async function fetchPageHtml() {
  const url = new URL(WIKI_API);
  url.searchParams.set('action', 'parse');
  url.searchParams.set('page', WIKI_PAGE);
  url.searchParams.set('prop', 'text');
  url.searchParams.set('format', 'json');

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Wikipedia API request failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (!body.parse?.text?.['*']) {
    throw new Error('Unexpected Wikipedia API response shape (missing parse.text)');
  }
  return body.parse.text['*'];
}

function extractYear(cellText) {
  const match = cellText.match(/\d{4}/);
  return match ? parseInt(match[0], 10) : null;
}

function cleanTitle(cellText) {
  return cellText.replace(/\[.*?\]/g, '').trim();
}

function parseFilmTable($, table) {
  const films = [];
  let pendingYear = null; // { value, remaining } - carries the Year cell across rowspan rows

  $(table)
    .find('tr')
    .each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length === 0) return; // header row

      const cellArr = cells.toArray();
      let year;
      let titleCell;

      if (pendingYear && pendingYear.remaining > 0) {
        year = pendingYear.value;
        pendingYear.remaining -= 1;
        titleCell = cellArr[0];
      } else {
        const yearCell = cellArr[0];
        year = extractYear($(yearCell).text());
        const rowspan = parseInt($(yearCell).attr('rowspan') || '1', 10);
        pendingYear = rowspan > 1 ? { value: year, remaining: rowspan - 1 } : null;
        titleCell = cellArr[1];
      }

      if (!titleCell || year === null) return;
      const title = cleanTitle($(titleCell).text());
      if (!title) return;

      films.push({ title, year });
    });

  return films;
}

function extractFilms(html) {
  const $ = cheerio.load(html);
  const films = [];
  let currentHeadingId = null;

  $('div.mw-heading, table.wikitable').each((_, el) => {
    if (el.tagName === 'div') {
      const heading = $(el).find('h2, h3, h4').first();
      currentHeadingId = heading.attr('id') || null;
      return;
    }
    if (currentHeadingId && INCLUDE_HEADING_IDS.has(currentHeadingId)) {
      films.push(...parseFilmTable($, el));
    }
  });

  return films;
}

function dedupe(films) {
  const seen = new Map();
  for (const film of films) {
    const key = `${film.title.toLowerCase()}::${film.year}`;
    if (!seen.has(key)) seen.set(key, film);
  }
  return [...seen.values()];
}

async function loadIndex() {
  try {
    const raw = await readFile(INDEX_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function diffAgainstIndex(discovered, existingIndex) {
  const existingKeys = new Set(
    existingIndex.map((m) => `${m.title.toLowerCase()}::${m.year}`)
  );
  const additions = discovered.filter(
    (f) => !existingKeys.has(`${f.title.toLowerCase()}::${f.year}`)
  );

  const discoveredKeys = new Set(
    discovered.map((f) => `${f.title.toLowerCase()}::${f.year}`)
  );
  const missing = existingIndex.filter(
    (m) => !discoveredKeys.has(`${m.title.toLowerCase()}::${m.year}`)
  );

  return { additions, missing };
}

async function main() {
  const html = await fetchPageHtml();
  const discovered = dedupe(extractFilms(html));
  const existingIndex = await loadIndex();

  const { additions, missing } = diffAgainstIndex(discovered, existingIndex);

  if (missing.length > 0) {
    // Not auto-removed: could be a transient Wikipedia edit/vandalism, and we
    // don't want to silently drop already-enriched movie/people data over it.
    console.warn(
      `Warning: ${missing.length} indexed film(s) no longer found on the Wikipedia page (left untouched):`
    );
    for (const m of missing) console.warn(`  - ${m.title} (${m.year})`);
  }

  if (additions.length === 0) {
    console.log('No new films discovered.');
    return;
  }

  const updatedIndex = [...existingIndex, ...additions.map((f) => ({ ...f, tmdb_id: null }))].sort(
    (a, b) => a.year - b.year || a.title.localeCompare(b.title)
  );

  await writeFile(INDEX_PATH, JSON.stringify(updatedIndex, null, 2) + '\n');

  console.log(`Discovered ${additions.length} new film(s):`);
  for (const f of additions) console.log(`  + ${f.title} (${f.year})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
