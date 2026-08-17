// Post-install setup for Vinci AI (ai-shorts-generator).
// Creates runtime directories and a .env template on a fresh install.
// Never touches an existing .env — user secrets are always preserved.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

for (const dir of ["data", "storage", "storage/projects", "storage/music", "storage/imports"]) {
  const p = path.join(root, dir);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    console.log(`[vinci] created ${dir}/`);
  }
}

const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");
if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, envPath);
  console.log("[vinci] created .env from .env.example — edit it and add your API keys");
}

console.log("[vinci] setup complete. Run `npx vinci` or `npm start` to launch.");
