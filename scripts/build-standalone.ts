#!/usr/bin/env bun
/**
 * Build script for standalone binary with embedded ghostty-web assets.
 */

import { $ } from "bun";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const ghosttyDist = join(projectRoot, "node_modules", "ghostty-web", "dist");

// Read ghostty-web assets
const ghosttyWebJs = readFileSync(join(ghosttyDist, "ghostty-web.js"), "utf-8");
const ghosttyVtWasm = readFileSync(join(ghosttyDist, "ghostty-vt.wasm")).toString("base64");
const viteExternalJs = readFileSync(join(ghosttyDist, "__vite-browser-external-2447137e.js"), "utf-8");

// Read source file
let source = readFileSync(join(projectRoot, "index.ts"), "utf-8");

// Replace the constant declarations with embedded data
source = source.replace(
  'const EMBEDDED_GHOSTTY_WEB_JS: string | null = null;',
  `const EMBEDDED_GHOSTTY_WEB_JS: string | null = ${JSON.stringify(ghosttyWebJs)};`
);
source = source.replace(
  'const EMBEDDED_GHOSTTY_VT_WASM: string | null = null; // base64 encoded',
  `const EMBEDDED_GHOSTTY_VT_WASM: string | null = ${JSON.stringify(ghosttyVtWasm)}; // base64 encoded`
);
source = source.replace(
  'const EMBEDDED_VITE_EXTERNAL_JS: string | null = null;',
  `const EMBEDDED_VITE_EXTERNAL_JS: string | null = ${JSON.stringify(viteExternalJs)};`
);

// Write modified source to temp file
const tempFile = join(projectRoot, ".build-standalone-temp.ts");
writeFileSync(tempFile, source);

// Get output filename from args or default
const outfile = process.argv[2] || "ghostweb";

// Compile standalone binary
await $`bun build ${tempFile} --compile --outfile ${outfile}`;

// Clean up temp file
await $`rm ${tempFile}`;

console.log(`Built standalone binary: ${outfile}`);
