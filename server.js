const express = require('express');
const multer  = require('multer');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── MODEL CONFIG ───────────────────────────────────────────────────────────
// gemini-1.5-pro is MUCH more accurate for image forensics than flash
// It's still free (60 requests/min on free tier) — perfect for a hackathon
const GEMINI_MODEL = 'gemini-1.5-pro';

// ── SYSTEM PROMPT (sent separately for better instruction-following) ────────
const SYSTEM_PROMPT = `You are an expert forensic image analyst specializing in deepfake and AI-generated image detection. You have been trained on thousands of real and fake images. You are precise, consistent, and methodical. You always respond with valid JSON only — no markdown, no prose outside the JSON object.`;

// ── DETECTION PROMPT ───────────────────────────────────────────────────────
// Key improvements:
// 1. Step-by-step checklist forces the model to think before scoring
// 2. Explicit scoring anchors reduce random variation
// 3. Tells the model to count signals, not just guess
// 4. temperature: 0 makes results deterministic
const DETECTION_PROMPT = `Analyze this image for signs of deepfake manipulation or AI generation. Work through this checklist step by step, then produce your final JSON verdict.

STEP 1 — FACE PRESENCE
Does this image contain a human face? If no face is present, set verdict=REAL, fakeProb=5, confidence=Low, summary="No face detected — deepfake analysis not applicable."

STEP 2 — EXAMINE EACH SIGNAL (score 0=not present, 1=possibly present, 2=clearly present)

SKIN TEXTURE
- Are pores, fine lines, or natural blemishes visible? (real=yes)
- Does the skin look plastic, waxy, or airbrushed? (fake=yes)

FACE EDGES  
- Is the jawline sharp and consistent with the rest of the image?
- Is there a halo, blur, or glow around the face or hair edges? (fake=yes)

EYES
- Do the two eyes have naturally different catchlight reflections? (real=yes, fake=identical)
- Do the eyes look glassy, flat, or unnaturally perfect? (fake=yes)

LIGHTING CONSISTENCY
- Does the light direction on the face match the background and clothing?
- Are there mismatched shadows that suggest compositing? (fake=yes)

FACE-TO-BODY CONTINUITY
- Does the skin tone of the face match the neck and body?
- Does the face resolution/sharpness match the background resolution? (mismatch=fake)

HAIR DETAIL
- Are individual hair strands distinct and natural? (real=yes)
- Does hair look painted, merged, or have unnatural edges? (fake=yes)

GAN / AI ARTIFACTS
- Are there any distorted accessories (earrings, glasses, jewelry)? (fake=yes)
- Any warping, repeating textures, or anatomical errors near face edges? (fake=yes)

STEP 3 — COUNT YOUR SIGNALS
Count: how many fake signals did you score 1 or 2?
Count: how many real signals did you confirm?

STEP 4 — SCORE USING THIS SCALE (be consistent — same image must always get same score)
0 fake signals confirmed + multiple real signals → fakeProb: 5–20, verdict: REAL
1–2 fake signals, uncertain → fakeProb: 25–45, verdict: SUSPICIOUS  
3–4 fake signals clearly present → fakeProb: 55–75, verdict: FAKE
5+ fake signals OR clear face-swap detected → fakeProb: 76–95, verdict: FAKE

STEP 5 — SET CONFIDENCE
High: You are certain about your verdict, signals are unambiguous
Medium: Some signals present but image quality makes it hard to be certain
Low: Image is too low-res, cropped, or obscured to analyze well

Respond ONLY with this JSON (no text before or after):
{"verdict":"FAKE","fakeProb":82,"realProb":18,"confidence":"High","fakeSIgnalCount":5,"realSignalCount":1,"summary":"Specific 2-sentence description of what you actually observed in this image.","signals":["Specific signal 1 you observed","Specific signal 2","Specific signal 3","Specific signal 4"]}`;

