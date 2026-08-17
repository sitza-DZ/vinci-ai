/**
 * Cross-platform Python resolution.
 *
 * Termux/Linux ships `python3`; Windows installs expose `python` (or the
 * `py` launcher) instead. Every shell-out to Python in the codebase goes
 * through these helpers so the app runs on both without edits.
 *
 * Overrides (set in .env):
 *   PYTHON_BIN      — binary used for edge-tts / tts.py calls
 *   PYTHON_CFFI_BIN — binary used for the curl_cffi helpers
 *                     (urlebird_search.py, pinterest_video_search.py)
 */
import { execSync } from "child_process";

const IS_WIN = process.platform === "win32";

let cachedPython: string | null = null;
let cachedCffiPython: string | null = null;

function exists(cmd: string): boolean {
  try {
    execSync(IS_WIN ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Python binary for edge-tts (tts.py, voice lists). */
export function getPythonBin(): string {
  if (cachedPython) return cachedPython;
  const envBin = (process.env.PYTHON_BIN || "").trim();
  if (envBin && exists(envBin)) return (cachedPython = envBin);
  const candidates = IS_WIN
    ? ["python", "python3", "py"]
    : ["python3", "python"];
  for (const c of candidates) {
    if (exists(c)) return (cachedPython = c);
  }
  // Nothing found — return the platform default and let the call fail with
  // a visible error rather than crashing resolution.
  return (cachedPython = IS_WIN ? "python" : "python3");
}

/**
 * Python binary for the curl_cffi-based scrapers. On Termux that is
 * python3.13 (curl_cffi is broken on 3.14 there); elsewhere any Python
 * with `pip install curl_cffi` works, so fall back to the default binary.
 */
export function getCffiPythonBin(): string {
  if (cachedCffiPython) return cachedCffiPython;
  const envBin = (process.env.PYTHON_CFFI_BIN || "").trim();
  if (envBin && exists(envBin)) return (cachedCffiPython = envBin);
  if (exists("python3.13")) return (cachedCffiPython = "python3.13");
  return (cachedCffiPython = getPythonBin());
}
