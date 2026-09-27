import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  // Tests live outside the frontend package; resolve its dependencies here.
  resolve: {
    alias: {
      "midi-writer-js": require.resolve("midi-writer-js"),
      "jsdom": require.resolve("jsdom"),
      "next": fileURLToPath(new URL("node_modules/next", import.meta.url)),
      "react": fileURLToPath(new URL("node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("node_modules/react-dom", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL("../tests/frontend", import.meta.url)),
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
