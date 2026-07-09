import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, '../../data/graph.json');
const DEST_DIR = path.join(ROOT, '../public/data');
const DEST = path.join(DEST_DIR, 'graph.json');

await mkdir(DEST_DIR, { recursive: true });
await copyFile(SRC, DEST);
console.log('Synced data/graph.json -> site/public/data/graph.json');
