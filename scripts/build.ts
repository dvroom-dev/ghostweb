#!/usr/bin/env bun
/**
 * Build script that compiles index.ts to Node.js-compatible JavaScript.
 */

import { $ } from "bun";

const outfile = "dist/cli.js";

// Bundle for Node.js
await $`bun build index.ts --outfile ${outfile} --target node --format esm`;

// Replace bun shebang with Node.js shebang
let content = await Bun.file(outfile).text();
const nodeShebang = "#!/usr/bin/env node\n";

// Remove bun-specific header lines at the start of file
// (bun adds #!/usr/bin/env bun and // @bun)
const lines = content.split("\n");
while (lines.length > 0 && (lines[0].startsWith("#!") || lines[0] === "// @bun")) {
  lines.shift();
}

await Bun.write(outfile, nodeShebang + lines.join("\n"));

// Make executable
await $`chmod +x ${outfile}`;

console.log(`Built ${outfile}`);
