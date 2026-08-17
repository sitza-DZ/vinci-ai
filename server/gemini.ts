import { GoogleGenAI, Type } from "@google/genai";
import { DB } from "./db";
import { decrypt } from "./crypto";

function getAI(): GoogleGenAI {
  let key = "";
  try {
    const dbKeyConfig = DB.getApiKeyById("gemini");
    if (dbKeyConfig && dbKeyConfig.encryptedKey && dbKeyConfig.enabled) {
      key = decrypt(dbKeyConfig.encryptedKey);
      // Increment use count
      dbKeyConfig.useCount = (dbKeyConfig.useCount || 0) + 1;
      DB.saveApiKey(dbKeyConfig);
    }
  } catch (e) {
    console.error("Failed to read Gemini key from db, falling back to process.env", e);
  }

  if (!key) {
    key = process.env.GEMINI_API_KEY || "";
  }

  if (!key || key === "MY_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY is not configured in your settings or Environment Secrets. Please add it via Settings > API Keys.");
  }

  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

export class GeminiService {
  /**
   * v16: Parse a trailing language directive from the topic, e.g.
   *   "5 secrets of tribes IN HINDI"  ->  topic "5 secrets of tribes", narration in Devanagari Hindi.
   * Returns the cleaned topic plus a prompt instruction forcing the NATIVE script
   * (so "IN HINDI" yields Devanagari हिंदी, NOT Roman/Hinglish).
   */
  static parseLanguageDirective(topic: string): { cleanTopic: string; languageInstruction: string } {
    const raw = (topic || "").trim();
    // Match a trailing "IN <LANGUAGE>" (optionally "IN <LANGUAGE> LANGUAGE") directive.
    const m = raw.match(/\s+in\s+([a-zA-Z][a-zA-Z\s]{1,30}?)(\s+language)?\s*$/i);
    if (!m) return { cleanTopic: raw, languageInstruction: "" };

    const lang = m[1].trim().toLowerCase();
    const cleanTopic = raw.slice(0, m.index).trim() || raw;

    // Map common language names to a strict native-script instruction.
    const nativeScriptMap: Record<string, string> = {
      "hindi": "Hindi written in Devanagari script (हिंदी)",
      "urdu": "Urdu written in Nastaliq/Arabic script (اردو)",
      "punjabi": "Punjabi written in Gurmukhi script (ਪੰਜਾਬੀ)",
      "bengali": "Bengali written in Bengali script (বাংলা)",
      "marathi": "Marathi written in Devanagari script (मराठी)",
      "gujarati": "Gujarati written in Gujarati script (ગુજરાતી)",
      "tamil": "Tamil written in Tamil script (தமிழ்)",
      "telugu": "Telugu written in Telugu script (తెలుగు)",
      "kannada": "Kannada written in Kannada script (ಕನ್ನಡ)",
      "malayalam": "Malayalam written in Malayalam script (മലയാളം)",
      "spanish": "Spanish (Español)",
      "french": "French (Français)",
      "german": "German (Deutsch)",
      "portuguese": "Portuguese (Português)",
      "arabic": "Arabic written in Arabic script (العربية)",
      "russian": "Russian written in Cyrillic script (Русский)",
      "japanese": "Japanese (日本語)",
      "korean": "Korean written in Hangul script (한국어)",
      "chinese": "Chinese written in Chinese characters (中文)",
      "mandarin": "Chinese written in Chinese characters (中文)",
      "italian": "Italian (Italiano)",
      "turkish": "Turkish (Türkçe)",
      "indonesian": "Indonesian (Bahasa Indonesia)",
      "vietnamese": "Vietnamese (Tiếng Việt)",
      "thai": "Thai written in Thai script (ไทย)",
    };

    const native = nativeScriptMap[lang];
    // Guard against false positives like "places in india": only honour the directive
    // when the word is a known language, OR the user wrote it in UPPERCASE ("IN HINDI").
    const directiveText = raw.slice(m.index).trim();
    const isUppercaseDirective = /^IN\s+[A-Z]/.test(directiveText);
    if (!native && !isUppercaseDirective) {
      return { cleanTopic: raw, languageInstruction: "" };
    }

    if (!native) {
      // Unknown language but explicit uppercase directive — still honour it generically.
      return {
        cleanTopic,
        languageInstruction: `The narration text and hooks MUST be written in ${m[1].trim()} using its NATIVE script (not romanized/transliterated).`
      };
    }

    return {
      cleanTopic,
      languageInstruction:
        `The narration text ("text") and hook ("hook") for every scene MUST be written in ${native} using its NATIVE script. ` +
        `CRITICAL: Do NOT use Roman/Latin letters or transliteration (no Hinglish/Roman-Hindi). Write the actual native characters. ` +
        `Keep the video TITLE in English, and keep all "visualDescription" and "keywords" in English (they are used for stock footage search).`
    };
  }

