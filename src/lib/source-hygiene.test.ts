import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Guards against a class of bug that cost real time to find.
 *
 * A regex written through a shell heredoc had its escapes processed twice, so
 * `\b` became a literal backspace character (0x08) and `\s` became `\\s`. The
 * file looked correct in an editor, TypeScript compiled it happily, and the
 * pattern silently never matched. A negation guard for "I'm not ready" appeared
 * to be in place while the deck carried on advancing.
 *
 * Nothing in a lint or type check catches that, so this does.
 */
const FORBIDDEN = new Map<number, string>([
  [0x00, 'NUL, likely a mangled \\0'],
  [0x07, 'BELL, likely a mangled \\a'],
  [0x08, 'BACKSPACE, likely a mangled \\b'],
  [0x0b, 'VERTICAL TAB, likely a mangled \\v'],
  [0x0c, 'FORM FEED, likely a mangled \\f'],
]);

/**
 * Directories holding code this project did not write.
 *
 * `public/pdf` is the pdf.js worker, copied from node_modules by
 * scripts/copy-pdf-worker.mjs. Minified vendor bundles contain control bytes quite
 * legitimately, and this check is about catching escape sequences mangled on their
 * way into files written here. Scanning a third-party bundle only produces a
 * failure nobody can act on.
 */
const VENDORED = new Set(['node_modules', '.next', 'pdf']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (VENDORED.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|css|mjs|js)$/.test(name)) out.push(path);
  }
  return out;
}

describe('source hygiene', () => {
  const files = sourceFiles('src').concat(sourceFiles('public'));

  it('finds files to check, so a broken glob cannot pass silently', () => {
    assert.ok(files.length > 10, `only found ${files.length} source files`);
  });

  it('contains no control characters from mangled escape sequences', () => {
    const problems: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (let column = 0; column < line.length; column += 1) {
          const code = line.charCodeAt(column);
          const reason = FORBIDDEN.get(code);
          if (reason) {
            problems.push(`${file}:${index + 1}:${column + 1} ${reason}`);
            return;
          }
        }
      });
    }

    assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
  });
});

/**
 * A Response made once, at module level, and returned to many requests.
 *
 * A response body can be read only once. Both platform routes built their refusal that
 * way, so on a warm server the first refusal said "Not found." and every later one was
 * an empty 404, or a 500 on a runtime that rejects a body already read. The production
 * check of 7 October found it. Every response has to be made inside the handler.
 */
describe('responses are made per request', () => {
  const routes = sourceFiles('src/app').filter((path) => /[\\/]route\.ts$/.test(path));

  it('finds the routes, so a broken walk cannot pass silently', () => {
    assert.ok(routes.length > 15, `only ${routes.length} routes found`);
  });

  it('never keeps a Response at module level for handlers to share', () => {
    const shared = routes.filter((path) =>
      /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:Response\.\w+|new\s+Response)\(/m.test(
        readFileSync(path, 'utf8'),
      ),
    );
    assert.deepEqual(shared, []);
  });
});
