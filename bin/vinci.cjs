#!/usr/bin/env node
// Vinci AI — AI Shorts Generator launcher.
// Forces Indian Standard Time for all scheduling, then boots the bundled server
// from the package root (the server resolves data/, dist/, storage/ via cwd).

process.env.TZ = process.env.TZ || "Asia/Kolkata";
// The bundled server treats itself as production when NODE_ENV=production or
// argv[1] ends with server.cjs. Since we boot via bin/vinci.cjs, force
// production so it serves dist/ instead of trying to load the vite dev server.
process.env.NODE_ENV = process.env.NODE_ENV || "production";

const path = require("path");
const fs = require("fs");

// The bundled server resolves data/, dist/, storage/ relative to process.cwd(),
// so always run from the package root regardless of where the user invoked us.
const pkgRoot = path.join(__dirname, "..");
process.chdir(pkgRoot);

// Self-sufficient first-run setup (postinstall may be blocked by npm's
// allowScripts security gate, so we also bootstrap here). Never overwrites
// an existing .env — user secrets are always preserved.
function ensureRuntimeDirs() {
  for (const dir of ["data", "storage", "storage/projects", "storage/music", "storage/imports"]) {
    const p = path.join(pkgRoot, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
  const envPath = path.join(pkgRoot, ".env");
  const examplePath = path.join(pkgRoot, ".env.example");
  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log("[vinci] created .env from .env.example — edit it and add your API keys");
  }
}

try {
  ensureRuntimeDirs();
} catch (e) {
  console.warn("[vinci] setup warning:", e.message);
}

require(path.join(pkgRoot, "dist", "server.cjs"));
