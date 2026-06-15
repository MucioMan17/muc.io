// ============================================================
// muc.io — External OSINT Tool Integration (optional)
// ============================================================
//
// If the user has the well-known OSINT tools installed, we run them
// automatically and fold their results in. These are maintained by
// their authors to keep up with site changes, so when present they
// give far broader, more reliable coverage than anything hand-rolled:
//
//   holehe   — checks 120+ sites for whether an EMAIL is registered
//   sherlock — checks 400+ sites for a USERNAME
//
// If a tool isn't installed, we skip it silently (with a note) — the
// app's built-in checks still run. Nothing here is required.

const { execFile } = require('child_process');

const RUN_TIMEOUT = 90000; // tools can be slow across hundreds of sites

// Cache availability so we don't re-probe on every request.
const availabilityCache = {};

function run(cmd, args, timeout = RUN_TIMEOUT) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// Probe whether a command exists by trying to run it with --help.
async function isAvailable(cmd) {
  if (availabilityCache[cmd] !== undefined) return availabilityCache[cmd];
  const { err, stdout, stderr } = await run(cmd, ['--help'], 8000);
  // ENOENT => not installed. Anything that produced output => it's there.
  const ok = !(err && err.code === 'ENOENT') && (stdout.length > 0 || stderr.length > 0 || !err);
  availabilityCache[cmd] = ok;
  return ok;
}

// ── holehe (email → registered accounts) ──────────────────────
async function runHolehe(email) {
  if (!(await isAvailable('holehe'))) {
    return { available: false, note: 'holehe not installed', sites: [] };
  }
  // --only-used keeps just the hits; --no-color keeps output parseable.
  const { stdout } = await run('holehe', [email, '--only-used', '--no-color']);
  const sites = [];
  for (const line of stdout.split('\n')) {
    // holehe marks a used account with a "[+] domain.com" line.
    const m = line.match(/\[\+\]\s+([a-z0-9.\-]+\.[a-z]{2,})/i);
    if (m) sites.push(m[1].trim());
  }
  return { available: true, sites: [...new Set(sites)] };
}

// ── sherlock (username → profile URLs) ────────────────────────
async function runSherlock(username) {
  if (!(await isAvailable('sherlock'))) {
    return { available: false, note: 'sherlock not installed', accounts: [] };
  }
  const { stdout } = await run('sherlock', [username, '--print-found', '--no-color', '--timeout', '10']);
  const accounts = [];
  for (const line of stdout.split('\n')) {
    // sherlock prints found accounts as "[+] SiteName: https://url"
    const m = line.match(/\[\+\]\s+([^:]+):\s+(https?:\/\/\S+)/);
    if (m) accounts.push({ site: m[1].trim(), url: m[2].trim() });
  }
  return { available: true, accounts };
}

module.exports = { runHolehe, runSherlock, isAvailable };