  /**
   * Generates a viral vertical short script and breaks it down into individual scenes
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
    const ai = getAI();
    
    // Estimate scenes: typically a short is 15s to 60s. Target ~5s per scene.
    const sceneCount = Math.max(3, Math.round(targetDuration / 5));

    // v16: honour a trailing "IN <LANGUAGE>" directive (e.g. "... IN HINDI" -> Devanagari)
    const { cleanTopic, languageInstruction } = GeminiService.parseLanguageDirective(topic);
    
    const prompt = `
      Create a viral YouTube Shorts/TikTok/Reels script about the topic: "${cleanTopic}".
      Target total duration is ${targetDuration} seconds.

      IMPORTANT: The video TITLE must be in ENGLISH only, even if the script narration is in another language.
      ${languageInstruction}

      You must split the script into exactly ${sceneCount} logical consecutive scenes. Each scene should last around 4 to 6 seconds.
      Each scene needs:
      1. Narration text (highly engaging, dynamic, punchy sentence to be spoken/shown as subtitles).
      2. A HOOK text (1-3 words, attention-grabbing, like "Mind Blown! 🤯", "Wait for it...", "This is CRAZY", "You Won't Believe", "OMG 😱"). The hook should be something that makes viewers stop scrolling.
      3. Clear visual description of the ideal footage to match (e.g. "Slow motion tracking shot of starry space nebula, glowing purple, highly detailed").
      4. Precise search keywords (3-5 english tags to find stock footage, e.g. ["galaxy", "nebula", "space stars", "purple sky"]). EACH keyword MUST be 1-3 words maximum. No full sentences or descriptive phrases.
      
      Also provide a catchy viral title for this short.
      Return the output as a strict JSON object that conforms to the requested structure.
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "A highly click-worthy, viral title for the short video" },
              script: { type: Type.STRING, description: "The complete narration text of the script joined together" },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING, description: "The narration sentence or phrase for this scene" },
                    hook: { type: Type.STRING, description: "A 1-3 word attention-grabbing hook text like 'Mind Blown!' or 'Wait for it...' to make viewers stop scrolling" },
                    visualDescription: { type: Type.STRING, description: "Detailed visual description of stock footage to search for" },
                    keywords: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "3-5 search keywords to query video stock sites"
                    },
                    duration: { type: Type.NUMBER, description: "Estimated scene duration in seconds (usually 4 to 6)" }
                  },
                  required: ["text", "hook", "visualDescription", "keywords", "duration"]
                }
              }
            },
            required: ["title", "script", "scenes"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error("No script text was generated by Gemini");
      }
      return JSON.parse(resultText);
    } catch (error: any) {
      console.error("Error generating script from Gemini:", error);
      throw error;
    }
  }

  /**
   * Takes a pre-written script and breaks it down into logical visual scenes
   */
  static async breakScriptIntoScenes(customScript: string, targetDuration: number): Promise<{
    title: string;
    scenes: {
      text: string;
      visualDescription: string;
      keywords: string[];
      duration: number;
    }[];
  }> {
    const ai = getAI();
    // Estimate scenes: about 1 scene per 5 seconds of footage
    const sceneCount = Math.max(3, Math.round(targetDuration / 5));

    const prompt = `
      You are a vertical video expert. I have a custom script:
      "${customScript}"
      
      I want to turn this script into a vertical short of approximately ${targetDuration} seconds.
      Please split this exact script into exactly ${sceneCount} logical, consecutive, evenly timed segments/scenes.
      Do not change my words, but divide them sequentially among the scenes.
      
      For each scene, generate:
      1. The exact segment of script text.
      2. A HOOK text (1-3 words, attention-grabbing, like "This is INSANE", "Wait till the end", "OMG 😱", "You won't believe").
      3. A vivid description of the ideal matching stock footage.
      4. Stock video search keywords (3-5 English keywords, each 1-3 words MAXIMUM. NO full sentences. Example: ["space stars", "nebula", "galaxy"] NOT "a beautiful space with stars").
      5. Estimated duration in seconds (sum of all scene durations must equal approximately ${targetDuration} seconds).
      
      Also generate a viral title for this short.
      Return the output as a strict JSON object.
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "A clickbait style catchy title based on the script" },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING, description: "The sequential segment of original script text" },
                    hook: { type: Type.STRING, description: "A 1-3 word attention-grabbing hook text like 'This is INSANE' or 'Wait till the end'" },
                    visualDescription: { type: Type.STRING, description: "Vivid description of matching footage to support this narration segment" },
                    keywords: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    duration: { type: Type.NUMBER }
                  },
                  required: ["text", "hook", "visualDescription", "keywords", "duration"]
                }
              }
            },
            required: ["title", "scenes"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error("No response text from Gemini scene breakdown");
      }
      return JSON.parse(resultText);
    } catch (error: any) {
      console.error("Error breaking script into scenes:", error);
      throw error;
    }
  }

  /**
   * Scores a stock clip's relevance based on scene visual description and video metadata
   */
  static localScoreClip(sceneVisual: string, clipMetadata: {
    title: string;
    tags: string[];
    description?: string;
  }): { score: number; reason: string } {
    let score = 60;
    const descWords = sceneVisual.toLowerCase();
    const titleWords = clipMetadata.title.toLowerCase();
    
    // Check keyword overlaps with tags
    let matchedTagsCount = 0;
    clipMetadata.tags.forEach(tag => {
      const cleanTag = tag.toLowerCase().trim();
      if (cleanTag && (descWords.includes(cleanTag) || cleanTag.includes(descWords))) {
        score += 8;
        matchedTagsCount++;
      }
    });

    // Check overlaps with title words
    const titleTokens = titleWords.split(/[\s,_.\-\/]+/);
    let matchedTitleWords = 0;
    titleTokens.forEach(word => {
      if (word.length > 3 && descWords.includes(word)) {
        score += 6;
        matchedTitleWords++;
      }
    });

    return {
      score: Math.min(score, 98),
      reason: `Matched ${matchedTagsCount} tags and ${matchedTitleWords} title words via local relevance engine.`
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
    score: number; // 0 to 100
    reason: string;
  }> {
    try {
      let hasPersonalKey = false;
      try {
        const dbKeyConfig = DB.getApiKeyById("gemini");
        if (dbKeyConfig && dbKeyConfig.encryptedKey && dbKeyConfig.enabled) {
          hasPersonalKey = true;
        }
      } catch (e) {
        // Ignore
      }

      if (!hasPersonalKey) {
        return this.localScoreClip(sceneVisual, clipMetadata);
      }

      const ai = getAI();
      const prompt = `
        You are an AI editor scoring stock footage matching.
        
        Target Scene Desired Visuals:
        "${sceneVisual}"
        
        Candidate Stock Video Metadata:
        - Title: "${clipMetadata.title}"
        - Tags: [${clipMetadata.tags.join(", ")}]
        - Description: "${clipMetadata.description || ""}"
        
        Analyze the candidate video based on:
        1. Contextual alignment (does the clip portray what the scene describes?).
        2. Visual consistency (does it fit a premium creator aesthetic?).
        3. Action alignment.
        
        Assign an overall relevance score from 0 to 100.
        Provide a very short 1-sentence reason.
        
        Return a strict JSON object with 'score' and 'reason'.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.INTEGER, description: "Matching score from 0 (completely unrelated) to 100 (perfect match)" },
              reason: { type: Type.STRING, description: "Brief explanation of the score" }
            },
            required: ["score", "reason"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) {
        return { score: 70, reason: "Default score due to empty model response." };
      }
      return JSON.parse(resultText);
    } catch (e: any) {
      console.warn("Gemini scoring unavailable (quota or unconfigured), using local relevance engine:", e.message || e);
      return this.localScoreClip(sceneVisual, clipMetadata);
    }
  }

  /**
   * Generates SEO details (Title, Meta description, hashtags) for the short
   */
  static async generateSEO(title: string, script: string): Promise<{
    viralTitle: string;
    description: string;
    hashtags: string[];
  }> {
    try {
      const ai = getAI();
      const prompt = `
        Generate premium viral marketing details for this vertical short video.
        Original Draft Title: "${title}"
        Script Narration: "${script}"

        IMPORTANT: The title, description, and hashtags must ALL be in ENGLISH only, regardless of the script language.

        Create:
        1. An ultra-engaging, high click-through-rate viral ENGLISH title (incorporate emojis where suitable).
        2. A premium SEO description in ENGLISH optimizing YouTube Shorts algorithms.
        3. A curated list of 5-8 highly relevant viral hashtags.

        Return a JSON object.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              viralTitle: { type: Type.STRING },
              description: { type: Type.STRING },
              hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["viralTitle", "description", "hashtags"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error("No SEO text generated");
      }
      return JSON.parse(resultText);
    } catch (e) {
      return {
        viralTitle: title,
        description: `Viral short about: ${title}. Built with AI Shorts Generator.`,
        hashtags: ["#shorts", "#viral", "#ai", "#trending"]
      };
    }
  }

  /**
   * v14: Script Rewriter — rewrite a script in viral short-form style.
   * Adds strong hooks, curiosity gaps, punchy pacing while keeping the core message.
   */
  static async rewriteScript(script: string, style: "viral" | "storytelling" | "educational" | "dramatic" = "viral"): Promise<{
    rewrittenScript: string;
    hook: string;
    changes: string[];
  }> {
    try {
      const ai = getAI();
      const styleGuide: Record<string, string> = {
        viral: "punchy, high-energy, curiosity-gap driven, MrBeast-style hooks, short sentences, pattern interrupts",
        storytelling: "narrative arc, emotional build-up, open loops, 'but then...' tension, satisfying payoff",
        educational: "clear value-first structure, 'here's what nobody tells you' framing, numbered insights, memorable takeaways",
        dramatic: "cinematic tension, slow reveals, stakes escalation, cliffhanger beats, powerful closing line"
      };
      const prompt = `You are an elite short-form video script doctor (TikTok/Reels/Shorts). Rewrite the following script in a ${style} style: ${styleGuide[style]}.

ORIGINAL SCRIPT:
"""
${script}
"""

RULES:
- Keep the SAME core message/facts — do not invent new facts.
- Keep roughly the same length (±20%).
- The first line MUST be a scroll-stopping hook (question, shocking claim, or bold promise).
- Add at least 2 curiosity gaps ("but here's the crazy part...", "wait until you see...").
- Write for spoken narration — short sentences, natural rhythm, no markdown.
- Keep the same language as the original script.

Return a JSON object with:
- "rewrittenScript": the full rewritten script (plain text, line breaks between beats)
- "hook": just the opening hook line
- "changes": array of 3-5 short strings describing what you improved`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rewrittenScript: { type: Type.STRING },
              hook: { type: Type.STRING },
              changes: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["rewrittenScript", "hook", "changes"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) throw new Error("No rewrite generated");
      return JSON.parse(resultText);
    } catch (e: any) {
      throw new Error(`Script rewrite failed: ${e?.message?.slice(0, 120) || "unknown error"}`);
    }
  }

  /**
   * v16: A/B Title Generator — 3 title variants with predicted CTR scores + winner.
   * Each variant uses a different psychological angle; AI predicts CTR for each.
   */
  static async generateABTitles(title: string, script: string): Promise<{
    variants: { title: string; angle: string; ctrScore: number; reasoning: string }[];
    winner: number;
    insight: string;
  }> {
    try {
      const ai = getAI();
      const prompt = `You are a YouTube Shorts / TikTok title optimization expert.

Video draft title: "${title}"
Script narration: "${script.slice(0, 1500)}"

Generate EXACTLY 3 title variants in ENGLISH, each using a DIFFERENT psychological angle:
1. Curiosity Gap — tease the payoff without revealing it
2. Bold Claim / Shock — a strong, surprising statement
3. Direct Benefit / Listicle — what the viewer gets

For EACH variant predict a CTR score (0-100) based on:
- Hook strength in first 3 words
- Emotional trigger intensity
- Specificity (numbers, names, stakes)
- Length (ideal 40-60 chars for Shorts)
- Pattern-interrupt potential

Be a harsh, realistic scorer — typical titles score 30-50, exceptional ones 70+.

Return a JSON object:
{
  "variants": [
    { "title": "...", "angle": "Curiosity Gap", "ctrScore": 62, "reasoning": "one short sentence why this score" },
    { "title": "...", "angle": "Bold Claim", "ctrScore": 55, "reasoning": "..." },
    { "title": "...", "angle": "Direct Benefit", "ctrScore": 48, "reasoning": "..." }
  ],
  "winner": 0,
  "insight": "one sentence on what makes the winner outperform the others"
}
"winner" is the 0-based index of the highest CTR variant.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              variants: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    angle: { type: Type.STRING },
                    ctrScore: { type: Type.NUMBER },
                    reasoning: { type: Type.STRING }
                  },
                  required: ["title", "angle", "ctrScore", "reasoning"]
                }
              },
              winner: { type: Type.NUMBER },
              insight: { type: Type.STRING }
            },
            required: ["variants", "winner", "insight"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) throw new Error("No A/B titles generated");
      const parsed = JSON.parse(resultText);
      // Safety: ensure winner index is valid
      if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
        throw new Error("AI returned no title variants");
      }
      parsed.winner = Math.min(Math.max(0, Math.floor(parsed.winner || 0)), parsed.variants.length - 1);
      return parsed;
    } catch (e: any) {
      throw new Error(`A/B title generation failed: ${e?.message?.slice(0, 120) || "unknown error"}`);
    }
  }

  /**
   * Autopilot: generate a batch of concrete, viral-ready video topics for a niche/category.
   * Returns { topics: string[] }.
   */
  static async generateTopics(category: string, count: number): Promise<{ topics: string[] }> {
    const ai = getAI();
    const prompt = `You are a viral short-form video strategist. Generate ${count} highly engaging, SPECIFIC video topics for the "${category}" niche. Each topic must be a concrete, curiosity-driven idea suitable for a 30-60 second vertical video that could go viral on YouTube Shorts/TikTok. Avoid vague topics. Return a JSON object with this exact structure: { "topics": ["topic 1", "topic 2", ...] }`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              topics: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["topics"]
          }
        }
      });
      const resultText = response.text;
      if (!resultText) throw new Error("No topics generated");
      const parsed = JSON.parse(resultText);
      if (!Array.isArray(parsed.topics) || parsed.topics.length === 0) {
        throw new Error("AI returned no topics");
      }
      return { topics: parsed.topics.slice(0, count) };
    } catch (e: any) {
      throw new Error(`Topic generation failed: ${e?.message?.slice(0, 120) || "unknown error"}`);
    }
  }

  /**
   * Autopilot: generate catchy, clickable title options for one video topic.
   * Returns { titles: string[] }.
   */
  static async generateTitles(topic: string, count: number): Promise<{ titles: string[] }> {
    const ai = getAI();
    const prompt = `You are a YouTube Shorts title expert. Write ${count} different, highly clickable, viral titles for a short video about: "${topic}". Rules: max 70 characters each, curiosity-driven, no false clickbait, at most 1 emoji per title. Return a JSON object with this exact structure: { "titles": ["title 1", "title 2", ...] }`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              titles: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["titles"]
          }
        }
      });
      const resultText = response.text;
      if (!resultText) throw new Error("No titles generated");
      const parsed = JSON.parse(resultText);
      if (!Array.isArray(parsed.titles) || parsed.titles.length === 0) {
        throw new Error("AI returned no titles");
      }
      return { titles: parsed.titles.slice(0, count) };
    } catch (e: any) {
      throw new Error(`Title generation failed: ${e?.message?.slice(0, 120) || "unknown error"}`);
    }
  }
}
