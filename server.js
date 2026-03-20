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

const GEMINI_MODEL = 'gemini-1.5-pro';

// ── SYSTEM PROMPT ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert forensic image analyst specializing in deepfake and AI-generated image detection. You are precise, consistent, and methodical. You always respond with valid JSON only — no markdown, no prose outside the JSON object.`;

// ── PASS 1: GENERAL DEEPFAKE DETECTION ────────────────────────────────────
const PASS1_PROMPT = `Analyze this image for signs of deepfake manipulation or AI generation. Work step by step.

STEP 1 — FACE PRESENCE
Does this image contain a human face? If no face: verdict=REAL, fakeProb=5, confidence=Low, summary="No face detected."

STEP 2 — CHECK EACH SIGNAL (0=not present, 1=possibly, 2=clearly present)

SKIN TEXTURE: Visible pores/blemishes=real. Plastic/waxy/airbrushed=fake.
FACE EDGES: Halo, blur, or glow around face/hair edges=fake.
EYES: Different catchlight in each eye=real. Identical/glassy eyes=fake.
LIGHTING: Face lighting matches background/clothing=real. Mismatched shadows=fake.
FACE-BODY MATCH: Face skin tone matches neck/body=real. Mismatch in tone or sharpness=fake.
HAIR: Individual strands visible=real. Painted/merged/unnatural edges=fake.
ARTIFACTS: Distorted jewelry/glasses, warped edges, repeating textures=fake.
FACE-SWAP: Face looks pasted — different resolution, lighting, or skin tone than body=fake.

STEP 3 — COUNT fake signals scored 1 or 2, and real signals confirmed.

STEP 4 — SCORE:
0 fake signals + multiple real signals → fakeProb 5–20, verdict REAL
1–2 fake signals → fakeProb 25–45, verdict SUSPICIOUS
3–4 fake signals → fakeProb 55–75, verdict FAKE
5+ fake signals OR clear face-swap → fakeProb 76–95, verdict FAKE

STEP 5 — CONFIDENCE: High=certain, Medium=some ambiguity, Low=poor image quality

Respond ONLY with JSON:
{"verdict":"FAKE","fakeProb":82,"realProb":18,"confidence":"High","fakeSignalCount":5,"realSignalCount":1,"summary":"2 specific sentences about what you observed.","signals":["signal 1","signal 2","signal 3","signal 4"]}`;

// ── PASS 2: FACE-SWAP SPECIALIST PROMPT ───────────────────────────────────
// Only triggered when Pass 1 is uncertain (fakeProb 15–65)
const PASS2_PROMPT = `You are a face-swap and celebrity deepfake specialist. The previous analysis was uncertain. Do a deep forensic pass focused ONLY on face-swap detection.

Examine these face-swap indicators carefully:

1. FACE-BODY BOUNDARY
   - Trace the edge where face meets neck and hair
   - Any softness, halo, color shift, or blending artifact at this boundary?
   - Does the face skin tone EXACTLY match the neck in the same lighting?

2. LIGHTING DIRECTION
   - Where is the main light source? (check shadows, highlights)
   - Does light direction on the face match the clothing and background?
   - Are shadows under nose/chin consistent with the scene?

3. FACE RESOLUTION vs BACKGROUND
   - Is any face noticeably sharper or smoother than the background?
   - Does any face look like it was taken with a different camera?

4. MULTIPLE FACES (if present)
   - Do all faces have consistent lighting and resolution?
   - Does any one face look "cleaner" or "more perfect" than the others?
   - Is any face more symmetric than naturally expected?

5. KNOWN FACE-SWAP ARTIFACTS
   - Unnatural skin smoothness on one face vs others
   - Slight color temperature difference on the face vs rest of image
   - Hair edges that look cut-out or artificially blended
   - Jewelry/accessories warped near the face

SCORING:
No face-swap signals → fakeProb 10–25
1–2 subtle signals → fakeProb 35–55
3+ clear signals OR certain face-swap → fakeProb 65–90

Respond ONLY with JSON:
{"verdict":"FAKE","fakeProb":78,"realProb":22,"confidence":"High","faceSwapDetected":true,"fakeSignalCount":4,"summary":"2 specific sentences about what face-swap signals you found.","signals":["signal 1","signal 2","signal 3"]}`;

