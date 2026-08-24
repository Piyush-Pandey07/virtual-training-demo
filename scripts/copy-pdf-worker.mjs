/**
 * Copies the pdf.js worker into public/ so the browser can load it.
 *
 * pdf.js runs its parser in a web worker, and the worker has to be fetched from a
 * URL the browser can reach. Bundling it through the app graph fights with both
 * Turbopack and webpack, and hard-coding a CDN would mean the client's deck is
 * parsed by a script from someone else's domain, which is a poor look for a tool
 * that presents a slide about information transfer.
 *
 * Copied rather than committed so it cannot drift from the installed version. Runs
 * automatically before dev and build.
 */

import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

const pkgPath = require.resolve('pdfjs-dist/package.json');
const root = dirname(pkgPath);
const version = JSON.parse(await readFile(pkgPath, 'utf8')).version;

const source = join(root, 'build', 'pdf.worker.min.mjs');
const target = join(process.cwd(), 'public', 'pdf', 'pdf.worker.min.mjs');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);

console.log(`pdf.js worker ${version} copied to public/pdf/pdf.worker.min.mjs`);
