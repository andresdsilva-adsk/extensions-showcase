#!/usr/bin/env node
/**
 * Bundle and run headless agent simulation checks (Shanon-style aggregate metrics).
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const entry = join(__dirname, "verify-agents-entry.ts");
const outDir = mkdtempSync(join(tmpdir(), "verify-agents-"));
const outfile = join(outDir, "verify-agents.cjs");

try {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    logLevel: "silent",
  });

  const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
  process.exit(result.status ?? 1);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
