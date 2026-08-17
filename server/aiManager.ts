import { DB } from "./db";
import { decrypt } from "./crypto";
import { GeminiService } from "./gemini";
import { AIMode, AIProviderType, SmartRoutingStrategy } from "../src/types";

function getApiKey(providerId: AIProviderType): string {
  try {
    const config = DB.getApiKeyById(providerId);
    if (config && config.encryptedKey && config.enabled) {
      return decrypt(config.encryptedKey);
    }
  } catch (e) {
    console.error(`Failed to decrypt API key for ${providerId}:`, e);
  }
  
  // Specific fallback for Gemini to process.env
  if (providerId === "gemini") {
    return process.env.GEMINI_API_KEY || "";
  }
  
  return "";
}

function parseCleanJSON(text: string): any {
  let clean = text.trim();
  if (clean.startsWith("```")) {
    const lines = clean.split("\n");
    if (lines[0].startsWith("```")) {
      lines.shift();
    }
    if (lines[lines.length - 1].startsWith("```")) {
      lines.pop();
    }
    clean = lines.join("\n").trim();
  }
  
  // Find first { and last } to handle any text before/after JSON
  const startIdx = clean.indexOf("{");
  const endIdx = clean.lastIndexOf("}");
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    clean = clean.slice(startIdx, endIdx + 1);
  }

  // Sanitize control characters that break JSON.parse
  // Removes/replaces bad chars: \x00-\x08, \x0B, \x0C, \x0E-\x1F
  // Keeps valid escapes: \n, \t, \r, \\, \", etc.
  clean = clean.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  // Also handle common bad escape sequences like unterminated backslash at end of string
  clean = clean.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");

  const parsed = JSON.parse(clean);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("AI response is not a valid JSON object");
  }
  return parsed;
}

// Common Hindi/Urdu words mapped to English stock photo keywords
const TRANSLATION_MAP: Record<string, string> = {
  "प्रकृति": "nature", "पहाड़": "mountain", "समुद्र": "ocean", "जंगल": "forest",
  "आकाश": "sky", "तारे": "stars", "चांद": "moon", "सूरज": "sun",
  "फूल": "flowers", "पानी": "water", "बारिश": "rain", "बादल": "clouds",
  "शहर": "city", "सड़क": "road", "इमारत": "building", "घर": "house",
  "कार": "car", "हवाई जहाज": "airplane", "यात्रा": "travel", "समय": "time",
  "व्यवसाय": "business", "पैसा": "money", "काम": "work", "सफलता": "success",
  "प्रौद्योगिकी": "technology", "कंप्यूटर": "computer", "मोबाइल": "mobile",
  "स्वास्थ्य": "health", "व्यायाम": "exercise", "दौड़": "running",
  "खाना": "food", "खेल": "sports", "संगीत": "music",
  "प्यार": "love", "दोस्त": "friends", "परिवार": "family",
  "सपना": "dream", "जीवन": "life", "दुनिया": "world",
  "अंतरिक्ष": "space", "ग्रह": "planet", "विज्ञान": "science",
  "सौंदर्य": "beauty", "कला": "art", "फैशन": "fashion",
  "शिक्षा": "education", "पुस्तक": "book", "ज्ञान": "knowledge",
  "खुशी": "happiness", "शांति": "peace", "स्वतंत्रता": "freedom",
  "बच्चे": "children", "जानवर": "animals",
  // Urdu words
  "قدرت": "nature", "پہاڑ": "mountain", "سمندر": "ocean", "جنگل": "forest",
  "آسمان": "sky", "ستارے": "stars", "چاند": "moon", "سورج": "sun",
  "پھول": "flowers", "پانی": "water", "بارش": "rain", "بادل": "clouds",
  "شہر": "city", "سڑک": "road", "عمارت": "building", "گھر": "house",
  "کار": "car", "ہوائی جہاز": "airplane", "وقت": "time", "سفر": "travel",
  "کاروبار": "business", "پیسہ": "money", "کام": "work", "کامیابی": "success",
  "ٹیکنالوجی": "technology", "کمپیوٹر": "computer",
  "صحت": "health", "ورزش": "exercise",
  "کھانا": "food", "کھیل": "sports", "موسیقی": "music",
  "محبت": "love", "دوست": "friends", "خاندان": "family",
  "خواب": "dream", "زندگی": "life", "دنیا": "world",
  "خلاء": "space", "سیارہ": "planet", "سائنس": "science",
  "خوبصورتی": "beauty", "فن": "art", "فیشن": "fashion",
  "تعلیم": "education", "کتاب": "book", "علم": "knowledge",
  "خوشی": "happiness", "امن": "peace", "آزادی": "freedom"
};

