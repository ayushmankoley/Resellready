import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 64 * 1024;
const googleModel = process.env.GOOGLE_MODEL || "gemma-4-31b-it";
const googleBackupModel = process.env.GOOGLE_BACKUP_MODEL || "gemma-4-26b-a4b-it";
const togetherModel = process.env.TOGETHER_MODEL || "google/gemma-3n-E4B-it";
const providerTimeoutMs = 45_000;

const productProfiles = {
  vintage: {
    label: "Vintage",
    requiredFields: ["brand", "size", "measurements", "condition", "flaws"],
    safety: "Never claim authenticity, exact age, or material without seller confirmation."
  },
  handmade: {
    label: "Handmade",
    requiredFields: ["materials", "dimensions", "care", "production_time"],
    safety: "Do not invent materials, production claims, or care instructions."
  },
  food: {
    label: "Food",
    requiredFields: ["ingredients", "allergens", "storage", "best_before"],
    safety: "Never infer allergen safety. Require seller confirmation."
  },
  "print-on-demand": {
    label: "Print-on-demand",
    requiredFields: ["sizes", "colors", "print_area", "fulfillment"],
    safety: "Do not claim ownership or originality without seller confirmation."
  },
  other: {
    label: "Independent seller",
    requiredFields: ["dimensions", "condition", "fulfillment"],
    safety: "Do not invent product facts."
  }
};

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readProviderResponse(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Preserve the raw response below when the provider does not return JSON.
  }
  return { text, data };
}

function providerError(provider, response, body) {
  const providerMessage = body.data?.error?.message || body.data?.message;
  const detail = providerMessage || body.text.trim().slice(0, 500) || "empty response body";
  const error = new Error(`${provider} returned HTTP ${response.status}: ${detail}`);
  error.status = response.status;
  error.retryable = [429, 500, 502, 503, 504].includes(response.status);
  return error;
}

function promptFor(input, memory = []) {
  const profile = productProfiles[input.type] || productProfiles.other;
  return `You are ReSellReady, a careful marketplace listing assistant for side-hustle sellers.
Product category: ${profile.label}
Marketplace: ${input.platform}
Voice: ${input.tone}
Product name: ${input.name}
Seller notes: ${input.details || "none"}
Seller memory and approved preferences: ${memory.join("; ") || "none"}
Category fields to check: ${profile.requiredFields.join(", ")}
Safety rule: ${profile.safety}

Return only valid JSON with exactly these keys:
title (string), description (string), tags (array of strings), checklist (array of strings), qualityScore (integer 0-100).
Never invent brand, material, condition, ingredients, authenticity, measurements, pricing, or delivery claims. Make suggestions editable.`;
}

function parseModelJson(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) {
    const error = new Error("The model returned an empty response.");
    error.code = "MODEL_OUTPUT";
    throw error;
  }

  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [text];
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next bounded JSON candidate before reporting the model error.
    }
  }

  const preview = text.replace(/\s+/g, " ").slice(0, 180);
  const error = new Error(`The model returned non-JSON output${preview ? `: ${preview}` : "."}`);
  error.code = "MODEL_OUTPUT";
  throw error;
}

function normalizeOutput(raw) {
  const output = parseModelJson(raw);
  if (!output || typeof output.title !== "string" || typeof output.description !== "string" ||
      !Array.isArray(output.tags) || !Array.isArray(output.checklist)) {
    const error = new Error("The model returned JSON, but not the required listing fields.");
    error.code = "MODEL_OUTPUT";
    throw error;
  }
  const qualityScore = Number(output.qualityScore ?? output.score);
  return {
    title: output.title.trim(),
    description: output.description.trim(),
    tags: output.tags.filter((item) => typeof item === "string").slice(0, 12),
    checklist: output.checklist.filter((item) => typeof item === "string").slice(0, 8),
    qualityScore: Number.isFinite(qualityScore) ? Math.max(0, Math.min(100, Math.round(qualityScore))) : 80
  };
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) throw new Error("Request is too large.");
  }
  const input = JSON.parse(body);
  if (!input || typeof input.name !== "string" || !input.name.trim()) throw new Error("Product name is required.");
  if (!productProfiles[input.type]) throw new Error("Choose a supported product type.");
  return input;
}

