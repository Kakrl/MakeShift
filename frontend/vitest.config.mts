import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const testsDir = fileURLToPath(new URL("../tests/frontend", import.meta.url));

export default defineConfig({
  // jsdom tests load through the Vite server, which must be allowed to read them.
  server: { fs: { allow: [".", testsDir] } },
  // Tests live outside the frontend package; resolve its dependencies here.
  // Specifiers passed to vi.mock also need an alias so the test and the
  // mocked source resolve to the same module.
  resolve: {
    alias: [
      "midi-writer-js",
      "react",
      "@testing-library/react",
      "next/navigation",
      "next/dynamic",
    ].map((name) => ({
      // Exact match, so subpaths such as react/jsx-runtime resolve normally.
      find: new RegExp(`^${name}$`),
      replacement: require.resolve(name),
    })),
  },
  test: {
    // `dir`, not `root`: a root outside the working directory breaks loading
    // jsdom-environment test files.
    dir: testsDir,
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
