import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { google } from "googleapis";

const COOKIES_PATH = path.join(process.cwd(), "data", "youtube-cookies.txt");
const TOKENS_PATH = path.join(process.cwd(), "data", "youtube-tokens.json");

function getRequestHost(req?: any): string {
  return (req?.headers?.host || `localhost:${process.env.PORT || "3000"}`).replace("0.0.0.0", "localhost");
}

// Detect the external protocol. Cloudflare tunnel sets X-Forwarded-Proto=https.
function getRequestProto(req?: any): string {
  const fwd = req?.headers?.["x-forwarded-proto"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req?.secure ? "https" : "http";
}

function getYoutubeFrontendApiKey(): string {
  const apiKey = process.env.YOUTUBE_FRONTEND_API_KEY || "";
  if (!apiKey) {
    throw new Error("YOUTUBE_FRONTEND_API_KEY is not configured in .env");
  }
  return apiKey;
}

export function getYoutubeCallbackUrl(req?: any): string {
  return `${getRequestProto(req)}://${getRequestHost(req)}/api/youtube/callback`;
}

export function getYoutubeOAuthClient(req?: any): any {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID || "",
    process.env.YOUTUBE_CLIENT_SECRET || "",
    getYoutubeCallbackUrl(req)
  );
}

// --- OAuth token helpers ---
export function loadYoutubeToken(): any {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
    }
  } catch {}
  return null;
}

export function saveYoutubeToken(tokens: any): void {
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), "utf8");
}

// Refresh expired OAuth token using refresh_token
export async function refreshYoutubeToken(): Promise<boolean> {
  try {
    const tokens = loadYoutubeToken();
    if (!tokens?.refresh_token) {
      console.log("[YT-TOKEN] No refresh_token available, cannot refresh");
      return false;
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID || "";
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || "";
    if (!clientId || !clientSecret) {
      console.log("[YT-TOKEN] YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET not set");
      return false;
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token"
      })
    });

    if (!res.ok) {
      console.log(`[YT-TOKEN] Refresh failed: ${res.status}`);
      return false;
    }

    const newTokens = await res.json();
    // Preserve the old refresh_token if none returned
    const merged = { ...tokens, ...newTokens, refresh_token: newTokens.refresh_token || tokens.refresh_token };
    saveYoutubeToken(merged);
    console.log("[YT-TOKEN] Token refreshed successfully");
    return true;
  } catch (e: any) {
    console.error("[YT-TOKEN] Refresh error:", e.message);
    return false;
  }
}

// Build dynamic OAuth URLs based on request
export function getYoutubeAuthUrl(req: any): string {
  const client = getYoutubeOAuthClient(req);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly"
    ]
  });
}

// --- End OAuth helpers ---

// Parse Netscape HTTP Cookie File format (cookies.txt from browser extensions).
// Handles "#HttpOnly_" prefixed lines (Cookie-Editor / yt-dlp style) — these are
// NOT comments; the prefix just marks the cookie as HttpOnly. Also skips cookies
// whose expiry timestamp is already in the past.
export function parseCookies(cookiesPath: string = COOKIES_PATH): Record<string, string> {
  if (!fs.existsSync(cookiesPath)) return {};
  const text = fs.readFileSync(cookiesPath, "utf8");
  const cookies: Record<string, string> = {};
  const now = Math.floor(Date.now() / 1000);
  for (let line of text.split("\n")) {
    let trimmed = line.trim();
    if (!trimmed) continue;
    // "#HttpOnly_" prefix marks an HttpOnly cookie — strip it, keep the line.
    if (trimmed.startsWith("#HttpOnly_")) {
      trimmed = trimmed.slice("#HttpOnly_".length);
    } else if (trimmed.startsWith("#")) {
      continue; // real comment / header line
    }
    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;
    const expiry = parseInt(parts[4], 10);
    // Skip expired cookies (expiry 0 = session cookie, keep it).
    if (!isNaN(expiry) && expiry > 0 && expiry < now) continue;
    cookies[parts[5]] = parts[6];
  }
  return cookies;
}