// ── GEMINI API CALL ────────────────────────────────────────────────────────
function callGemini(apiKey, base64Image, mimeType) {
  return new Promise((resolve, reject) => {
    const bodyObj = {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Image } },
          { text: DETECTION_PROMPT }
        ]
      }],
      generationConfig: {
        temperature: 0,          // FIX 1: temperature=0 = deterministic, no random variation
        maxOutputTokens: 1024,
        responseMimeType: 'application/json'  // FIX 2: forces JSON output, no markdown wrapping
      }
    };

    const body = JSON.stringify(bodyObj);

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text);
        } catch (e) {
          reject(new Error('Gemini parse error: ' + data.slice(0, 300)));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── RETRY WRAPPER ──────────────────────────────────────────────────────────
// FIX 3: If Gemini fails or returns unparseable JSON, retry up to 2 times
async function callGeminiWithRetry(apiKey, b64, mimeType, maxRetries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const rawText = await callGemini(apiKey, b64, mimeType);
      const cleaned = rawText.replace(/```json|```/gi, '').trim();
      const parsed  = JSON.parse(cleaned);
      return parsed; // success
    } catch (err) {
      lastError = err;
      console.warn(`⚠️  Attempt ${attempt} failed: ${err.message} — retrying...`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError;
}

// ── DETECT ROUTE ───────────────────────────────────────────────────────────
app.post('/api/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({
      error: 'GEMINI_API_KEY not set. Add it in Render → Environment Variables.'
    });

    const b64      = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log('\n🔍 Analyzing:', req.file.originalname, `(${(req.file.size / 1024).toFixed(1)} KB)`);

    // FIX 4: Use retry wrapper instead of a single call
    const r = await callGeminiWithRetry(apiKey, b64, mimeType);

    // Sanitize all fields
    r.fakeProb   = Math.min(100, Math.max(0, parseInt(r.fakeProb) || 0));
    r.realProb   = 100 - r.fakeProb;
    r.confidence = ['High', 'Medium', 'Low'].includes(r.confidence) ? r.confidence : 'Medium';
    r.signals    = Array.isArray(r.signals) ? r.signals.slice(0, 6) : [];
    r.filename   = req.file.originalname;
    r.timestamp  = new Date().toLocaleString();
    r.engine     = GEMINI_MODEL;

    // FIX 5: Tighter thresholds — score always wins
    // Pro model is more calibrated so we use tighter bands
    if      (r.fakeProb >= 55) r.verdict = 'FAKE';
    else if (r.fakeProb >= 30) r.verdict = 'SUSPICIOUS';
    else                        r.verdict = 'REAL';

    const icon = r.verdict === 'FAKE' ? '🚨' : r.verdict === 'SUSPICIOUS' ? '⚠️' : '✅';
    console.log(`${icon}  VERDICT: ${r.verdict} | Fake: ${r.fakeProb}% | Real: ${r.realProb}% | ${r.confidence} confidence | Signals: ${r.fakeSIgnalCount ?? '?'} fake`);

    res.json(r);

  } catch (err) {
    console.error('❌ Error:', err.message);

    // FIX 6: Helpful error messages for common failures
    if (err.message.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({
        error: 'Gemini API rate limit hit. Wait 1 minute and try again. (Free tier: 2 requests/min for Pro)'
      });
    }
    if (err.message.includes('API_KEY_INVALID')) {
      return res.status(401).json({
        error: 'Invalid Gemini API key. Check your key at aistudio.google.com'
      });
    }

    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: GEMINI_MODEL,
    apiKeySet: !!process.env.GEMINI_API_KEY
  });
});

// ── START ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ██████╗ ███████╗ █████╗ ██╗     ██╗  ██╗███████╗██████╗ ');
  console.log('  ██╔══██╗██╔════╝██╔══██╗██║     ██║  ██║██╔════╝██╔══██╗');
  console.log('  ██████╔╝█████╗  ███████║██║     ███████║█████╗  ██████╔╝');
  console.log('  ██╔══██╗██╔══╝  ██╔══██║██║     ██╔══██║██╔══╝  ██╔══██╗');
  console.log('  ██║  ██║███████╗██║  ██║███████╗██║  ██║███████╗██║  ██║');
  console.log('');
  console.log(`  🚀  Running at : http://localhost:${PORT}`);
  console.log(`  🤖  Engine     : ${GEMINI_MODEL} (More accurate for image analysis)`);
  console.log(`  🔑  API Key    : ${process.env.GEMINI_API_KEY ? '✅ LOADED' : '❌ NOT SET'}`);
  console.log('');
  if (!process.env.GEMINI_API_KEY) {
    console.log('  ─────────────────────────────────────────────');
    console.log('  To get your FREE Gemini API key:');
    console.log('  1. Go to: https://aistudio.google.com');
    console.log('  2. Click "Get API Key" → Create API Key');
    console.log('  3. Set in Render: Environment → GEMINI_API_KEY');
    console.log('  ─────────────────────────────────────────────');
    console.log('');
  }
});
