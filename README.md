# 🛡️ JobShield: AI-Powered Job Scam Detection Web Application

JobShield is an evidence-based cybersecurity and employment-safety web application that analyzes job postings and internship announcements from LinkedIn, Indeed, and company career pages to detect recruitment fraud, upfront payment traps, fake recruiter identity mismatches, and coercive employment schemes.

---

## 🌟 Why JobShield?

Modern job seekers face a growing epidemic of sophisticated recruitment fraud:
- **Upfront Fee Scams**: Fake recruiters requiring ₹199 - ₹2,500 "registration fees" or "security deposits" to unlock interviews or offer letters.
- **Off-Platform Messaging**: Fraudulent recruiters routing applicants immediately to disposable WhatsApp or Telegram channels.
- **Implausible Compensation**: Unrealistic claims (e.g. "Earn ₹50,000/week for 1 hour of remote work").
- **Coercive Urgency & Guaranteed Selection**: False guarantees of employment conditional only upon rapid money transfer.

JobShield replaces brittle browser-only scraping with a **dedicated Python FastAPI backend**, a **safe HTTP retrieval pipeline with SSRF defenses**, and an **explainable 0–100 deterministic risk engine** that highlights exact evidence quotes without fabricating scores.

---

## 🏗️ Architecture & Component Design

```
redflag_v1/
├── backend/
│   ├── app/
│   │   ├── main.py                   # FastAPI REST API endpoints & CORS
│   │   ├── schemas/job.py            # Pydantic models for jobs, indicators & results
│   │   ├── detector/
│   │   │   ├── engine.py             # 8 Deterministic scam rules with negation handling
│   │   │   └── classifier.py         # Content classifier (listings vs hiring posts vs unrelated)
│   │   ├── extractors/
│   │   │   ├── parser.py             # HTML/JSON-LD structured job extractor
│   │   │   └── retriever.py          # SSRF-defended HTTP client with authwall detection
│   │   ├── security/
│   │   │   └── ssrf.py               # IP validation (blocks private/loopback/metadata IPs)
│   │   └── storage/
│   │       └── database.py           # SQLite persistence for analysis audit records
│   ├── tests/
│   │   └── test_backend.py           # Pytest suite covering fixtures A through I & SSRF
│   └── requirements.txt              # FastAPI, Pydantic, HTTPX, BeautifulSoup4, Pytest
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.tsx            # Navigation, branding & safety guideline links
│   │   │   ├── AnalyzerCard.tsx      # Dual-tab URL analyzer and Manual Text Fallback
│   │   │   └── ResultsView.tsx       # Comprehensive risk breakdown, evidence quotes & actions
│   │   ├── types/job.ts              # TypeScript interfaces for analysis models
│   │   ├── App.tsx                   # Main state container & query parameter handler
│   │   └── index.css                 # Tailwind CSS styling
│   ├── vite.config.ts                # Vite proxy to backend API (/api -> http://127.0.0.1:8000)
│   └── package.json                  # React 19, TypeScript, Tailwind CSS, Lucide icons
│
├── fixtures/                         # Synthetic test datasets (Fixtures A through E)
│   ├── legitimate_internship.json
│   ├── payment_scam.json
│   ├── suspicious_remote_job.json
│   ├── legitimate_company_post.json
│   └── unrelated_linkedin_post.json
│
├── manifest.json                     # Chrome Extension Companion (Manifest V3)
├── background.js                     # Extension click launcher passing active tab URL
└── .env.example                      # Configurable settings
```

---

## ⚡ Key Capabilities

### 1. Robust URL & Platform Processing with SSRF Defense
- Safe HTTP retrieval validates DNS lookups, blocking:
  - Loopback (`127.0.0.0/8`, `::1`)
  - Private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  - Cloud metadata endpoints (`169.254.169.254`)
  - Non-HTTP(S) protocols.
- Limits response sizes to 2MB and enforces an 8-second timeout to prevent resource exhaustion.
- Transparently flags platform authentication barriers (e.g. LinkedIn Authwall or Indeed Cloudflare verification) and seamlessly transitions the user to the **Manual Text Fallback**.

### 2. Manual Text Fallback
- Because LinkedIn and Indeed frequently require user authentication to view full postings, users can paste the job description or post text directly.
- The same content classifier and risk-scoring engine evaluate the text, preserving complete functionality.

### 3. Context-Aware Deterministic Risk Engine (0–100)
Every rule match requires an **exact verbatim quotation** extracted from the job text.

| Rule ID | Name | Weight | Context & Negation Protection |
| :--- | :--- | :---: | :--- |
| `UPFRONT_PAYMENT` | Upfront Payment Requirement | +40 | Flags registration fees, security deposits, or placement charges. Correctly ignores statements like *"No registration fee required"*. |
| `SUSPICIOUS_MESSAGING` | Unverified Messaging Recruitment | +20 | Identifies requirements to conduct interviews exclusively via WhatsApp or Telegram without corporate email. |
| `IDENTITY_INCONSISTENCY` | Identity / Domain Mismatch | +20 | Flags corporate recruiters using free public webmail (@gmail.com, @yahoo.com) instead of corporate domains. |
| `GUARANTEED_SELECTION` | Guaranteed Offer Without Assessment | +15 | Detects promises of 100% placement or hiring without skill evaluation. |
| `IMPLAUSIBLE_COMPENSATION` | Implausible Compensation | +15 | Identifies unrealistic compensation claims (e.g. ₹1,50,000/week for casual data entry). |
| `SENSITIVE_FINANCIAL_INFO` | Sensitive Financial Credentials | +25 | Flags requests for bank PINs, passwords, OTPs, or CVV numbers before hiring. |
| `VAGUE_JOB_DESCRIPTION` | Vague or Non-Substantive Listing | +10 | Highlights postings lacking responsibilities or qualifications. |
| `COERCIVE_URGENCY` | Coercive Pressure & Artificial Deadlines | +10 | Flags threats of offer revocation tied to immediate payment transfers. |

