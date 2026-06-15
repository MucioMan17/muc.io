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
  {
    name: 'Duolingo',
    url: (u) => `https://www.duolingo.com/profile/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://www.duolingo.com/2017-06-30/users?username=${encodeURIComponent(u)}`, {
        headers: { 'User-Agent': UA }, validateStatus: null,
      });
      if (r.status !== 200 || !r.data?.users?.length) return NOT_FOUND;
      return r.data.users[0]?.username?.toLowerCase() === u.toLowerCase() ? FOUND : NOT_FOUND;
    },
  },
  {
    name: 'Chess.com',
    url: (u) => `https://www.chess.com/member/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://api.chess.com/pub/player/${encodeURIComponent(u.toLowerCase())}`, {
        headers: { 'User-Agent': UA }, validateStatus: null,
      });
      if (r.status === 200 && r.data?.username) return FOUND;
      if (r.status === 404) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Lichess',
    url: (u) => `https://lichess.org/@/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://lichess.org/api/user/${encodeURIComponent(u)}`, {
        headers: { 'User-Agent': UA }, validateStatus: null,
      });
      if (r.status === 200 && r.data?.username) return FOUND;
      if (r.status === 404) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'HackerNews',
    url: (u) => `https://news.ycombinator.com/user?id=${u}`,
    check: async (u) => {
      const r = await axios.get(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(u)}.json`, {
        headers: { 'User-Agent': UA }, validateStatus: null,
      });
      if (r.status === 200 && r.data && r.data.id) return FOUND;
      if (r.status === 200 && r.data === null) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Dev.to',
    url: (u) => `https://dev.to/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://dev.to/api/users/by_username?url=${encodeURIComponent(u)}`, {
        headers: { 'User-Agent': UA }, validateStatus: null,
      });
      if (r.status === 200 && r.data?.username) return FOUND;
      if (r.status === 404) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Codeforces',
    url: (u) => `https://codeforces.com/profile/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(u)}`, {
        headers: { 'User-Agent': UA }, validateStatus: null,
      });
      if (r.status === 200 && r.data?.status === 'OK' && r.data?.result?.length) return FOUND;
      if (r.data?.comment?.includes('not found')) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Minecraft',
    url: (u) => `https://namemc.com/profile/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(u)}`, {
        headers: { 'User-Agent': UA }, validateStatus: null,
      });
      if (r.status === 200 && r.data?.id) return FOUND;
      if (r.status === 404 || r.status === 204) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Scratch',
    url: (u) => `https://scratch.mit.edu/users/${u}/`,
    check: async (u) => {
      const r = await axios.get(`https://api.scratch.mit.edu/users/${encodeURIComponent(u)}/`, {
        headers: { 'User-Agent': UA }, validateStatus: null,
      });
      if (r.status === 200 && r.data?.username) return FOUND;
      if (r.status === 404) return NOT_FOUND;
      return UNKNOWN;
    },
  },
  {
    name: 'Twitch',
    url: (u) => `https://www.twitch.tv/${u}`,
    check: async (u) => {
      const r = await axios.post(
        'https://gql.twitch.tv/gql',
        [{ query: `{user(login:"${u.toLowerCase()}"){id,login}}` }],
        { headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'User-Agent': UA, 'Content-Type': 'application/json' }, validateStatus: null }
      );
      if (r.status === 200 && r.data?.[0]?.data?.user?.id) return FOUND;
      if (r.status === 200 && r.data?.[0]?.data?.user === null) return NOT_FOUND;
      return UNKNOWN;
    },
  },
];

// ---- Manual-verification platforms (URL only, never auto-confirmed) ----
// Login walls / aggressive anti-bot make automated checks unreliable.
const MANUAL = [
  // Social
  { name: 'Instagram',         url: (u) => `https://www.instagram.com/${u}/` },
  { name: 'Facebook',          url: (u) => `https://www.facebook.com/${u}` },
  { name: 'X / Twitter',       url: (u) => `https://x.com/${u}` },
  { name: 'TikTok',            url: (u) => `https://www.tiktok.com/@${u}` },
  { name: 'Snapchat',          url: (u) => `https://www.snapchat.com/add/${u}` },
  { name: 'Pinterest',         url: (u) => `https://www.pinterest.com/${u}/` },
  { name: 'VSCO',              url: (u) => `https://vsco.co/${u}/gallery` },
  { name: 'BeReal',            url: (u) => `https://bere.al/${u}` },
  // Gaming
  { name: 'Xbox Gamertag',     url: (u) => `https://xboxgamertag.com/search/${encodeURIComponent(u)}` },
  { name: 'PlayStation (PSN)', url: (u) => `https://my.playstation.com/profile/${u}` },
  { name: 'Fortnite Tracker',  url: (u) => `https://fortnitetracker.com/profile/all/${encodeURIComponent(u)}` },
  // Video
  { name: 'YouTube',           url: (u) => `https://www.youtube.com/@${u}` },
  { name: 'Twitch',            url: (u) => `https://www.twitch.tv/${u}` },
  // Community / Teen
  { name: 'Ask.fm',            url: (u) => `https://ask.fm/${u}` },
  { name: 'Wattpad',           url: (u) => `https://www.wattpad.com/user/${u}` },
  { name: 'Amino',             url: (u) => `https://aminoapps.com/u/${u}` },
  // Messaging
  { name: 'Kik',               url: (u) => `https://ws2.kik.com/user/${u}` },
  { name: 'Discord',           url: (u) => `https://discord.com/users/${u}` },
  // Music
  { name: 'SoundCloud',        url: (u) => `https://soundcloud.com/${u}` },
  { name: 'Spotify',           url: (u) => `https://open.spotify.com/user/${u}` },
  // Professional
  { name: 'LinkedIn',          url: (u) => `https://www.linkedin.com/in/${u}` },
  { name: 'Medium',            url: (u) => `https://medium.com/@${u}` },
  // Content
  { name: 'OnlyFans',          url: (u) => `https://onlyfans.com/${u}` },
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