async function getBackboardMemory(input) {
  if (!process.env.BACKBOARD_API_URL || !process.env.BACKBOARD_API_KEY) return [];
  const response = await fetch(`${process.env.BACKBOARD_API_URL}/memory/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.BACKBOARD_API_KEY}` },
    body: JSON.stringify({ userId: input.sellerId || "demo-seller", query: `${input.type} listing preferences` }),
    signal: AbortSignal.timeout(providerTimeoutMs)
  });
  const body = await readProviderResponse(response);
  if (!response.ok) throw providerError("Backboard", response, body);
  const data = body.data;
  return Array.isArray(data.memories) ? data.memories.map((memory) => memory.text || memory.content).filter(Boolean).slice(0, 8) : [];
}

async function generateWithTogether(prompt) {
  if (!process.env.TOGETHER_API_KEY) throw new Error("Hosted model is not configured yet. Add TOGETHER_API_KEY in Render.");
  const response = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TOGETHER_API_KEY}` },
    body: JSON.stringify({
      model: togetherModel,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }]
    }),
    signal: AbortSignal.timeout(providerTimeoutMs)
  });
  const body = await readProviderResponse(response);
  if (!response.ok) throw providerError("Together AI", response, body);
  const data = body.data;
  return normalizeOutput(data.choices?.[0]?.message?.content);
}

async function generateWithGoogle(prompt, model = googleModel) {
  if (!process.env.GOOGLE_API_KEY) throw new Error("Google AI Studio is not configured yet. Add GOOGLE_API_KEY in Render.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GOOGLE_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: { temperature: 0.35, responseMimeType: "application/json" },
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    }),
    signal: AbortSignal.timeout(providerTimeoutMs)
  });
  const body = await readProviderResponse(response);
  if (!response.ok) throw providerError("Google AI Studio", response, body);
  const data = body.data;
  const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  return normalizeOutput(content);
}

async function generateWithConfiguredProvider(prompt) {
  const provider = process.env.MODEL_PROVIDER || "google";
  if (provider === "google") {
    try {
      return { output: await generateWithGoogle(prompt), model: googleModel };
    } catch (error) {
      if ((!error.retryable && error.name !== "TimeoutError" && error.code !== "MODEL_OUTPUT") || googleBackupModel === googleModel) throw error;
      console.warn(`Primary Google model ${googleModel} failed; retrying with backup ${googleBackupModel}.`);
      return { output: await generateWithGoogle(prompt, googleBackupModel), model: googleBackupModel };
    }
  }
  if (provider === "together") return { output: await generateWithTogether(prompt), model: togetherModel.split("/").pop() };
  throw new Error(`Unsupported MODEL_PROVIDER: ${provider}. Use google or together.`);
}

async function generateListing(request, response) {
  const requestId = createRequestId();
  try {
    const input = await readJson(request);
    console.info(`[${requestId}] listing request provider=${process.env.MODEL_PROVIDER || "google"} model=${googleModel}`);
    const memory = await getBackboardMemory(input);
    const result = await generateWithConfiguredProvider(promptFor(input, memory));
    const provider = process.env.MODEL_PROVIDER || "google";
    const model = provider === "google" ? result.model : togetherModel.split("/").pop();
    console.info(`[${requestId}] listing request succeeded`);
    json(response, 200, { ...result.output, modelLabel: `HOSTED ${model}`, requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Listing generation failed.";
    console.error(`[${requestId}] listing request failed: ${message}`, error);
    json(response, 503, { error: message, requestId });
  }
}

async function serveStatic(request, response) {
  const requested = request.url === "/" ? "index.html" : decodeURIComponent(request.url.split("?")[0]).replace(/^\/+/, "");
  const filePath = normalize(join(root, requested));
  if (!filePath.startsWith(root)) return json(response, 403, { error: "Forbidden." });
  try {
    const content = await readFile(filePath);
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".md": "text/plain" };
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  }
}

createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/generate-listing") return generateListing(request, response);
  if (request.method === "GET" && request.url === "/api/health") return json(response, 200, {
    ok: true,
    provider: process.env.MODEL_PROVIDER || "google",
    model: (process.env.MODEL_PROVIDER || "google") === "google" ? googleModel : togetherModel,
    backupModel: (process.env.MODEL_PROVIDER || "google") === "google" ? googleBackupModel : null,
    memory: Boolean(process.env.BACKBOARD_API_URL && process.env.BACKBOARD_API_KEY),
    fineTunedModel: Boolean(process.env.TINKER_MODEL_ENDPOINT)
  });
  if (request.method === "GET") return serveStatic(request, response);
  return json(response, 405, { error: "Method not allowed." });
}).listen(port, () => console.log(`ReSellReady listening on port ${port}`));