### 4. Pretrained ML Employment Fraud Model
- **Verified Hugging Face Repository**: `vaibhav07112004/fraud-detection-models`
- **Model Artifact**: `employment_fraud_model.pkl` (`RandomForestClassifier` with `classes_ = [0, 1]`, positive fraud class `1`)
- **Vectorizer Artifact**: `employment_vectorizer.pkl` (`TfidfVectorizer`, 1,000 features, English stop words)
- **Probability Output**: Supports `predict_proba()`, extracting fraud probability mapped to 0–100.
- **In-Memory Caching & Offline Mode**: Downloaded once via `huggingface_hub` into local cache or specified via `MODEL_LOCAL_DIR`.
- **Diagnostics**: `/api/health` exposes real-time ML subsystem health and artifact metadata.

### 5. Hybrid Scoring Engine & High-Severity Safeguards
When both ML and deterministic rules are operational, the hybrid risk score is computed:
$$\text{hybrid\_score} = \text{clamp}(0.60 \times \text{ml\_risk\_score} + 0.40 \times \text{rule\_risk\_score},\ 0,\ 100)$$

If one system is unavailable, JobShield gracefully degrades to `rule_only` or `ml_only` mode.

**High-Severity Score Floors**:
- Mandatory candidate-paid registration or recruitment fee: Final score $\ge 40$ (High Risk)
- Request to transfer money to secure a job or interview: Final score $\ge 50$ (High Risk)
- Request for banking credentials, PIN, OTP, or passwords: Final score $\ge 60$ (Critical Risk)

**Scoring Thresholds**:
- `0 - 19`: **Low Risk** (No strong fraud indicators identified)
- `20 - 39`: **Moderate Risk** (Caution warranted; some anomalies present)
- `40 - 59`: **High Risk** (Significant red flags such as registration fees)
- `60 - 100`: **Critical Risk** (Multiple compounding fraud indicators)

### 6. Chrome Extension Companion (Manifest V3)
The Chrome extension has been streamlined into a **companion launcher**:
- Clicking the extension icon queries the active tab.
- If the current tab contains a job URL, it encodes the URL and opens `http://localhost:5173/?url=<encoded_url>` in a new browser tab.
- The website automatically prefills the input field so the user can immediately analyze the posting.

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.10+** (Tested on Python 3.13)
- **Node.js 18+** & **npm**

### Step 1: Start the Backend API

```powershell
# Navigate to backend directory
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Run the FastAPI server with hot-reload
uvicorn app.main:app --reload --port 8000
```
The backend API will start on **http://127.0.0.1:8000**.
- Health Check: `http://127.0.0.1:8000/api/health`
- Interactive Swagger Docs: `http://127.0.0.1:8000/docs`

### Step 2: Start the Frontend Application

In a separate terminal:
```powershell
# Navigate to frontend directory
cd frontend

# Install node dependencies
npm install

# Start Vite development server
npm run dev
```
The web application will open at **http://localhost:5173**.

---

## 🧪 Running Automated Tests

### Backend Test Suite
Run the complete Pytest suite (21 automated tests):
```powershell
cd backend
python -m pytest tests/ -v
```

Specialized test modules include:
- `tests/test_cook_n_klean.py`:
  - **Cook N Klean Regression Test**: Evaluates the real Cook N Klean HR internship text containing ₹199 registration fee payable after orientation and performance-based stipend. Confirms isolation of stipend from fees, detection of upfront candidate-paid fee rule, application of $\ge 40$ high-severity floor, and risk level $\ge$ High.
  - **Rule-Only Fallback Verification**: Confirms that when ML is unavailable, analysis gracefully falls back to `rule_only` without fabricating 0 scores.
- `tests/test_financial_semantics.py`:
  - 11 comprehensive tests validating contextual fee detection, Indian currency formats (₹199, Rs. 199, INR 199), negated statements ("no registration fee"), candidate-paid vs company stipend separation, multiple fee mentions, and money transfer requests.
- `tests/test_backend.py`:
  - 8 integration tests covering synthetic fixtures A through G and SSRF security validations.

### Frontend Production Build
```powershell
cd frontend
npm run build
```
Compiles TypeScript with zero errors and packages assets into `dist/`.

---

## 🧩 Installing the Companion Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the root directory of this project (`redflag_v1`).
5. Pin the **JobShield** extension icon to your toolbar.
6. When browsing any job on LinkedIn or Indeed, click the JobShield icon. It will open your JobShield web application in a new tab with the job URL prefilled and ready for analysis!

### Configuring Production Web App URL
To deploy the extension for production:
1. Open `background.js`.
2. Change `DEFAULT_WEB_APP_URL = "http://localhost:5173"` to your deployed domain (e.g., `https://redflag.app`).
3. Or set `chrome.storage.sync.set({ webAppUrl: "https://your-domain.com" })`.

---

## 🛡️ Security & Privacy Notice
- **No Platform Scraping Violations**: JobShield does not circumvent CAPTCHAs, inject unauthorized scripts into third-party sites, or bypass authentication walls.
- **SSRF Defended**: All external URLs fetched by the backend are strictly resolved against private IP blocks and AWS/GCP/Azure link-local metadata addresses.
- **Audit Persistence**: Analysis records are persisted locally in SQLite (`jobshield_analyses.db`). No applicant passwords or sensitive personal data are ever collected or stored.
