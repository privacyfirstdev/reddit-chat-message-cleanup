// Bundles the content script and popup into dist/, and copies static assets.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: {
    content: join(root, "src/content/index.ts"),
    popup: join(root, "src/popup/popup.ts"),
  },
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: dist,
  logLevel: "info",
});

for (const file of ["manifest.json", "src/popup/popup.html", "src/popup/popup.css"]) {
  copyFileSync(join(root, file), join(dist, file.split("/").pop()));
}

// Self-hosted font and extension icons. No remote requests from the popup.
cpSync(join(root, "src/popup/fonts"), join(dist, "fonts"), { recursive: true });
cpSync(join(root, "src/icons"), join(dist, "icons"), { recursive: true });

// Web Store package: manifest.json must sit at the zip root, so zip from inside dist/.
const { version } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const zipName = `chat-cleanup-${version}.zip`;

rmSync(join(root, zipName), { force: true });
execFileSync("zip", ["-r", "-q", join(root, zipName), ".", "-x", "*.DS_Store"], { cwd: dist });
console.log(`Packaged ${zipName}`);
