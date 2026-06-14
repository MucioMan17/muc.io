const axios = require('axios');

// ============================================================
// Platform lookup engine
// ============================================================
//
// DESIGN PRINCIPLE: Avoid false positives at all costs.
//
// Many large platforms (Instagram, Facebook, X/Twitter, LinkedIn, Snapchat)
// serve a login wall that returns HTTP 200 for ANY username — real or not.
// Naively trusting that status code produces false "FOUND" results, which in
// an investigation could implicate an innocent person. We therefore split
// platforms into two groups:
//
//   RELIABLE — verified through a real public JSON/XML API or an
//              unambiguous "not found" signal. Returns FOUND / NOT_FOUND.
//   MANUAL   — cannot be reliably auto-verified. We construct the candidate
//              profile URL and flag it MANUAL so the investigator confirms by
//              eye. Never reported as a confirmed hit.
//
// Every result carries a `confidence` so the report can be honest about it.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 8000;
const CONCURRENCY = 6;

// ---- Reliable, API-backed checks ----
// Each check returns one of: 'found' | 'not_found' | 'indeterminate'.
// CRITICAL: only return 'not_found' on an UNAMBIGUOUS negative signal (a clean
// 404, or a valid API response that contains no user). A 403/429/5xx means the
// platform blocked or rate-limited us — we genuinely do not know, so we return
// 'indeterminate' rather than falsely telling an investigator the account is
// absent. Mislabeling a real account as "not found" could derail a case.
const FOUND = 'found', NOT_FOUND = 'not_found', UNKNOWN = 'indeterminate';

