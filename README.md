# 🛡️ RealHer — AI-Powered Deepfake Detection & Identity Protection Platform

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Made%20With-HTML%20%7C%20CSS%20%7C%20Node.js-blueviolet?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/AI-Gemini%20Vision-ff69b4?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Purpose-Women's%20Safety-purple?style=for-the-badge"/>
</p>

<p align="center">
  <strong>Protecting women from deepfake exploitation and digital identity misuse using AI-powered detection, evidence management, and legal support tools.</strong>
</p>

---

## 🌟 Overview

**RealHer** is a full-stack web application designed to detect deepfake images, protect digital identities, and provide emotional and legal support to women who may be victims of AI-generated image manipulation.

> Built for hackathons · Designed for real-world impact · Powered by Google Gemini Vision AI

---

## ✨ Features

| Feature | Description |
|--------|-------------|
| 🧠 **AI Deepfake Detection** | Upload any image — Gemini Vision AI analyzes and returns Real vs Fake verdict with confidence score |
| 🪪 **Digital Identity Certificate** | Capture and register your face to generate a tamper-proof digital identity certificate |
| 📁 **Evidence Vault** | Securely store uploaded images, detection reports, and certificates for legal use |
| ⚠️ **Risk-Based Guidance** | Low risk → safety tips; High risk → auto-generates complaint report and shares with authorities |
| 🌐 **Multilingual Support** | Supports 7 languages including English, Telugu, Hindi, Tamil, and more |
| 🎙️ **Voice Assistant** | Guided voice navigation for upload, analysis, and safety help |
| 💬 **Emotional Support Chatbot (Aria)** | AI chatbot providing empathetic guidance and next steps for victims |

---

## 🖼️ Screenshots

> *(Add screenshots of your website here after deployment)*

---

## 🛠️ Tech Stack

**Frontend**
- HTML5, CSS3, JavaScript
- Pink & Purple gradient UI with Glassmorphism design
- Responsive (Mobile + Desktop)

**Backend**
- Node.js + Express.js
- Multer (file upload handling)

**AI / Detection**
- Google Gemini 1.5 Flash Vision API (Free tier — 1500 requests/day)
- SHA-256 image fingerprinting for consistent results

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) installed
- Free [Google Gemini API Key](https://aistudio.google.com/)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/karthikayadala07/realher.git
cd realher

# 2. Install dependencies
npm install

# 3. Set your Gemini API key
set GEMINI_API_KEY=your_gemini_api_key_here   # Windows
export GEMINI_API_KEY=your_gemini_api_key_here # Mac/Linux

# 4. Start the server
node server.js
```

Then open your browser and go to: **http://localhost:3000**

---

## 🔑 Getting a Free API Key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with your Google account
3. Click **"Get API Key"** → **"Create API Key"**
4. Copy and paste it in Step 3 above

> Free tier: **1,500 requests/day** — perfect for demos and hackathons!

---

## 📁 Project Structure

```
realher/
├── public/
│   └── index.html        # Main frontend UI
├── server.js             # Express backend + Gemini AI integration
├── package.json          # Node.js dependencies
└── README.md
```

---

## 🎯 How It Works

```
User Uploads Image
       ↓
SHA-256 Fingerprint Generated (for consistent results)
       ↓
Gemini Vision AI Analyzes Image
       ↓
Returns: REAL ✅ or FAKE 🚨 + Confidence Score
       ↓
Evidence Stored → Certificate Generated → Guidance Provided
```

---

## 🔐 Detection Thresholds

| Score | Verdict |
|-------|---------|
| 0–29% fake | ✅ Likely Authentic |
| 30–64% fake | ⚠️ Uncertain – Review Advised |
| 65–100% fake | 🚨 Deepfake Detected |

---

## 🌍 Supported Languages

English · Telugu · Hindi · Tamil · Kannada · Malayalam · Bengali

---

## 💡 Use Cases

- Verifying authenticity of images shared on social media
- Generating legal evidence for cybercrime complaints
- Protecting personal identity from AI misuse
- Supporting deepfake victims with emotional and legal guidance

---

## ⚠️ Disclaimer

RealHer uses **high-accuracy AI-based detection** — not 100% guaranteed. Always consult legal authorities for serious cases. This tool is designed to assist, not replace, professional legal or cybercrime investigation.

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you'd like to change.

---

## 👩‍💻 Author

**Karthika Yadala**  
[GitHub](https://github.com/karthikayadala07)

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

<p align="center">
  Made with 💜 to protect women in the digital world
</p>
