# OSINT Investigation Dashboard

A self-hosted tool for volunteer investigators who document online predators and
refer them to law enforcement. It does three things:

1. **Username lookup** — checks a username against platforms that expose a public
   API (verified results) and builds candidate links for login-walled sites
   (manual confirmation).
2. **Case management** — organizes suspects, identifiers, and a timestamped,
   tamper-evident evidence log per case.
3. **Report export** — produces a clean, court-friendly referral document with
   integrity hashes and the right agencies to send it to.

Everything runs locally on your machine. No data leaves your computer except the
lookup requests to public profile pages.

---

## Requirements

- [Node.js](https://nodejs.org) version 18 or newer (includes `npm`).
  Check with: `node --version`

## Run it — step by step

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Start the server
npm start

# 3. Open the dashboard in your browser
#    http://localhost:3000
```

To stop the server, press `Ctrl+C` in the terminal.

Your data is stored in a local SQLite file at `data/cases.db` (created
automatically, and git-ignored so it never gets committed).

---

## How to use it

### 1. Create a case
- Click **Cases → + New Case**.
- Give it a codename, your investigator name, and any background notes.

### 2. Look up a username
- Go to **Username Lookup**, type the handle, pick the case to attach it to,
  and click **Search All Platforms**.
- Results are grouped:
  - 🟢 **Verified** — confirmed via the platform's public API. Click "View profile".
  - 🟡 **Manual** — a candidate link on a site we can't auto-verify (Instagram,
    Facebook, TikTok, Snapchat, etc.). **These are leads, not matches.** Open the
    link and confirm with your own eyes before treating it as the suspect's.
  - ⚪ **Absent** — confirmed the username does not exist there.

### 3. Build the suspect profile
- Open the case → **Suspects → + Add Suspect Profile**.
- Record known usernames, emails, phone numbers, and confirmed profile URLs.

### 4. Log evidence
- Go to **Log Evidence**, pick the case, choose the type (chat log, screenshot
  description, profile info, URL, etc.), set the **actual time the event
  happened**, paste the content, and add your name as collector.
- Every entry is **append-only** and stamped with a **SHA-256 integrity hash**.
  If anyone later alters the record, the dashboard and the report flag it as
  tampered. This is what makes the log credible to investigators.

### 5. Export the report
- Open the case → **Export LE Report**.
- You get a plain-text file with the suspect summary, verified/manual lookup
  results, the full evidence log with integrity status, and submission links.

---

## Read this before you investigate

This tool is for **documentation and referral** — not confrontation. To keep your
work useful (and yourself safe and lawful):

- **Report child exploitation to NCMEC immediately:**
  https://report.cybertip.org · 1-800-843-5678. They coordinate with law
  enforcement worldwide.
- **Never download, save, screenshot, or forward suspected child sexual abuse
  material (CSAM).** Possessing it is a serious crime even if your intent is to
  build a case. Record *where* it is and let trained investigators retrieve it.
- **Don't entrap.** Don't initiate, suggest, or escalate criminal conduct. If you
  pose as a minor, coordinate with law enforcement first — sloppy stings can get
  a real case thrown out.
- **Don't tip off or publicly name suspects.** Vigilante exposure can destroy a
  prosecution and put people in danger, including you.
- **Preserve originals.** Don't edit messages, crop context, or alter timestamps.
- **Work with the authorities,** ideally an ICAC Task Force
  (https://www.icactaskforce.org) or your local police, not around them.

If a child appears to be in immediate danger, call **911** (or your local
emergency number) now.

---

## Project layout

```
server.js            Express app entry point
routes/lookup.js     Username search endpoint + history
routes/cases.js      Cases, suspects, evidence (with hashing)
routes/reports.js    Plain-text / JSON referral report generator
utils/platforms.js   Platform definitions and verification logic
utils/db.js          SQLite schema + migrations
public/              Browser dashboard (HTML/CSS/JS)
data/cases.db        Your local database (auto-created, git-ignored)
```
