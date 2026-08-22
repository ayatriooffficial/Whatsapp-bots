# Charters WhatsApp Bot — Complete Master Guide

Everything you need to run, configure, link, test in sandbox mode, and manage the WhatsApp bot — from zero to production.

---

## 1. Executive Overview

The **Charters WhatsApp Bot** (`whatsapp-bot-master`) is an automated admissions and conversational AI assistant for **Charters Union of Business**. It performs four core roles:

1. **3-Day × 2-Slot Scheduled Drip Campaigns**:
   - Reads leads from Google Sheets (`cookie_import`, `CBA`, `DGM`, `TBM`).
   - Delivers 6 sequential, progressive messages across 3 days (Slot 1 at ~10:00, Slot 2 at ~18:00, or custom Excel times).
   - Once all 6 messages are delivered, the lead is marked `Stage=done` and cleanly removed from active lists.
2. **Two-Way Inbound Conversational AI (Ragini - AI Admission Counselor)**:
   - Grounded directly on the full Charters Union knowledge base ([`data/chartersKnowledge.json`](file:///Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master/data/chartersKnowledge.json)), achieving complete parity with the website's `askBot.js`.
   - Answers inquiries on **CBA™**, **DGM™**, **TBM™**, Fees (EMI from ₹5,555/mo), Scholarships (up to ₹16,000), Placements (26.5 LPA avg CTC, 97.7% placement), ROI comparisons, and the 3-step admission process.
   - Enforces strict domain guardrails (politely deflecting coding/Python/trivia questions back to Charters career programs).
3. **Group Chat Bot Support (`@g.us`)**:
   - When added to WhatsApp groups, stays completely silent during regular conversation.
   - Responds only when @mentioned, quoted, or asked with `@Ragini` or `/ask`.
4. **Sandbox Test Mode**:
   - Dedicated single-phone testing mode (`SANDBOX=true`, `SANDBOX_PHONE=91...`) allowing team members to test all 6 stages fast-track with 10-second delays without affecting live leads.

---

## 2. Key Links & File References

| Component | Path / Link |
| :--- | :--- |
| **Google Sheet** (Master Database) | [Open Google Sheet](https://docs.google.com/spreadsheets/d/1bAO5B_OEQGWpFNLIJKLvj0ju0ogGk85N7NmNU6DORv4) |
| **Sheet Tabs** | `cookie_import` (Master) · `CBA` · `DGM` · `TBM` · `Messages` (Schedule) · `Manual Leads` |
| **Bot Workspace** | `/Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master` |
| **QR Code Web Page** | `http://localhost:3001/qr` |
| **Sandbox Fast-Track Trigger** | `http://localhost:3001/sandbox/run` |
| **Sandbox Status Check** | `http://localhost:3001/sandbox/status` |

---

## 3. Configuration (`.env`)

All parameters are configured in [`whatsapp-bot-master/.env`](file:///Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master/.env):

```env
# Port for the bot's web UI (QR & Sandbox triggers)
PORT=3001

# --- Google Sheets ---
SHEET_ID=your_google_sheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# --- Gemini AI ---
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-lite
AI_MAX_REQ_PER_MIN=25

# --- Bot URLs & Helplines ---
APP_BASE_URL=https://charter-temp.vercel.app
WEBSITE_BASE_URL=https://chartersunion.com
HELPLINE_PHONE=+91 9836465083
WHATSAPP_GROUP_URL=https://chat.whatsapp.com/invite/charters-union
SUPPORT_PHONE=+91 9836465083

# --- SANDBOX TEST MODE ---
# Set SANDBOX=true to restrict bot strictly to your test phone
# Set SANDBOX=false for live production deployment
SANDBOX=true
SANDBOX_PHONE=91XXXXXXXXXX
SANDBOX_COURSE=CBA
SANDBOX_FAST_DELAY_SEC=10
SANDBOX_NAME=Candidate

# --- Anti-Ban / Campaign Volume ---
SEND_INTERVAL_MS=60000
SEND_INTERVAL_JITTER_MS=15000
MAX_DAILY_MESSAGES=150
MAX_MESSAGES_PER_DAY=2
TOTAL_SESSIONS=6
SLOT1_TIME=10:00
SLOT2_TIME=18:00
```

---

## 4. Linking & Managing Your WhatsApp Number

> **Important**: The phone that scans the QR code **IS** the bot. Use a dedicated or disposable business number, not a personal account.

### 4.1 Link a Device (First Time)
1. Start the bot:
   ```bash
   cd /Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master
   npm start
   ```
2. Open `http://localhost:3001/qr` in your browser (or view QR in the terminal).
3. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device** → Scan the QR code.
4. Terminal outputs `✅ BOT READY`.

### 4.2 Unlink / Relink a Device
- **From Phone**: WhatsApp → Settings → Linked Devices → Tap active device → **Log Out**.
- **From Terminal**: Delete `.wwebjs_auth`:
  ```bash
  rm -rf .wwebjs_auth
  ```
  Restarting `npm start` will present a fresh QR code.

---

## 5. Sandbox Test Mode (Fast-Track Single-Phone Testing)

Sandbox mode allows developers and counselors to test the full 6-stage campaign and two-way AI chat on a single phone with zero risk of messaging real student leads.

### 5.1 Set Up Sandbox in `.env`
```env
SANDBOX=true
SANDBOX_PHONE=919836465083      # Your test phone (country code + 10 digits, no +)
SANDBOX_COURSE=ALL              # "ALL" (delivers both CBA & DGM = 12 messages), or "CBA", "DGM"
SANDBOX_FAST_DELAY_SEC=8        # Seconds between stage messages (e.g. 8s instead of 3 days)
```

### 5.2 Trigger the Combined 12-Message Fast-Track Campaign
While `npm start` is running:
- **Via Web Browser**: Open `http://localhost:3001/sandbox/run`  
  *(Or with custom parameters: `http://localhost:3001/sandbox/run?phone=919836465083&course=ALL&delay=5`)*
- **Via Terminal**:
  ```bash
  npm run sandbox
  ```
The bot delivers all **12 stage messages** (6 for CBA + 6 for DGM) sequentially to your test phone with poster images and fast intervals.

---

## 6. Two-Way Inbound Chat (Ragini AI Counselor)

The bot dynamically answers any question sent directly to its WhatsApp number in real time:

| Question Type | Example Inbound Message | Counselor Behavior |
| :--- | :--- | :--- |
| **Institute Overview** | *"what is chaterunion"* | Explains 4 core pillars, global presence (7 countries), programs table, and placement outcomes. |
| **Fee & EMI** | *"what is the fee for CBA?"* | Breaks down EMI (starting ₹5,555/mo), scholarships (up to ₹16,000), seat booking (₹2,000). |
| **Placement & CTC** | *"tell me about placements in DGM"* | Shows 92% placement rate, 24.5 LPA average CTC, 2.5x salary hike, top recruiters (Google, Amazon, Meta partners). |
| **ROI Analysis** | *"What is the ROI of CBA vs DGM?"* | Compares salary growth (3.05x vs 2.5x) against short program duration and accessible fees. |
| **Anti-Coding Guardrail**| *"write python script for binary search"* | Politely declines coding/trivia and redirects the user to explore Charters Union career programs. |

### Standard Response Footer
Every direct message concludes with:
```text
────────────────────────────
💬 *Need personalized career guidance?*
Our admission experts can help you choose the right path.

📞 *Talk to Us:* +91 9836465083
👥 *Join WhatsApp Group:* https://chat.whatsapp.com/invite/charters-union
📝 *Apply Now:* https://chartersunion.com/apply
```

---

## 7. Group Chat Bot Support (`@g.us`)

You can add the scanned bot number into any WhatsApp Group (e.g. *"Charters Admissions 2026"*).

### 7.1 How It Works:
1. **Passive In-Group Listening**: The bot never spams regular member chatter.
2. **Triggering the Bot**:
   - Tag / @mention the bot: `@+919836465083 what is the duration for TBM?`
   - Quote / reply to any previous message from the bot.
   - Start the message with `@Ragini`, `Ragini,`, `/ask`, or `!ask`.
3. **In-Group Response**:
   - Tags the specific member by name.
   - Provides clean, concise answers (<180 words).
   - Appends a compact single-line footer: `📞 Admissions Helpline: +91 9836465083 | 📝 Apply: https://chartersunion.com/apply`.

---

## 8. Service Startup Cheatsheet

| Application | Folder | Start Command | Default URL / Port |
| :--- | :--- | :--- | :--- |
| **WhatsApp Bot** | `whatsapp-bot-master` | `npm start` | `http://localhost:3001/qr` |
| **Charters Backend** | `Charters-Business-v1/backend` | `npm run dev` | `http://localhost:5000` |
| **Charters Frontend** | `Charters-Business-v1/frontend` | `npm run dev` | `http://localhost:3000` |
| **Content Agent Backend** | `content-agent/backend` | `npm run dev` | `http://localhost:4000` |
| **Content Agent Frontend** | `content-agent/frontend` | `npm run dev` | `http://localhost:5173` |
| **AI Content Manager** | `Ai-Content-manager` | `npm run dev` | `http://localhost:5174` |

---

## 9. Automated Testing Commands

From the `whatsapp-bot-master` directory:

```bash
# 1. Test Inbound Ragini AI Counselor (Direct Queries, Fact Lookups, Guardrails)
npm run test:inbound

# 2. Test Group Chat Mentions and In-Group Formatting
node test/testGroupMention.js

# 3. Test Full 6-Stage Sandbox Fast-Track Campaign
npm run sandbox
```

---

## 10. Switching to Live Production

When all testing is complete:
1. Open [`whatsapp-bot-master/.env`](file:///Users/omshukla/Documents/devlopment-coding/notdeploy-chaterbussiness/whatsapp-bot-master/.env).
2. Set:
   ```env
   SANDBOX=false
   ```
3. Restart the bot (`npm start`). The bot will now operate across all live student leads from the Google Sheet based on configured daily slot times (`10:00` and `18:00`).
