const express = require('express');
const multer  = require('multer');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DEEPFAKE DETECTION PROMPT ──────────────────────────────────────────────
const PROMPT = `You are a forensic deepfake detection AI for RealHer, a platform protecting women from image misuse.

Analyze this image and decide: is it REAL (authentic camera photo) or FAKE (face-swap, AI-generated, deepfake)?

=== FAKE SIGNALS — check all of these ===
SKIN: Too smooth, plastic-like, no pores, waxy, perfectly airbrushed with zero blemishes
FACE EDGES: Blurry jawline, halo around face, face blends unnaturally into hair or background
EYES: Both eyes have identical reflections (real eyes always differ), glassy look
HAIR: Blurry merged strands, hair looks painted not individual, unnatural hair edges
FACE-SWAP: Face skin tone differs from neck/body, face lighting differs from body lighting, face looks pasted
LIGHTING: Shadows on face do not match shadows in background or on clothing
GAN ARTIFACTS: Distorted earrings/glasses, teeth too perfect or blurry, repeating textures
SYMMETRY: Face is unnaturally perfectly symmetric
AI SIZE: Image is exactly 512, 768, or 1024 pixels wide or tall

=== REAL SIGNALS ===
- Visible pores, fine lines, natural skin blemishes
- Slightly asymmetric face (all real faces are asymmetric)
- Natural hair with individual distinct strands
- Consistent lighting across face, neck, clothing, background
- Natural camera noise/grain visible
- No warping near face edges

=== VERDICT RULES — be strict, do not be conservative ===
ANY face-swap or AI signals present → FAKE, fakeProb 65-92
Mixed / uncertain signals → SUSPICIOUS, fakeProb 35-60
Clearly real photo, ZERO fake signals → REAL, fakeProb 5-20
A face on another person's body = FAKE even if background looks real.

Respond ONLY with valid JSON, no markdown, no explanation outside JSON:
{"verdict":"FAKE","fakeProb":82,"realProb":18,"confidence":"High","summary":"2-3 sentences about exactly what you observed in THIS image.","signals":["observation 1","observation 2","observation 3","observation 4"]}`;

// ── GEMINI API CALL ────────────────────────────────────────────────────────
function callGemini(apiKey, base64Image, mimeType) {
  return new Promise((resolve, reject) => {
    const bodyObj = {
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Image } },
          { text: PROMPT }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
    };
    const body = JSON.stringify(bodyObj);

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
          reject(new Error('Gemini parse error: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── DETECT ROUTE ───────────────────────────────────────────────────────────
app.post('/api/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({
      error: 'GEMINI_API_KEY not set. Run: set GEMINI_API_KEY=your_key_here'
    });

    const b64      = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log('\n🔍 Analyzing:', req.file.originalname, `(${(req.file.size/1024).toFixed(1)} KB)`);

    const rawText = await callGemini(apiKey, b64, mimeType);
    const cleaned = rawText.replace(/```json|```/gi, '').trim();

    let r;
    try {
      r = JSON.parse(cleaned);
    } catch (e) {
      console.error('JSON parse failed. Raw response:', rawText.slice(0, 300));
      return res.status(500).json({ error: 'Could not parse AI response', raw: rawText.slice(0, 300) });
    }

    // Sanitize all fields
    r.fakeProb   = Math.min(100, Math.max(0, parseInt(r.fakeProb) || 0));
    r.realProb   = 100 - r.fakeProb;
    r.confidence = ['High','Medium','Low'].includes(r.confidence) ? r.confidence : 'Medium';
    r.signals    = Array.isArray(r.signals) ? r.signals : [];
    r.filename   = req.file.originalname;
    r.timestamp  = new Date().toLocaleString();

    // Score always wins — override text verdict with score
    if      (r.fakeProb >= 50) r.verdict = 'FAKE';
    else if (r.fakeProb >= 30) r.verdict = 'SUSPICIOUS';
    else                        r.verdict = 'REAL';

    const icon = r.verdict === 'FAKE' ? '🚨' : r.verdict === 'SUSPICIOUS' ? '⚠️' : '✅';
    console.log(`${icon}  VERDICT: ${r.verdict} | Fake: ${r.fakeProb}% | Real: ${r.realProb}% | ${r.confidence} confidence`);

    res.json(r);

  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: 'Google Gemini 1.5 Flash (Free)',
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
  console.log(`  🤖  Engine     : Google Gemini 1.5 Flash (FREE)`);
  console.log(`  🔑  API Key    : ${process.env.GEMINI_API_KEY ? '✅ LOADED' : '❌ NOT SET — see instructions below'}`);
  console.log('');
  if (!process.env.GEMINI_API_KEY) {
    console.log('  ─────────────────────────────────────────────');
    console.log('  To get your FREE Gemini API key:');
    console.log('  1. Go to: https://aistudio.google.com');
    console.log('  2. Click "Get API Key" → Create API Key');
    console.log('  3. Run:  set GEMINI_API_KEY=paste_key_here');
    console.log('  4. Run:  node server.js');
    console.log('  ─────────────────────────────────────────────');
    console.log('');
  }
});