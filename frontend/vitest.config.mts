import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  // Tests live outside the frontend package; resolve its dependencies here.
  resolve: {
    alias: {
      "midi-writer-js": require.resolve("midi-writer-js"),
    },
  },
  test: {
    root: fileURLToPath(new URL("../tests/frontend", import.meta.url)),
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
