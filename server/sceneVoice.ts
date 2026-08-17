/**
 * Per-scene voiceover helpers (v13)
 * - Emotion → rate/pitch mapping for edge-tts
 * - Single-scene TTS generation (voice + emotion)
 * - Concatenation of per-scene clips into one project voiceover track
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { DB } from "./db";
import { getPythonBin } from "./python";

export const DEFAULT_PREVIEW_TEXT = "Hey there! This is a quick voice preview. How does it sound?";

/** Static fallback list (used only if `edge-tts --list-voices` cannot run offline) */
export const STATIC_EDGE_VOICES = [
  { ShortName: "en-US-AriaNeural", Gender: "Female", Locale: "en-US", FriendlyName: "Microsoft Aria Online (Natural) - English (United States)" },
  { ShortName: "en-US-JennyNeural", Gender: "Female", Locale: "en-US", FriendlyName: "Microsoft Jenny Online (Natural) - English (United States)" },
  { ShortName: "en-US-GuyNeural", Gender: "Male", Locale: "en-US", FriendlyName: "Microsoft Guy Online (Natural) - English (United States)" },
  { ShortName: "en-GB-SoniaNeural", Gender: "Female", Locale: "en-GB", FriendlyName: "Microsoft Sonia Online (Natural) - English (United Kingdom)" },
  { ShortName: "en-IN-NeerjaNeural", Gender: "Female", Locale: "en-IN", FriendlyName: "Microsoft Neerja Online (Natural) - English (India)" },
  { ShortName: "en-IN-PrabhatNeural", Gender: "Male", Locale: "en-IN", FriendlyName: "Microsoft Prabhat Online (Natural) - English (India)" },
  { ShortName: "hi-IN-SwaraNeural", Gender: "Female", Locale: "hi-IN", FriendlyName: "Microsoft Swara Online (Natural) - Hindi (India)" },
  { ShortName: "hi-IN-MadhurNeural", Gender: "Male", Locale: "hi-IN", FriendlyName: "Microsoft Madhur Online (Natural) - Hindi (India)" },
  { ShortName: "ar-SA-ZariyahNeural", Gender: "Female", Locale: "ar-SA", FriendlyName: "Microsoft Zariyah Online (Natural) - Arabic (Saudi Arabia)" },
  { ShortName: "es-ES-ElviraNeural", Gender: "Female", Locale: "es-ES", FriendlyName: "Microsoft Elvira Online (Natural) - Spanish (Spain)" },
  { ShortName: "fr-FR-DeniseNeural", Gender: "Female", Locale: "fr-FR", FriendlyName: "Microsoft Denise Online (Natural) - French (France)" },
  { ShortName: "de-DE-KatjaNeural", Gender: "Female", Locale: "de-DE", FriendlyName: "Microsoft Katja Online (Natural) - German (Germany)" },
  { ShortName: "pt-BR-FranciscaNeural", Gender: "Female", Locale: "pt-BR", FriendlyName: "Microsoft Francisca Online (Natural) - Portuguese (Brazil)" },
  { ShortName: "ja-JP-NanamiNeural", Gender: "Female", Locale: "ja-JP", FriendlyName: "Microsoft Nanami Online (Natural) - Japanese (Japan)" },
  { ShortName: "ko-KR-SunHiNeural", Gender: "Female", Locale: "ko-KR", FriendlyName: "Microsoft SunHi Online (Natural) - Korean (Korea)" },
  { ShortName: "zh-CN-XiaoxiaoNeural", Gender: "Female", Locale: "zh-CN", FriendlyName: "Microsoft Xiaoxiao Online (Natural) - Chinese (Mandarin)" },
  { ShortName: "ru-RU-SvetlanaNeural", Gender: "Female", Locale: "ru-RU", FriendlyName: "Microsoft Svetlana Online (Natural) - Russian (Russia)" },
  { ShortName: "tr-TR-EmelNeural", Gender: "Female", Locale: "tr-TR", FriendlyName: "Microsoft Emel Online (Natural) - Turkish (Turkey)" },
];

let voicesCache: { data: any[]; ts: number } | null = null;
const VOICES_CACHE_MS = 30 * 60 * 1000; // 30 min

/**
 * Get the list of edge-tts voices. Live fetch (cached 30 min) with static fallback.
 */
export function getEdgeVoices(): any[] {
  if (voicesCache && Date.now() - voicesCache.ts < VOICES_CACHE_MS) {
    return voicesCache.data;
  }
  try {
    const { stdout } = execSyncSafe(`${getPythonBin()} -m edge_tts --list-voices`, 20000);
    const voices = stdout
      .split("\n")
      // edge-tts lists every voice line as "Name  Gender  ContentCategories  VoicePersonalities";
      // names end with "Neural" (e.g. en-US-AriaNeural) or "MultilingualNeural" — no hyphen before Neural.
      .filter((l: string) => l.includes("Neural") || l.includes("Multilingual"))
      .map((l: string) => {
        const parts = l.split(/\s{2,}/).map((p: string) => p.trim()).filter(Boolean);
        const name = parts[0] || "";
        const gender = parts.find((p: string) => p === "Male" || p === "Female") || "Female";
        // edge-tts has no Locale column; locale is the ShortName prefix, e.g. "af-ZA-AdriNeural" -> "af-ZA"
        const locale = name.match(/^[a-z]{2}-[A-Z]{2}/)?.[0] || "";
        return { ShortName: name, Gender: gender, Locale: locale, FriendlyName: l.trim() };
      })
      .filter((v: any) => v.ShortName);
    if (voices.length > 0) {
      voicesCache = { data: voices, ts: Date.now() };
      return voices;
    }
  } catch {
    // offline / module missing — fall through to static list
  }
  return STATIC_EDGE_VOICES;
}

