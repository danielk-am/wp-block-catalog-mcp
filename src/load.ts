import { readFile } from 'node:fs/promises';

import { Catalog } from './catalog.js';

export async function loadCatalog(path: string): Promise<Catalog> {
  const input: unknown = JSON.parse(await readFile(path, 'utf8'));
  return new Catalog(input);
}