// ── LOW-LEVEL GEMINI CALL ─────────────────────────────────────────────────
function callGemini(apiKey, base64Image, mimeType, prompt) {
  return new Promise((resolve, reject) => {
    const bodyObj = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Image } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json'
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

// ── SAFE PARSE WITH RETRY ─────────────────────────────────────────────────
async function geminiParsed(apiKey, b64, mimeType, prompt, maxRetries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const raw     = await callGemini(apiKey, b64, mimeType, prompt);
      const cleaned = raw.replace(/```json|```/gi, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      lastError = err;
      console.warn(`⚠️  Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1200 * attempt));
    }
  }
  throw lastError;
}

// ── DUAL-PASS DETECTION ───────────────────────────────────────────────────
async function detectDualPass(apiKey, b64, mimeType) {

  // PASS 1 — general detection
  console.log('   🔬 Pass 1: General deepfake analysis...');
  const p1 = await geminiParsed(apiKey, b64, mimeType, PASS1_PROMPT);
  const p1Score = Math.min(100, Math.max(0, parseInt(p1.fakeProb) || 0));
  console.log(`   📊 Pass 1 score: ${p1Score}% fake`);

  // PASS 2 — only in uncertain zone (15–65%)
  const UNCERTAIN_LOW  = 15;
  const UNCERTAIN_HIGH = 65;
  const needsSecondPass = p1Score >= UNCERTAIN_LOW && p1Score <= UNCERTAIN_HIGH;

  let finalScore, finalResult, passesUsed;

  if (needsSecondPass) {
    console.log('   🔬 Pass 2: Face-swap specialist analysis...');

    // 2s delay between calls to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));

    const p2 = await geminiParsed(apiKey, b64, mimeType, PASS2_PROMPT);
    const p2Score = Math.min(100, Math.max(0, parseInt(p2.fakeProb) || 0));
    console.log(`   📊 Pass 2 score: ${p2Score}% fake`);

    // Weighted average: Pass 2 gets 60% weight (specialist)
    finalScore = Math.round((p1Score * 0.4) + (p2Score * 0.6));
    console.log(`   🎯 Combined score: ${finalScore}% (40% pass1 + 60% pass2)`);

    const allSignals = [
      ...(Array.isArray(p1.signals) ? p1.signals : []),
      ...(Array.isArray(p2.signals) ? p2.signals : [])
    ].slice(0, 6);

    finalResult = {
      ...p1,
      fakeProb:         finalScore,
      realProb:         100 - finalScore,
      signals:          allSignals,
      faceSwapDetected: p2.faceSwapDetected || false,
      summary:          p2Score > 40 ? p2.summary : p1.summary,
      confidence:       Math.abs(p1Score - p2Score) < 20 ? 'High' : 'Medium',
      dualPass:         true,
      pass1Score:       p1Score,
      pass2Score:       p2Score
    };
    passesUsed = 2;

  } else {
    finalScore  = p1Score;
    finalResult = { ...p1, fakeProb: p1Score, realProb: 100 - p1Score, dualPass: false };
    passesUsed  = 1;
  }

  console.log(`   ✅ Done (${passesUsed} pass${passesUsed > 1 ? 'es' : ''})`);
  return finalResult;
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

    const r = await detectDualPass(apiKey, b64, mimeType);

    // Sanitize
    r.fakeProb   = Math.min(100, Math.max(0, parseInt(r.fakeProb) || 0));
    r.realProb   = 100 - r.fakeProb;
    r.confidence = ['High', 'Medium', 'Low'].includes(r.confidence) ? r.confidence : 'Medium';
    r.signals    = Array.isArray(r.signals) ? r.signals.slice(0, 6) : [];
    r.filename   = req.file.originalname;
    r.timestamp  = new Date().toLocaleString();
    r.engine     = GEMINI_MODEL;

    if      (r.fakeProb >= 55) r.verdict = 'FAKE';
    else if (r.fakeProb >= 30) r.verdict = 'SUSPICIOUS';
    else                        r.verdict = 'REAL';

    const icon = r.verdict === 'FAKE' ? '🚨' : r.verdict === 'SUSPICIOUS' ? '⚠️' : '✅';
    const dual = r.dualPass ? ' [2-pass]' : ' [1-pass]';
    console.log(`${icon}  VERDICT: ${r.verdict} | Fake: ${r.fakeProb}% | ${r.confidence} confidence${dual}`);

    res.json(r);

  } catch (err) {
    console.error('❌ Error:', err.message);

    if (err.message.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({
        error: 'Rate limit hit. Wait 1 minute and try again. (Free tier: 2 req/min for Pro)'
      });
    }
    if (err.message.includes('API_KEY_INVALID')) {
      return res.status(401).json({
        error: 'Invalid Gemini API key. Check at aistudio.google.com'
      });
    }

    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    engine:    GEMINI_MODEL,
    mode:      'dual-pass',
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
  console.log(`  🤖  Engine     : ${GEMINI_MODEL} — Dual-Pass Detection`);
  console.log(`  🔑  API Key    : ${process.env.GEMINI_API_KEY ? '✅ LOADED' : '❌ NOT SET'}`);
  console.log('');
});