import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next ships native flat configs from Next 16 onward, so these are
 * spread in directly rather than going through the eslintrc compatibility layer.
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/worklets/**',
      // The pdf.js worker, copied out of node_modules by scripts/copy-pdf-worker.mjs.
      // Linting a minified vendor bundle produces well over a thousand findings that
      // nobody can act on.
      'public/pdf/**',
    ],
  },
];

export default config;