/** Sanitize scene keywords: translate non-English to English, remove duplicates, truncate to max 3 words */
function sanitizeKeywords(keywords: string[]): string[] {
  const english: string[] = [];
  for (const kw of keywords) {
    const cleaned = kw.toLowerCase().trim().replace(/[.,!?;:]+$/, '');
    if (TRANSLATION_MAP[cleaned]) {
      english.push(TRANSLATION_MAP[cleaned]);
    } else if (/^[a-zA-Z0-9\s\-]+$/.test(cleaned)) {
      const words = cleaned.split(/\s+/).filter(Boolean);
      const truncated = words.length > 3 ? words.slice(0, 3).join(" ") : words.join(" ");
      if (truncated) english.push(truncated);
    } else {
      english.push("stock footage");
    }
  }
  return [...new Set(english)].filter(Boolean);
}

// Low-level fetch wrapper for OpenAI-compatible providers (Groq, OpenRouter, and NVIDIA NIM)
async function callOpenAICompatible(
  provider: AIProviderType,
  apiKey: string,
  model: string,
  prompt: string,
  jsonMode = true
): Promise<string> {
  const url = provider === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : provider === "nvidia"
    ? "https://integrate.api.nvidia.com/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://ai.studio/build";
    headers["X-Title"] = "AI Shorts Video Creator";
  }

  const payload: any = {
    model: model,
    messages: [
      {
        role: "system",
        content: jsonMode 
          ? "You are a professional assistant designed to output strict JSON content only. Do not wrap your response in markdown code blocks unless requested, and never output conversational preambles." 
          : "You are a professional video content and SEO optimization assistant."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.7,
  };

  if (jsonMode) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[${provider.toUpperCase()} API Error] Status ${response.status}: ${errorText}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Empty response from ${provider.toUpperCase()}`);
  }

  return content;
}

export class AIProviderManager {
  /**
   * Sorts and returns the list of candidate providers to attempt based on user configuration, smart routing, and key availability.
   */
  static getCandidates(): AIProviderType[] {
    const settings = DB.getAiSystemSettings();
    const mode = settings.activeMode || "auto";
    const routing = settings.smartRouting || "auto";

    // 1. Establish initial attempt order
    let order: AIProviderType[] = ["gemini", "groq", "openrouter", "nvidia"];

    if (mode === "gemini") {
      order = ["gemini"];
    } else if (mode === "groq") {
      order = ["groq"];
    } else if (mode === "openrouter") {
      order = ["openrouter"];
    } else if (mode === "nvidia") {
      order = ["nvidia"];
    } else if (mode === "auto") {
      if (routing === "cheapest") {
        order = ["groq", "openrouter", "nvidia", "gemini"];
      } else if (routing === "fastest") {
        order = ["groq", "gemini", "nvidia", "openrouter"];
      } else if (routing === "quality") {
        order = ["gemini", "nvidia", "openrouter", "groq"];
      } else {
        order = ["gemini", "groq", "openrouter", "nvidia"];
      }
    }

    // 2. Filter candidates to only those that are enabled and configured with an API key
    const filtered = order.filter(provider => {
      const config = DB.getApiKeyById(provider);
      
      // For Gemini, we also allow the process.env key fallback
      const hasKey = getApiKey(provider) !== "";
      const isEnabled = config ? config.enabled : true;

      return hasKey && isEnabled;
    });

    // If everything is empty, return the original default list so that the service layer attempts them and throws proper API Key configuration warnings.
    if (filtered.length === 0) {
      return ["gemini"];
    }

    return filtered;
  }

  /**
   * Generates a viral vertical short script and breaks it down into individual scenes with automatic failover support
   */
  static async generateScriptAndScenes(topic: string, targetDuration: number): Promise<{
    title: string;
    script: string;
    scenes: {
      text: string;
      hook?: string;
      visualDescription: string;
      keywords: string[];
      duration: number;
    }[];
  }> {
    const candidates = this.getCandidates();
    let lastError: Error | null = null;

    console.log(`[AI MANAGER] Script generation requested for "${topic}" (${targetDuration}s). Candidates: ${candidates.join(" -> ")}`);

    for (const provider of candidates) {
      try {
        console.log(`[AI MANAGER] Attempting script generation with provider: ${provider}`);
        let result: any;

        if (provider === "gemini") {
          result = await GeminiService.generateScriptAndScenes(topic, targetDuration);
          // GeminiService has its own internal DB.saveApiKey useCount tracker, but we also increment stats
          DB.incrementAiRequest("gemini", true);
        } else {
          const apiKey = getApiKey(provider);
          const model = provider === "groq" ? "llama-3.3-70b-versatile" : provider === "nvidia" ? (DB.getApiKeyById("nvidia")?.model || "nvidia/llama-3.1-nemotron-70b-instruct") : "meta-llama/llama-3.3-70b-instruct";
          
          const sceneCount = Math.max(3, Math.round(targetDuration / 5));
          // v16: honour a trailing "IN <LANGUAGE>" directive (e.g. "... IN HINDI" -> Devanagari)
          const { cleanTopic, languageInstruction } = GeminiService.parseLanguageDirective(topic);
          const prompt = `
            Create a viral short video script about: "${cleanTopic}".
            Target duration is ${targetDuration} seconds.
            ${languageInstruction}
            You must split the script into exactly ${sceneCount} logical consecutive scenes. Each scene should last around 4 to 6 seconds.

            IMPORTANT: Each keyword must be 1-3 words MAXIMUM. No descriptive phrases or full sentences. Keywords should be specific, concise search terms optimized for stock video sites like Pexels and Pixabay. Example: ["galaxy", "nebula stars", "purple space"] NOT "a beautiful galaxy in outer space with stars".

            Return a JSON object with this exact structure:
            {
              "title": "catchy viral title",
              "script": "complete narration text joined together",
              "scenes": [
                {
                  "text": "narration sentence",
                  "hook": "1-3 word attention-grabbing hook",
                  "visualDescription": "detailed visual description of stock footage to search for (English only)",
                  "keywords": ["keyword1", "keyword2", "keyword3"],
                  "duration": 5
                }
              ]
            }
          `;

          const rawResponse = await callOpenAICompatible(provider, apiKey, model, prompt, true);
          result = parseCleanJSON(rawResponse);
          DB.incrementAiRequest(provider, true);
        }

        console.log(`[AI MANAGER] Script generation SUCCEEDED with provider: ${provider}`);
        // Force English keywords for stock footage search
        if (result?.scenes && Array.isArray(result.scenes)) {
          result.scenes = result.scenes.map((s: any) => ({
            ...s,
            keywords: sanitizeKeywords(s.keywords || [])
          }));
        }
        return result;
      } catch (err: any) {
        console.error(`[AI MANAGER] Provider ${provider} FAILED:`, err.message || err);
        DB.incrementAiRequest(provider, false);
        lastError = err;
        // Continue to the next provider in list (Failover)
      }
    }

    throw new Error(`AI System Failure: All enabled AI Providers failed to generate script. Last error: ${lastError?.message}`);
  }

  /**
   * Takes a pre-written script and breaks it down into logical visual scenes with automatic failover support
   */
  static async breakScriptIntoScenes(customScript: string, targetDuration: number): Promise<{
    title: string;
    scenes: {
      text: string;
      hook?: string;
      visualDescription: string;
      keywords: string[];
      duration: number;
    }[];
  }> {
    const candidates = this.getCandidates();
    let lastError: Error | null = null;

    console.log(`[AI MANAGER] Script breakdown requested. Candidates: ${candidates.join(" -> ")}`);

    for (const provider of candidates) {
      try {
        console.log(`[AI MANAGER] Attempting script breakdown with provider: ${provider}`);
        let result: any;

        if (provider === "gemini") {
          result = await GeminiService.breakScriptIntoScenes(customScript, targetDuration);
          DB.incrementAiRequest("gemini", true);
        } else {
          const apiKey = getApiKey(provider);
          const model = provider === "groq" ? "llama-3.3-70b-versatile" : provider === "nvidia" ? (DB.getApiKeyById("nvidia")?.model || "nvidia/llama-3.1-nemotron-70b-instruct") : "meta-llama/llama-3.3-70b-instruct";
          const sceneCount = Math.max(3, Math.round(targetDuration / 5));
          
          const prompt = `
            You are a vertical video expert. I have a custom script: "${customScript}"
            I want to turn this script into a vertical short of approximately ${targetDuration} seconds.
            Please split this exact script into exactly ${sceneCount} logical, consecutive, evenly timed segments/scenes.

            IMPORTANT: Each keyword must be 1-3 words MAXIMUM. No descriptive phrases or full sentences. Keywords should be short, specific search terms for stock video sites like Pexels and Pixabay. Example: ["space stars", "nebula", "galaxy"] NOT "a beautiful view of space with glowing stars".
            Do not change my words, but divide them sequentially among the scenes.

            Return a JSON object with this exact structure:
            {
              "title": "catchy viral title",
              "scenes": [
                {
                  "text": "original sequential segment of script text",
                  "hook": "1-3 word attention-grabbing hook like 'This is INSANE' or 'Wait till the end'",
                  "visualDescription": "vivid description of matching stock footage",
                  "keywords": ["keyword1", "keyword2"],
                  "duration": 5
                }
              ]
            }
          `;

          const rawResponse = await callOpenAICompatible(provider, apiKey, model, prompt, true);
          result = parseCleanJSON(rawResponse);
          DB.incrementAiRequest(provider, true);
        }

        console.log(`[AI MANAGER] Script breakdown SUCCEEDED with provider: ${provider}`);
        if (result?.scenes && Array.isArray(result.scenes)) {
          result.scenes = result.scenes.map((s: any) => ({
            ...s,
            keywords: sanitizeKeywords(s.keywords || [])
          }));
        }
        return result;
      } catch (err: any) {
        console.error(`[AI MANAGER] Provider ${provider} FAILED:`, err.message || err);
        DB.incrementAiRequest(provider, false);
        lastError = err;
      }
    }

    throw new Error(`AI System Failure: All enabled AI Providers failed to break down script. Last error: ${lastError?.message}`);
  }

  /**
   * Generates SEO details (Title, Meta description, hashtags) with automatic failover support
   */
  static async generateSEO(title: string, script: string): Promise<{
    viralTitle: string;
    description: string;
    hashtags: string[];
  }> {
    const candidates = this.getCandidates();
    let lastError: Error | null = null;

    console.log(`[AI MANAGER] SEO Generation requested. Candidates: ${candidates.join(" -> ")}`);

    for (const provider of candidates) {
      try {
        console.log(`[AI MANAGER] Attempting SEO generation with provider: ${provider}`);
        let result: any;

        if (provider === "gemini") {
          result = await GeminiService.generateSEO(title, script);
          DB.incrementAiRequest("gemini", true);
        } else {
          const apiKey = getApiKey(provider);
          const model = provider === "groq" ? "llama-3.3-70b-versatile" : provider === "nvidia" ? (DB.getApiKeyById("nvidia")?.model || "nvidia/llama-3.1-nemotron-70b-instruct") : "meta-llama/llama-3.3-70b-instruct";
          
          const prompt = `
            Generate premium viral marketing details for this vertical short video.
            Original Draft Title: "${title}"
            Script Narration: "${script}"
            
            Return a JSON object with this exact structure:
            {
              "viralTitle": "A catchy, click-worthy title with emojis",
              "description": "Engaging description for YouTube Shorts/TikTok",
              "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
            }
          `;

          const rawResponse = await callOpenAICompatible(provider, apiKey, model, prompt, true);
          result = parseCleanJSON(rawResponse);
          DB.incrementAiRequest(provider, true);
        }

        console.log(`[AI MANAGER] SEO generation SUCCEEDED with provider: ${provider}`);
        return result;
      } catch (err: any) {
        console.error(`[AI MANAGER] Provider ${provider} FAILED:`, err.message || err);
        DB.incrementAiRequest(provider, false);
        lastError = err;
      }
    }

    // Direct fallback to prevent completely failing the UX
    console.warn("[AI MANAGER] SEO optimization failed on all providers, using local default fallback.");
    return {
      viralTitle: title,
      description: `Viral short about: ${title}. Built with AI Shorts Generator.`,
      hashtags: ["#shorts", "#viral", "#ai", "#trending"]
    };
  }

  /**
   * Scores a stock clip's relevance based on scene visual description and video metadata
   */
  static async scoreClip(sceneVisual: string, clipMetadata: {
    title: string;
    tags: string[];
    description?: string;
  }): Promise<{
    score: number;
    reason: string;
  }> {
    const candidates = this.getCandidates();
    let lastError: Error | null = null;

    for (const provider of candidates) {
      try {
        let result: any;

        if (provider === "gemini") {
          result = await GeminiService.scoreClip(sceneVisual, clipMetadata);
          DB.incrementAiRequest("gemini", true);
        } else {
          const apiKey = getApiKey(provider);
          const model = provider === "groq" ? "llama-3.3-70b-versatile" : provider === "nvidia" ? (DB.getApiKeyById("nvidia")?.model || "nvidia/llama-3.1-nemotron-70b-instruct") : "meta-llama/llama-3.3-70b-instruct";
          
          const prompt = `
            You are an AI editor scoring stock footage matching.
            
            Target Scene Desired Visuals:
            "${sceneVisual}"
            
            Candidate Stock Video Metadata:
            - Title: "${clipMetadata.title}"
            - Tags: [${clipMetadata.tags.join(", ")}]
            - Description: "${clipMetadata.description || ""}"
            
            Assign an overall relevance score from 0 (completely unrelated) to 100 (perfect match).
            Provide a very short 1-sentence reason.
            
            Return a JSON object with this exact structure:
            {
              "score": 85,
              "reason": "Vivid explanation of why the clip matches or doesn't match the scene visuals."
            }
          `;

          const rawResponse = await callOpenAICompatible(provider, apiKey, model, prompt, true);
          result = parseCleanJSON(rawResponse);
          DB.incrementAiRequest(provider, true);
        }

        return result;
      } catch (err: any) {
        console.warn(`[AI MANAGER] Clip scoring failed on provider ${provider}: ${err.message}. Trying next candidate...`);
        DB.incrementAiRequest(provider, false);
        lastError = err;
      }
    }

    // Default to local scoring fallback if all AI options fail
    return GeminiService.localScoreClip(sceneVisual, clipMetadata);
  }

  /**
   * v14: Script Rewriter — rewrite a script in viral short-form style via Gemini.
   */
  static async rewriteScript(script: string, style: "viral" | "storytelling" | "educational" | "dramatic" = "viral"): Promise<{
    rewrittenScript: string;
    hook: string;
    changes: string[];
  }> {
    console.log(`[AI MANAGER] Script rewrite requested (style: ${style})`);
    try {
      const result = await GeminiService.rewriteScript(script, style);
      DB.incrementAiRequest("gemini", true);
      console.log(`[AI MANAGER] Script rewrite SUCCEEDED`);
      return result;
    } catch (err: any) {
      console.error(`[AI MANAGER] Script rewrite FAILED:`, err.message || err);
      DB.incrementAiRequest("gemini", false);
      throw err;
    }
  }

  /**
   * v16: A/B Title Generator — 3 title variants with predicted CTR scores + winner.
   */
  static async generateABTitles(title: string, script: string): Promise<{
    variants: { title: string; angle: string; ctrScore: number; reasoning: string }[];
    winner: number;
    insight: string;
  }> {
    console.log(`[AI MANAGER] A/B title generation requested`);
    try {
      const result = await GeminiService.generateABTitles(title, script);
      DB.incrementAiRequest("gemini", true);
      console.log(`[AI MANAGER] A/B title generation SUCCEEDED (${result.variants.length} variants)`);
      return result;
    } catch (err: any) {
      console.error(`[AI MANAGER] A/B title generation FAILED:`, err.message || err);
      DB.incrementAiRequest("gemini", false);
      throw err;
    }
  }
}
