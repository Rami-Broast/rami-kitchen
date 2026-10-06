import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The build environment, declared rather than pulled in via `@types/node`.
 * One property read is not worth a whole type package. Mirrors `admin-app`.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * The commit this bundle was built from.
 *
 * Vercel sets `VERCEL_GIT_COMMIT_SHA` and GitHub Actions sets `GITHUB_SHA`; a
 * build with neither is a local one and says so. It only ever renders a build
 * marker in the shell footer, so it must never be able to fail the build —
 * hence no shelling out to git and no throwing.
 */
function commitSha(): string {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  return fromCi ? fromCi.slice(0, 7) : 'local';
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(commitSha()),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
