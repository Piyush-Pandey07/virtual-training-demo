import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * firebase-admin is loaded, not bundled.
   *
   * It resolves parts of itself at run time, which a bundler cannot follow. Bundled,
   * it throws while the module is still being evaluated, so every page that imports
   * it — which is every page behind sign-in — returns a 500 before any of its own
   * code runs. Locally it never showed: the dev server does not bundle server
   * dependencies, so this only appeared once it was deployed.
   */
  serverExternalPackages: ['firebase-admin'],
};

export default nextConfig;
