// Publish the verified handoff bundle without requiring an Emscripten installation.
import { createHash } from "node:crypto";
import { readFile, mkdir, copyFile } from "node:fs/promises";
const source = new URL("../../backend/src/CV/wasm/dist/", import.meta.url);
const destination = new URL("../public/vision/", import.meta.url);
const info = JSON.parse(
  await readFile(new URL("build-info.json", source), "utf8"),
);
const names = [
  "makeshift-vision.mjs",
  "makeshift-vision-core.mjs",
  "makeshift-vision-core.wasm",
  "makeshift-vision.d.mts",
  "toolchain.env",
];
// Check every file before copying any, so a mismatched loader/binary fails the build.
for (const name of names) {
  const bytes = await readFile(new URL(name, source));
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    info.artifactSha256[name]
  )
    throw new Error(`Vision bundle hash mismatch: ${name}`);
}
await mkdir(destination, { recursive: true });
for (const name of [...names, "build-info.json"])
  await copyFile(new URL(name, source), new URL(name, destination));
console.info("Prepared verified Vision WASM assets in public/vision");