const RELIABLE = [
  {
    name: 'GitHub',
    url: (u) => `https://github.com/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://api.github.com/users/${encodeURIComponent(u)}`, {
        headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
        validateStatus: null,
      });
      if (r.status === 200) return FOUND;
      if (r.status === 404) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'GitLab',
    url: (u) => `https://gitlab.com/${u}`,
    check: async (u) => {
      const r = await axios.get(
        `https://gitlab.com/api/v4/users?username=${encodeURIComponent(u)}`,
        { headers: { 'User-Agent': UA }, validateStatus: null }
      );
      if (r.status === 200 && Array.isArray(r.data)) return r.data.length > 0 ? FOUND : NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Reddit',
    url: (u) => `https://www.reddit.com/user/${u}`,
    check: async (u) => {
      const r = await axios.get(
        `https://www.reddit.com/user/${encodeURIComponent(u)}/about.json`,
        { headers: { 'User-Agent': UA }, validateStatus: null }
      );
      if (r.status === 200 && r.data && r.data.data && !r.data.error) return FOUND;
      if (r.status === 404) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Roblox',
    url: (u) => `https://www.roblox.com/users/profile?username=${encodeURIComponent(u)}`,
    check: async (u) => {
      const r = await axios.post(
        'https://users.roblox.com/v1/usernames/users',
        { usernames: [u], excludeBannedUsers: false },
        { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, validateStatus: null }
      );
      if (r.status === 200 && r.data && Array.isArray(r.data.data)) {
        return r.data.data.length > 0 ? FOUND : NOT_FOUND;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Steam',
    url: (u) => `https://steamcommunity.com/id/${u}`,
    check: async (u) => {
      // The XML endpoint returns <steamID64> for a real vanity URL,
      // or an <error> element when the profile does not exist.
      const r = await axios.get(
        `https://steamcommunity.com/id/${encodeURIComponent(u)}/?xml=1`,
        { headers: { 'User-Agent': UA }, validateStatus: null }
      );
      const body = String(r.data || '');
      if (r.status === 200 && body.includes('<steamID64>')) return FOUND;
      if (r.status === 200 && /The specified profile could not be found|<error>/.test(body)) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Keybase',
    url: (u) => `https://keybase.io/${u}`,
    check: async (u) => {
      const r = await axios.get(
        `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${encodeURIComponent(u)}`,
        { headers: { 'User-Agent': UA }, validateStatus: null }
      );
      // status.code 0 = OK; them[i] is null when that username is unclaimed.
      if (r.status === 200 && r.data && r.data.status && r.data.status.code === 0 && Array.isArray(r.data.them)) {
        return r.data.them.some((x) => x) ? FOUND : NOT_FOUND;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Telegram',
    url: (u) => `https://t.me/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://t.me/${encodeURIComponent(u)}`, {
        headers: { 'User-Agent': UA },
        validateStatus: null,
      });
      const body = String(r.data || '');
      // A real public username renders a profile card with this class. The
      // generic fallback page (no such username) omits it but still returns 200.
      if (r.status === 200 && body.includes('tgme_page_title')) return FOUND;
      if (r.status === 200) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Tumblr',
    url: (u) => `https://${u}.tumblr.com`,
    check: async (u) => {
      const r = await axios.get(`https://${encodeURIComponent(u)}.tumblr.com`, {
        headers: { 'User-Agent': UA },
        maxRedirects: 0,
        validateStatus: null,
      });
      if (r.status === 200) return FOUND;
      if (r.status === 404) return NOT_FOUND;
      return UNKNOWN; // 301/302 redirect to tumblr.com is ambiguous (often a block)
    },
  },
];

// ---- Manual-verification platforms (URL only, never auto-confirmed) ----
// Login walls / aggressive anti-bot make automated checks unreliable.
const MANUAL = [
  { name: 'Instagram', url: (u) => `https://www.instagram.com/${u}/` },
  { name: 'Facebook', url: (u) => `https://www.facebook.com/${u}` },
  { name: 'X / Twitter', url: (u) => `https://x.com/${u}` },
  { name: 'TikTok', url: (u) => `https://www.tiktok.com/@${u}` },
  { name: 'Snapchat', url: (u) => `https://www.snapchat.com/add/${u}` },
  { name: 'LinkedIn', url: (u) => `https://www.linkedin.com/in/${u}` },
  { name: 'YouTube', url: (u) => `https://www.youtube.com/@${u}` },
  { name: 'Twitch', url: (u) => `https://www.twitch.tv/${u}` },
  { name: 'Pinterest', url: (u) => `https://www.pinterest.com/${u}/` },
  { name: 'SoundCloud', url: (u) => `https://soundcloud.com/${u}` },
  { name: 'Spotify', url: (u) => `https://open.spotify.com/user/${u}` },
  { name: 'Medium', url: (u) => `https://medium.com/@${u}` },
  { name: 'Discord (invite)', url: (u) => `https://discord.com/invite/${u}` },
  { name: 'Kik', url: (u) => `https://ws2.kik.com/user/${u}` },
  { name: 'OnlyFans', url: (u) => `https://onlyfans.com/${u}` },
  { name: 'VSCO', url: (u) => `https://vsco.co/${u}/gallery` },
];

async function checkReliable(platform, username) {
  const url = platform.url(username);
  try {
    const state = await Promise.race([
      platform.check(username),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS)
      ),
    ]);

    if (state === FOUND) {
      return { platform: platform.name, found: true, status: 'FOUND', confidence: 'high', url, auto: true };
    }
    if (state === NOT_FOUND) {
      return { platform: platform.name, found: false, status: 'NOT FOUND', confidence: 'high', url, auto: true };
    }
    // indeterminate — blocked, rate-limited, or unexpected response.
    return { platform: platform.name, found: false, status: 'CHECK BLOCKED', confidence: 'none', url, auto: true };
  } catch (err) {
    return {
      platform: platform.name,
      found: false,
      status: err.message === 'timeout' ? 'TIMEOUT' : 'ERROR',
      confidence: 'none',
      url,
      auto: true,
    };
  }
}

// Run reliable checks with a small concurrency pool to stay polite.
async function runPool(items, worker, limit) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function lookupUsername(username) {
  const reliable = await runPool(
    RELIABLE,
    (p) => checkReliable(p, username),
    CONCURRENCY
  );

  const manual = MANUAL.map((p) => ({
    platform: p.name,
    found: false,
    status: 'MANUAL CHECK',
    confidence: 'unverified',
    url: p.url(username),
    auto: false,
  }));

  // Reliable hits first, then everything else, manual checks grouped last.
  return [...reliable, ...manual];
}

module.exports = { lookupUsername, RELIABLE, MANUAL };