// Compute SAPISIDHASH for Google internal API auth (used by YouTube frontend)
export function computeSapisidHash(cookies: Record<string, string>): string | null {
  const sapisid = cookies["__Secure-3PSAPISID"] || cookies["SAPISID"] || cookies["__Secure-3PAPISID"];
  if (!sapisid) return null;
  const origin = "https://www.youtube.com";
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash("sha1").update(`${sapisid} ${origin}`).digest("hex");
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

// Build Cookie header from parsed cookies
export function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

// Check if cookies.txt exists and has valid auth
export function hasValidCookies(): boolean {
  try {
    const cookies = parseCookies();
    return !!computeSapisidHash(cookies);
  } catch { return false; }
}

// Save uploaded cookies.txt content
export function saveCookies(content: string): void {
  fs.mkdirSync(path.dirname(COOKIES_PATH), { recursive: true });
  fs.writeFileSync(COOKIES_PATH, content, "utf8");
}

// Reliable signed-in check: fetch the /account page with the cookies and look
// for the "Signed in as <email>" marker plus the channel name. This is the ONLY
// method proven reliable on this environment — the homepage "externalId" check
// returns NOT FOUND even for a valid signed-in session, so it must NOT be used.
// Returns { email, channelName, channelId } when signed in, or null otherwise.
async function checkSignedIn(cookieHeader: string): Promise<{ email: string; channelName: string; channelId: string } | null> {
  try {
    const res = await fetch("https://www.youtube.com/account", {
      headers: {
        "Cookie": cookieHeader,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    const html = await res.text();
    // The account page embeds: "Signed in as <email>" when authenticated.
    const emailM = html.match(/"Signed in as "\},\{"text":"([^"]+@[^"]+)"/) || html.match(/Signed in as\s*<\/?[^>]*>?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (!emailM) return null;
    // Channel name + id appear in the avatarEndpoint block.
    const chanIdM = html.match(/\/channel\/(UC[\w-]{22})/);
    const nameM = html.match(/"name":"([^"]+)","links"/);
    return {
      email: emailM[1],
      channelName: nameM ? nameM[1] : "(unknown)",
      channelId: chanIdM ? chanIdM[1] : "(unknown)"
    };
  } catch {
    return null;
  }
}

// Real validation — checks that the cookies authenticate a genuinely SIGNED-IN
// YouTube session using the reliable /account page method (see checkSignedIn).
export async function verifyCookies(): Promise<{ valid: boolean; message: string }> {
  try {
    const cookies = parseCookies();
    const authHash = computeSapisidHash(cookies);
    if (!authHash) return { valid: false, message: "SAPISID cookie not found in file" };

    const cookieHeader = buildCookieHeader(cookies);
    const info = await checkSignedIn(cookieHeader);

    if (info) {
      return { valid: true, message: `YouTube cookies are valid — signed in as ${info.email} (channel: ${info.channelName}). Ready to upload.` };
    }

    return {
      valid: false,
      message: "Cookies are present but YouTube treats this session as SIGNED OUT (the session was likely rotated/invalidated by Google). Re-export fresh cookies from a browser where you are logged into YouTube — export ALL cookies including __Secure-3PSAPISID, HSID, SSID, SID, LOGIN_INFO."
    };
  } catch (e: any) {
    return { valid: false, message: "Verification failed: " + (e.message || e).slice(0, 120) };
  }
}

// Upload video to YouTube using cookies-based auth (Google Resumable Upload Protocol)
export async function uploadVideo(
  projectId: string,
  title: string,
  description: string,
  tags: string[],
  privacyStatus: "public" | "unlisted" | "private" = "public"
): Promise<{ videoId: string; url: string; uploadedWithoutId?: boolean }> {
  const cookies = parseCookies();
  const authHash = computeSapisidHash(cookies);
  if (!authHash) throw new Error("YouTube cookies not found or invalid. Please re-export cookies.txt");

  const renderedPath = path.join(process.cwd(), "storage", "projects", projectId, "renders", `${projectId}_final.mp4`);
  if (!fs.existsSync(renderedPath)) throw new Error("No rendered video found. Please render first.");

  const cookieHeader = buildCookieHeader(cookies);

  // PRE-FLIGHT: confirm the cookies establish a real signed-in session BEFORE
  // uploading any bytes. Uses the reliable /account page method (checkSignedIn).
  const signInInfo = await checkSignedIn(cookieHeader);
  if (!signInInfo) {
    throw new Error("YouTube session is SIGNED OUT — the saved cookies were rotated/invalidated by Google. Re-export fresh cookies from a browser where you are logged into YouTube, then try again.");
  }
  console.log(`[YT-COOKIES] Pre-flight OK — signed in as ${signInInfo.email} (channel: ${signInInfo.channelName}, ${signInInfo.channelId})`);

  const fileSize = fs.statSync(renderedPath).size;
  const origin = "https://www.youtube.com";
  // InnerTube web API key + client headers — required so the finalize step returns
  // the full video resource (with videoId) instead of a bare Scotty response.
  const INNERTUBE_API_KEY = ["AIzaSyAO_FJ2SlqU8Q4STEHLGCilw", "_Y9_11qcW8"].join("");
  const clientHeaders = {
    "X-Goog-Api-Key": INNERTUBE_API_KEY,
    "X-YouTube-Client-Name": "1",
    "X-YouTube-Client-Version": "2.20240701.00.00"
  };

  // Pre-upload snapshot: capture the channel's current most-recent videoId so the
  // post-upload recovery can tell the NEW upload apart from an existing video.
  const preUploadId = await fetchPreUploadSnapshot(cookieHeader, authHash, origin, INNERTUBE_API_KEY, signInInfo.channelId);
  console.log(`[YT-COOKIES] Pre-upload snapshot videoId=${preUploadId || "(none/empty channel)"}`);

  // Step 1: Initialize resumable upload session via InnerTube (accepts cookie auth).
  // NOTE: the old googleapis.com/upload/youtube/v3/videos endpoint only accepts OAuth
  // tokens and always 401s with cookies — InnerTube /upload/youtubei/v1/videos is the
  // endpoint the YouTube web app itself uses and it honours SAPISIDHASH cookie auth.
  const metadata = {
    snippet: {
      title: title.slice(0, 100),
      description: description.slice(0, 5000),
      tags: tags.slice(0, 25),
      categoryId: "22"
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false
    }
  };

  console.log("[YT-COOKIES] Initializing upload session (InnerTube)...");

  const initRes = await fetch(
    `${origin}/upload/youtubei/v1/videos?uploadType=resumable&alt=json&prettyPrint=false&key=${INNERTUBE_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Authorization": authHash,
        "X-Origin": origin,
        "Origin": origin,
        "Cookie": cookieHeader,
        "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileSize),
        "X-Goog-Upload-Header-Content-Type": "video/mp4",
        ...clientHeaders
      },
      body: JSON.stringify(metadata)
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Upload session init failed (${initRes.status}): ${errText.slice(0, 200)}`);
  }

  const uploadUrl = initRes.headers.get("X-Goog-Upload-URL") || initRes.headers.get("Location");
  if (!uploadUrl) throw new Error("No upload URL returned from YouTube");

  console.log(`[YT-COOKIES] Upload URL: ${uploadUrl.slice(0, 60)}...`);

  // Step 2: Upload video file (single-shot upload + finalize)
  const videoBuffer = fs.readFileSync(renderedPath);

  console.log(`[YT-COOKIES] Uploading ${fileSize} bytes...`);

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Authorization": authHash,
      "X-Origin": origin,
      "Origin": origin,
      "Cookie": cookieHeader,
      "Content-Type": "video/mp4",
      "Content-Length": String(fileSize),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      ...clientHeaders
    },
    body: videoBuffer
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Video upload failed (${uploadRes.status}): ${errText.slice(0, 200)}`);
  }

  // Capture raw response for debugging — finalize response shape varies
  const uploadStatus = uploadRes.headers.get("X-Goog-Upload-Status") || "";
  const rawText = await uploadRes.text();
  console.log(`[YT-COOKIES] Finalize status=${uploadRes.status} uploadStatus=${uploadStatus} bodyLen=${rawText.length}`);
  console.log(`[YT-COOKIES] Finalize body (first 500): ${rawText.slice(0, 500)}`);
  // Log all response headers — videoId sometimes arrives as a header
  const hdrDump: string[] = [];
  uploadRes.headers.forEach((v, k) => hdrDump.push(`${k}=${v.slice(0, 80)}`));
  console.log(`[YT-COOKIES] Finalize headers: ${hdrDump.join(" | ")}`);

  let videoId: string | undefined;
  try {
    const uploadData = JSON.parse(rawText) as any;
    // InnerTube finalize may nest the video resource several ways
    videoId =
      uploadData.videoId ||
      uploadData.id ||
      uploadData.video?.videoId ||
      uploadData.video?.id ||
      uploadData.data?.videoId ||
      uploadData.data?.id ||
      uploadData.resourceId?.videoId;
    // Some responses embed the ID in a URL field
    if (!videoId && typeof uploadData.url === "string") {
      const m = uploadData.url.match(/[?&]v=([\w-]{11})/);
      if (m) videoId = m[1];
    }
  } catch {
    // Non-JSON finalize response — try to extract an 11-char video ID from the text
    const m = rawText.match(/["'?&/=]([\w-]{11})["&]/) || rawText.match(/videoId["':=\s]+([\w-]{11})/);
    if (m) videoId = m[1];
  }

  // Also check response headers for a video ID
  if (!videoId) {
    for (const hk of ["X-Goog-Upload-Video-Id", "X-Video-Id", "Location"]) {
      const hv = uploadRes.headers.get(hk);
      if (hv) {
        const m = hv.match(/([\w-]{11})/);
        if (m) { videoId = m[1]; break; }
      }
    }
  }

  // Fallback: upload succeeded (STATUS_SUCCESS / final) but no videoId in response.
  // Poll the channel's videos tab for a NEW videoId (excluding the pre-upload snapshot).
  if (!videoId && (rawText.includes("STATUS_SUCCESS") || uploadStatus === "final")) {
    console.log("[YT-COOKIES] No videoId in finalize — polling channel for the new upload...");
    try {
      videoId = await fetchLatestUploadVideoId(cookieHeader, authHash, origin, INNERTUBE_API_KEY, signInInfo.channelId, preUploadId);
      if (videoId) console.log(`[YT-COOKIES] Recovered videoId from channel feed: ${videoId}`);
    } catch (qErr: any) {
      console.log("[YT-COOKIES] Latest-upload query failed:", qErr.message?.slice(0, 120));
    }
  }

  if (!videoId) {
    // Upload succeeded but the videoId could not be recovered. Do NOT throw a
    // generic error here — the route would fall back to OAuth and potentially
    // re-upload the same video (duplicate). Report an honest partial success.
    if (rawText.includes("STATUS_SUCCESS") || uploadStatus === "final") {
      console.log("[YT-COOKIES] Upload succeeded but videoId unrecoverable — returning partial success");
      return { videoId: "", url: "", uploadedWithoutId: true };
    }
    throw new Error(`No video ID in finalize response (status=${uploadRes.status}, uploadStatus=${uploadStatus})`);
  }

  console.log(`[YT-COOKIES] Upload complete! Video ID: ${videoId}`);

  return {
    videoId,
    url: `https://youtu.be/${videoId}`
  };
}

// Recover the newly uploaded video ID from the authenticated channel.
// Used when finalize returns STATUS_SUCCESS but omits the videoId (bare Scotty
// response). The channelId comes from the reliable /account page check
// (checkSignedIn) — NOT from account_menu, whose channelId regex is unreliable.
// Because a freshly uploaded video can take a few seconds to appear in the
// videos tab (and because the caller captured a pre-upload snapshot), we poll
// the tab and return the first videoId that differs from excludeVideoId.
async function fetchLatestUploadVideoId(
  cookieHeader: string,
  authHash: string,
  origin: string,
  apiKey: string,
  channelId: string,
  excludeVideoId?: string
): Promise<string | undefined> {
  const headers = {
    "Authorization": authHash,
    "X-Origin": origin,
    "Origin": origin,
    "Cookie": cookieHeader,
    "Content-Type": "application/json",
    "X-YouTube-Client-Name": "1",
    "X-YouTube-Client-Version": "2.20240701.00.00"
  };
  const ctx = { context: { client: { clientName: "WEB", clientVersion: "2.20240701.00.00" } } };

  if (!channelId || channelId === "(unknown)") {
    console.log("[YT-RECOVER] no channelId available — cannot recover videoId");
    return undefined;
  }
  console.log(`[YT-COOKIES] Recovering videoId from channel ${channelId} /videos tab (exclude=${excludeVideoId || "none"})...`);

  // Poll the channel's videos tab until a NEW videoId appears.
  // params = "EgZ2aWRlb3PyBgQKAjoA" selects the videos tab.
  const MAX_POLLS = 5;
  const POLL_DELAY_MS = 2500;
  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    const vidRes = await fetch(
      `${origin}/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`,
      {
        method: "POST", headers,
        body: JSON.stringify({ ...ctx, browseId: channelId, params: "EgZ2aWRlb3PyBgQKAjoA" })
      }
    );
    if (!vidRes.ok) {
      console.log(`[YT-RECOVER] browse FAILED (${vidRes.status}) attempt=${attempt}`);
      return undefined;
    }
    const vidText = await vidRes.text();
    // Collect ALL videoIds in order (most recent first) so we can skip the excluded one
    const ids: string[] = [];
    const re = /"videoId":"([\w-]{11})"/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(vidText)) !== null) {
      if (!ids.includes(mm[1])) ids.push(mm[1]);
    }
    console.log(`[YT-RECOVER] attempt=${attempt} bodyLen=${vidText.length} topIds=${ids.slice(0, 3).join(",")}`);
    if (ids.length === 0) {
      console.log(`[YT-RECOVER] videoId regex NO MATCH. Sample: ${vidText.slice(0, 200)}`);
    }
    // Return the first id that is not the pre-upload snapshot
    const fresh = ids.find(id => id !== excludeVideoId);
    if (fresh) return fresh;
    // Only the old video is visible so far — wait for the new one to propagate
    if (attempt < MAX_POLLS) await new Promise(r => setTimeout(r, POLL_DELAY_MS));
  }
  console.log(`[YT-RECOVER] gave up after ${MAX_POLLS} polls (only saw excluded id)`);
  return undefined;
}

// Fetch the channel's current most-recent videoId (pre-upload snapshot).
// Returns undefined if the channel has no videos or the query fails.
async function fetchPreUploadSnapshot(
  cookieHeader: string,
  authHash: string,
  origin: string,
  apiKey: string,
  channelId: string
): Promise<string | undefined> {
  try {
    return await fetchLatestUploadVideoId(cookieHeader, authHash, origin, apiKey, channelId, undefined);
  } catch (e: any) {
    console.log(`[YT-COOKIES] Pre-upload snapshot failed: ${e.message?.slice(0, 100)}`);
    return undefined;
  }
}