/** Emotion preset → edge-tts rate/pitch */
export function sceneRatePitch(emotion: string): { rate: string; pitch: string } {
  switch ((emotion || "neutral").toLowerCase()) {
    case "excited": return { rate: "+22%", pitch: "+9Hz" };
    case "happy": return { rate: "+10%", pitch: "+5Hz" };
    case "sad": return { rate: "-12%", pitch: "-6Hz" };
    case "angry": return { rate: "+16%", pitch: "+11Hz" };
    case "whisper": return { rate: "-8%", pitch: "-3Hz" };
    default: return { rate: "+0%", pitch: "+0Hz" };
  }
}

/** Run a python edge-tts call for a single clip; returns duration */
export function generateTtsClip(text: string, voice: string, rate: string, pitch: string, outPath: string): { duration: number } {
  const textFile = path.join(path.dirname(outPath), `tts_text_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.txt`);
  fs.writeFileSync(textFile, text, "utf-8");
  try {
    execSyncSafe(
      `${getPythonBin()} "${path.join(process.cwd(), "server", "tts.py")}" "${textFile}" "${voice}" "${outPath}" "${rate}" "${pitch}"`,
      120000
    );
    if (!fs.existsSync(outPath)) {
      throw new Error("TTS generation produced no output file");
    }
    const { stdout } = execSyncSafe(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outPath}"`, 15000);
    return { duration: parseFloat((stdout || "0").trim()) || 0 };
  } finally {
    try { fs.unlinkSync(textFile); } catch { /* noop */ }
  }
}

/**
 * Build a single project-wide voiceover track from per-scene clips.
 * Scenes WITHOUT a voiceUrl/voice/emotion are skipped (their original audio stays).
 * Returns the concat file path (null if nothing to build) and stores the track
 * into project.settings.audioSettings.voiceoverTrack for the render pipeline.
 */
export function buildSceneVoiceover(project: any): { filePath: string; duration: number } | null {
  const scenes = DB.getScenes(project.id).sort((a: any, b: any) => a.sceneIndex - b.sceneIndex);
  const withVoice = scenes.filter((s: any) => s.voiceUrl && fs.existsSync(s.voiceUrl) && (s.text || "").trim());
  if (withVoice.length === 0) return null;

  const projectDir = path.join(process.cwd(), "storage", "projects", project.id);
  const audioDir = path.join(projectDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const segments: string[] = [];
  for (const scene of withVoice) {
    const segPath = path.join(audioDir, `scene_voice_concat_${scene.sceneIndex}_${Date.now()}.mp3`);
    try {
      // If the stored clip has silences trimmed by its own duration target, use as-is.
      fs.copyFileSync(scene.voiceUrl, segPath);
      segments.push(segPath);
    } catch {
      // fallback: regenerate from scene text
      try {
        const voice = scene.voice || project.settings.edgeTtsVoice || "en-US-AriaNeural";
        const { rate, pitch } = sceneRatePitch(scene.emotion || "neutral");
        generateTtsClip(scene.text, voice, rate, pitch, segPath);
        segments.push(segPath);
      } catch (e: any) {
        console.log(`sceneVoice: skip scene ${scene.sceneIndex} (${e.message?.slice(0, 60)})`);
      }
    }
  }
  if (segments.length === 0) return null;

  const concatFile = path.join(projectDir, "scene_voiceover_concat.txt");
  fs.writeFileSync(concatFile, segments.map((s: string) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"), "utf-8");
  const outPath = path.join(projectDir, "scene_voiceover.mp3");
  execSyncSafe(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a libmp3lame -b:a 192k "${outPath}"`,
    180000
  );
  if (!fs.existsSync(outPath)) return null;

  const { stdout } = execSyncSafe(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outPath}"`, 15000);
  const duration = parseFloat((stdout || "0").trim()) || 0;

  // Register as the project voiceover track so the audio-mix step picks it up
  if (!project.settings.audioSettings) project.settings.audioSettings = {};
  project.settings.audioSettings.voiceoverTrack = {
    type: "voiceover",
    url: `/api/projects/${project.id}/audio/voiceover`,
    filePath: outPath,
    fileName: "scene_voiceover.mp3",
    fileSize: fs.statSync(outPath).size,
    duration,
    format: "mp3"
  };
  DB.saveProject(project);

  // Cleanup segment copies
  segments.forEach((s: string) => { try { fs.unlinkSync(s); } catch { /* noop */ } });
  return { filePath: outPath, duration };
}

function execSyncSafe(cmd: string, timeoutMs: number): { stdout: string } {
  const stdout = execSync(cmd, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { stdout: stdout.toString() };
}
