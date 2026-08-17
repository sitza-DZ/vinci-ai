/**
 * v16: Voice Cloning via Colab XTTS-v2 server
 *
 * The user runs a Colab notebook (colab/voice_clone_server.ipynb) that hosts an
 * XTTS-v2 voice-clone server behind a cloudflared quick tunnel. The tunnel URL
 * is pasted into Settings → Voice Cloning and stored in defaultSettings.
 *
 * Flow:
 *   1. POST /tts { text, language } -> returns WAV audio of the cloned voice
 *   2. We convert WAV -> MP3 with ffmpeg and register it as the voiceover track
 *   3. If the Colab server is unreachable, callers fall back to edge-tts.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { DB } from "./db";

export interface VoiceCloneSettings {
  voiceCloneEnabled?: boolean;
  voiceCloneUrl?: string;
}

/** Read the stored Colab tunnel URL (trimmed, no trailing slash). */
export function getVoiceCloneUrl(): string {
  try {
    const settings: any = DB.getDefaultSettings();
    const url = (settings?.voiceCloneUrl || "").trim().replace(/\/+$/, "");
    return url;
  } catch {
    return "";
  }
}

export function isVoiceCloneEnabled(): boolean {
  try {
    const settings: any = DB.getDefaultSettings();
    return settings?.voiceCloneEnabled === true && !!getVoiceCloneUrl();
  } catch {
    return false;
  }
}

/**
 * Ping the Colab server's /health endpoint.
 * Returns { ok, detail } — ok=true means the server is up and XTTS is loaded.
 */
export async function testVoiceCloneServer(url: string): Promise<{ ok: boolean; detail: string }> {
  const clean = (url || "").trim().replace(/\/+$/, "");
  if (!clean) return { ok: false, detail: "No URL provided" };
  if (!/^https?:\/\//i.test(clean)) return { ok: false, detail: "URL must start with http:// or https://" };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`${clean}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, detail: `Server responded with HTTP ${res.status}` };
    const data: any = await res.json();
    if (data?.status === "ok") {
      return { ok: true, detail: `Connected! Model: ${data.model || "xtts_v2"}, sample: ${data.sample || "loaded"}` };
    }
    return { ok: false, detail: "Server responded but health check failed" };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Connection timed out (15s)" : (e?.message || String(e));
    return { ok: false, detail: `Cannot reach server: ${msg}` };
  }
}

/**
 * Generate cloned-voice audio for the given text.
 * Returns the path to an MP3 file, or null on any failure (caller falls back to edge-tts).
 *
 * @param text     narration text (any language — XTTS-v2 is multilingual)
 * @param language BCP-47-ish code: "en", "hi", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "ja", "hu", "ko"
 * @param outPath  where to write the final MP3
 */
export async function generateClonedVoice(text: string, language: string, outPath: string): Promise<string | null> {
  const baseUrl = getVoiceCloneUrl();
  if (!baseUrl || !text?.trim()) return null;

  const wavPath = outPath.replace(/\.mp3$/, ".wav");
  try {
    const controller = new AbortController();
    // Cloned TTS can be slow on CPU — generous 5 min timeout
    const timer = setTimeout(() => controller.abort(), 300000);
    const res = await fetch(`${baseUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim(), language: language || "en" }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const j: any = await res.json(); detail = j?.error || detail; } catch { /* noop */ }
      console.log(`[VoiceClone] TTS request failed: ${detail}`);
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) {
      console.log("[VoiceClone] TTS returned empty/tiny audio");
      return null;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(wavPath, buf);

    // Convert WAV -> MP3 (smaller, matches the rest of the pipeline)
    execSync(
      `ffmpeg -y -i "${wavPath}" -c:a libmp3lame -b:a 192k "${outPath}"`,
      { timeout: 120000, maxBuffer: 16 * 1024 * 1024 }
    );
    try { fs.unlinkSync(wavPath); } catch { /* noop */ }

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) return null;
    return outPath;
  } catch (e: any) {
    console.log(`[VoiceClone] Generation failed: ${e?.message || e}`);
    try { if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath); } catch { /* noop */ }
    return null;
  }
}

/**
 * Map a script's dominant script/language to an XTTS-v2 language code.
 * XTTS-v2 supports: en, es, fr, de, it, pt, pl, tr, ru, nl, cs, ar, zh-cn, ja, hu, ko, hi
 */
export function detectXttsLanguage(text: string): string {
  if (!text) return "en";
  if (/[\u0900-\u097F]/.test(text)) return "hi";        // Devanagari (Hindi)
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return "ar"; // Arabic/Urdu
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh-cn";     // Chinese
  if (/[\u3040-\u30FF]/.test(text)) return "ja";        // Japanese
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";        // Korean
  if (/[\u0400-\u04FF]/.test(text)) return "ru";        // Cyrillic
  // Latin-script heuristic by common words
  const t = text.toLowerCase();
  if (/\b(el|la|los|las|que|de|es|un|una)\b/.test(t) && /\b(que|los|las)\b/.test(t)) return "es";
  if (/\b(le|la|les|des|est|une|et|vous)\b/.test(t) && /\b(les|une|est)\b/.test(t)) return "fr";
  if (/\b(der|die|das|und|ist|nicht|ein|eine)\b/.test(t) && /\b(und|ist|nicht)\b/.test(t)) return "de";
  if (/\b(o|a|os|as|que|de|é|um|uma|não)\b/.test(t) && /\b(não|é|um)\b/.test(t)) return "pt";
  if (/\b(il|la|che|di|è|un|una|per)\b/.test(t) && /\b(che|è|per)\b/.test(t)) return "it";
  if (/\b(bir|ve|bu|ile|için|değil)\b/.test(t)) return "tr";
  return "en";
}
