// ============================================================
// muc.io — OSINT Correlation Engine
// ============================================================
//
// Every identifier (email, username, phone, discord) is a seed.
// Enriching a seed often reveals new identifiers (GitHub public
// email, Keybase verified links, Dev.to linked accounts). Those
// get fed back in as new seeds for a second pass, so one starting
// point fans out into a complete profile automatically.
//
// Platforms with real free public APIs return structured data.
// Login-walled platforms get clearly-labelled manual-check links.

const axios  = require('axios');
const crypto = require('crypto');
const { findAccountsByEmail } = require('./account-finder');
const { runHolehe, runSherlock } = require('./external-tools');

const UA      = 'Mozilla/5.0 (compatible; research-tool/1.0)';
const TIMEOUT = 10000;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function get(url, opts = {}) {
  return axios.get(url, { headers: { 'User-Agent': UA }, validateStatus: null, timeout: TIMEOUT, ...opts });
}
async function post(url, data, opts = {}) {
  return axios.post(url, data, { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, validateStatus: null, timeout: TIMEOUT, ...opts });
}
async function safe(fn) {
  try { return await fn(); }
  catch (e) { return { found: false, error: e.message }; }
}
async function pool(items, fn, limit = 5) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
    })
  );
  return results;
}

// ─────────────────────────────────────────────────────────────
// Username candidate extraction from email
// ─────────────────────────────────────────────────────────────

function emailToUsernameCandidates(email) {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const candidates = new Set([local]);
  candidates.add(local.replace(/[._-]/g, ''));
  const parts = local.split(/[._-]/);
  if (parts.length > 1) {
    candidates.add(parts[0]);
    candidates.add(parts.join(''));
    candidates.add(parts[0] + parts[1]);
    candidates.add(parts[0][0] + parts.slice(1).join(''));
    if (parts.length >= 2) { candidates.add(parts[0] + '_' + parts[1]); candidates.add(parts[0] + '.' + parts[1]); }
  }
  const numMatch = local.match(/^([a-z._-]+?)(\d+)$/);
  if (numMatch) {
    const [, base, nums] = numMatch;
    const cleanBase = base.replace(/[._-]/g, '');
    candidates.add(cleanBase);
    candidates.add(cleanBase + nums);
    const baseParts = base.split(/[._-]/);
    if (baseParts.length > 1) { candidates.add(baseParts[0] + nums); candidates.add(baseParts[0]); }
  }
  return [...candidates].filter(u => u.length >= 3 && u.length <= 32);
}

// ─────────────────────────────────────────────────────────────
// Email enrichment — now auto-searches GitHub and Keybase
// ─────────────────────────────────────────────────────────────

async function enrichEmail(email) {
  const norm = email.trim().toLowerCase();
  const [local, domain] = norm.split('@');
  const hash = crypto.createHash('md5').update(norm).digest('hex');
  const isFreemail = /^(gmail|yahoo|hotmail|outlook|icloud|proton|protonmail|live|msn|aol|me|mac|googlemail|ymail|gmx|tutanota|fastmail)\./.test(domain);

  const [gravatar, githubMatch, keybaseMatch, accountFinder, holehe] = await Promise.all([
    checkGravatar(norm, hash),
    searchGitHubByEmail(norm),
    searchKeybaseByEmail(norm),
    safe(() => findAccountsByEmail(norm)),
    safe(() => runHolehe(norm)),
  ]);

  const discovered = [];
  if (gravatar.found) {
    if (gravatar.username) discovered.push({ type: 'username', value: gravatar.username, source: 'Gravatar' });
    for (const acct of gravatar.accounts || []) {
      if (acct.username) discovered.push({ type: 'username', value: acct.username, source: `Gravatar → ${acct.service}`, url: acct.url });
    }
  }
  if (githubMatch.found && githubMatch.login) {
    discovered.push({ type: 'username', value: githubMatch.login, source: 'GitHub (email match)' });
  }
  if (keybaseMatch.found && keybaseMatch.username) {
    discovered.push({ type: 'username', value: keybaseMatch.username, source: 'Keybase (email match)' });
  }

  const usernameCandidates = emailToUsernameCandidates(norm);

  return {
    type: 'email',
    value: norm,
    data: {
      local, domain,
      domain_type: isFreemail ? 'free provider' : 'custom domain',
      hash_md5: hash,
      gravatar,
      github_match: githubMatch,
      keybase_match: keybaseMatch,
      account_finder: accountFinder && !accountFinder.error ? accountFinder : null,
      holehe: holehe && holehe.available ? holehe : null,
      username_candidates: usernameCandidates,
      manual_checks: [
        { name: 'Have I Been Pwned', description: 'Check data breach history', url: `https://haveibeenpwned.com/account/${encodeURIComponent(norm)}` },
        { name: 'Epieos', description: 'Find accounts registered to this email', url: `https://epieos.com/?q=${encodeURIComponent(norm)}&t=email` },
        { name: 'Hunter.io', description: 'Email verification & company link', url: `https://hunter.io/email-verifier/${encodeURIComponent(norm)}` },
        ...(!isFreemail ? [{ name: 'WHOIS (domain)', description: `Who registered ${domain}?`, url: `https://www.whois.com/whois/${domain}` }] : []),
        { name: 'Google Search', description: 'Search the web for this email', url: `https://www.google.com/search?q="${encodeURIComponent(norm)}"` },
      ],
    },
    discovered,
  };
}

async function checkGravatar(email, hash) {
  const r = await safe(() => get(`https://www.gravatar.com/${hash}.json`));
  if (!r || r.error) return { found: false };
  if (r.status === 200 && r.data?.entry?.[0]) {
    const e = r.data.entry[0];
    return {
      found: true,
      display_name: e.displayName || e.preferredUsername || null,
      username: e.preferredUsername || null,
      about: e.aboutMe || null,
      location: e.currentLocation || null,
      profile_url: e.profileUrl || `https://gravatar.com/${hash}`,
      avatar_url: e.thumbnailUrl || `https://www.gravatar.com/avatar/${hash}?s=200`,
      accounts: (e.accounts || []).map(a => ({ service: a.shortname, username: a.username, url: a.url })),
      urls: (e.urls || []).map(u => ({ title: u.title, value: u.value })),
    };
  }
  return { found: false };
}

async function searchGitHubByEmail(email) {
  const r = await safe(() => get(
    `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`,
    { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } }
  ));
  if (!r || r.error || r.status !== 200 || !r.data?.items?.length) return { found: false };
  const u = r.data.items[0];
  return { found: true, login: u.login, avatar_url: u.avatar_url, profile_url: u.html_url };
}

async function searchKeybaseByEmail(email) {
  const r = await safe(() => get(`https://keybase.io/_/api/1.0/user/lookup.json?email=${encodeURIComponent(email)}`));
  if (!r || r.error || r.status !== 200 || !r.data?.them?.[0]) return { found: false };
  const u = r.data.them[0];
  return { found: true, username: u.basics?.username, full_name: u.profile?.full_name || null, profile_url: `https://keybase.io/${u.basics?.username}` };
}

// ─────────────────────────────────────────────────────────────
// Username enrichment — 14 platforms with real APIs
// ─────────────────────────────────────────────────────────────

async function enrichUsername(username) {
  const platforms = [
    { name: 'GitHub',     fn: () => enrichGitHub(username) },
    { name: 'Reddit',     fn: () => enrichReddit(username) },
    { name: 'Keybase',    fn: () => enrichKeybase(username) },
    { name: 'Roblox',     fn: () => enrichRoblox(username) },
    { name: 'GitLab',     fn: () => enrichGitLab(username) },
    { name: 'Steam',      fn: () => enrichSteam(username) },
    { name: 'Telegram',   fn: () => enrichTelegram(username) },
    { name: 'Tumblr',     fn: () => enrichTumblr(username) },
    { name: 'Duolingo',   fn: () => enrichDuolingo(username) },
    { name: 'Chess.com',  fn: () => enrichChessCom(username) },
    { name: 'Lichess',    fn: () => enrichLichess(username) },
    { name: 'HackerNews', fn: () => enrichHackerNews(username) },
    { name: 'Dev.to',     fn: () => enrichDevTo(username) },
    { name: 'Codeforces', fn: () => enrichCodeforces(username) },
  ];

  const [checks, sherlock] = await Promise.all([
    pool(platforms, ({ fn }) => safe(fn), 5),
    safe(() => runSherlock(username)),
  ]);
  const byName = {};
  platforms.forEach(({ name }, i) => { byName[name] = checks[i]; });

  const discovered = [];

  const gh = byName.GitHub;
  if (gh.found) {
    if (gh.email)   discovered.push({ type: 'email',    value: gh.email,   source: 'GitHub profile' });
    if (gh.twitter) discovered.push({ type: 'username', value: gh.twitter,  source: 'GitHub → Twitter', url: `https://twitter.com/${gh.twitter}` });
    if (gh.website) discovered.push({ type: 'url',      value: gh.website,  source: 'GitHub website' });
  }
  const kb = byName.Keybase;
  if (kb.found && kb.linked_accounts) {
    for (const acct of kb.linked_accounts) {
      if (acct.username && acct.state === 'verified')
        discovered.push({ type: 'username', value: acct.username, source: `Keybase → ${acct.service} (verified)`, url: acct.url });
    }
    if (kb.website) discovered.push({ type: 'url', value: kb.website, source: 'Keybase website' });
  }
  const dt = byName['Dev.to'];
  if (dt.found) {
    if (dt.github)  discovered.push({ type: 'username', value: dt.github,  source: 'Dev.to → GitHub' });
    if (dt.twitter) discovered.push({ type: 'username', value: dt.twitter, source: 'Dev.to → Twitter', url: `https://twitter.com/${dt.twitter}` });
    if (dt.website) discovered.push({ type: 'url',      value: dt.website, source: 'Dev.to website' });
  }

  const manual_checks = [
    { name: 'Instagram',   url: `https://www.instagram.com/${username}/` },
    { name: 'TikTok',      url: `https://www.tiktok.com/@${username}` },
    { name: 'Snapchat',    url: `https://www.snapchat.com/add/${username}` },
    { name: 'Twitter / X', url: `https://x.com/${username}` },
    { name: 'Facebook',    url: `https://www.facebook.com/${username}` },
    { name: 'LinkedIn',    url: `https://www.linkedin.com/in/${username}` },
    { name: 'YouTube',     url: `https://www.youtube.com/@${username}` },
    { name: 'Twitch',      url: `https://www.twitch.tv/${username}` },
    { name: 'Discord',     url: `https://discord.com/users/${username}` },
    { name: 'Pinterest',   url: `https://www.pinterest.com/${username}/` },
    { name: 'SoundCloud',  url: `https://soundcloud.com/${username}` },
    { name: 'Kik',         url: `https://ws2.kik.com/user/${username}` },
    { name: 'Spotify',     url: `https://open.spotify.com/user/${username}` },
    { name: 'VSCO',        url: `https://vsco.co/${username}/gallery` },
  ];

  return {
    type: 'username',
    value: username,
    data: {
      platforms: byName,
      sherlock: sherlock && sherlock.available ? sherlock : null,
      manual_checks,
    },
    discovered,
  };
}

// ── GitHub ────────────────────────────────────────────────────
async function enrichGitHub(username) {
  const [uRes, repoRes] = await Promise.all([
    get(`https://api.github.com/users/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    }),
    safe(() => get(`https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=5`, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    })),
  ]);
  if (uRes.status !== 200) return { found: false, status: uRes.status };
  const d = uRes.data;
  const repos = Array.isArray(repoRes?.data) ? repoRes.data.map(r => ({ name: r.name, description: r.description, language: r.language, stars: r.stargazers_count })) : [];
  return {
    found: true, id: d.id, login: d.login, name: d.name || null,
    bio: d.bio || null, location: d.location || null, email: d.email || null,
    website: d.blog || null, company: d.company || null, twitter: d.twitter_username || null,
    followers: d.followers, following: d.following, public_repos: d.public_repos,
    created_at: d.created_at, updated_at: d.updated_at,
    avatar_url: d.avatar_url, profile_url: d.html_url, recent_repos: repos,
  };
}

// ── Reddit ────────────────────────────────────────────────────
async function enrichReddit(username) {
  const [uRes, subRes] = await Promise.all([
    get(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`),
    safe(() => get(`https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json?limit=5&sort=new`)),
  ]);
  if (uRes.status !== 200 || !uRes.data?.data || uRes.data.error) return { found: false, status: uRes.status };
  const d = uRes.data.data;
  const recentSubs = subRes?.data?.data?.children
    ? [...new Set(subRes.data.data.children.map(c => c.data?.subreddit).filter(Boolean))].slice(0, 8)
    : [];
  return {
    found: true, id: d.id, name: d.name,
    total_karma: d.total_karma, link_karma: d.link_karma, comment_karma: d.comment_karma,
    created_at: new Date(d.created_utc * 1000).toISOString(),
    account_age_days: Math.floor((Date.now() / 1000 - d.created_utc) / 86400),
    is_gold: d.is_gold, is_mod: d.is_mod,
    avatar_url: d.icon_img ? d.icon_img.split('?')[0] : null,
    profile_url: `https://www.reddit.com/user/${d.name}`,
    recent_subreddits: recentSubs,
  };
}

// ── Keybase ───────────────────────────────────────────────────
async function enrichKeybase(username) {
  const r = await get(`https://keybase.io/_/api/1.0/user/lookup.json?usernames=${encodeURIComponent(username)}`);
  if (r.status !== 200 || r.data?.status?.code !== 0 || !r.data?.them?.[0]) return { found: false };
  const u = r.data.them[0];
  if (!u) return { found: false };
  const proofs = u.proofs_summary?.all || [];
  return {
    found: true, username: u.basics?.username,
    full_name: u.profile?.full_name || null, location: u.profile?.location || null,
    bio: u.profile?.bio || null, website: u.profile?.website || null,
    avatar_url: u.pictures?.primary?.url || null,
    profile_url: `https://keybase.io/${u.basics?.username}`,
    linked_accounts: proofs.map(p => ({
      service: p.proof_type, username: p.nametag, url: p.service_url,
      state: p.state === 1 ? 'verified' : 'unverified', proof_url: p.proof_url,
    })),
  };
}

// ── Roblox ────────────────────────────────────────────────────
async function enrichRoblox(username) {
  const r1 = await post('https://users.roblox.com/v1/usernames/users', { usernames: [username], excludeBannedUsers: false });
  if (r1.status !== 200 || !r1.data?.data?.length) return { found: false };
  const uid = r1.data.data[0].id;
  const [r2, friendRes] = await Promise.all([
    get(`https://users.roblox.com/v1/users/${uid}`),
    safe(() => get(`https://friends.roblox.com/v1/users/${uid}/friends/count`)),
  ]);
  if (r2.status !== 200) return { found: false };
  const d = r2.data;
  return {
    found: true, id: d.id, username: d.name, display_name: d.displayName,
    description: d.description || null, created_at: d.created,
    account_age_days: Math.floor((Date.now() - new Date(d.created).getTime()) / 86400000),
    is_banned: d.isBanned, friend_count: friendRes?.data?.count ?? null,
    profile_url: `https://www.roblox.com/users/${d.id}/profile`,
    avatar_url: `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${d.id}&size=420x420&format=Png`,
  };
}

// ── GitLab ────────────────────────────────────────────────────
async function enrichGitLab(username) {
  const r = await get(`https://gitlab.com/api/v4/users?username=${encodeURIComponent(username)}`);
  if (r.status !== 200 || !Array.isArray(r.data) || !r.data.length) return { found: false };
  const d = r.data[0];
  return {
    found: true, id: d.id, username: d.username, name: d.name || null,
    bio: d.bio || null, location: d.location || null, website: d.website_url || null,
    created_at: d.created_at, avatar_url: d.avatar_url, profile_url: d.web_url,
  };
}

// ── Steam ─────────────────────────────────────────────────────
async function enrichSteam(username) {
  const r = await get(`https://steamcommunity.com/id/${encodeURIComponent(username)}/?xml=1`);
  const body = String(r.data || '');
  if (r.status !== 200 || !body.includes('<steamID64>')) return { found: false };
  const extract = (tag) => { const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null; };
  return {
    found: true, steam_id64: extract('steamID64'), custom_url: extract('customURL'),
    persona_name: extract('steamID'), real_name: extract('realname'),
    location: extract('location'), summary: extract('summary'),
    avatar_url: extract('avatarFull'), member_since: extract('memberSince'),
    vac_bans: extract('vacBanned') === '1', profile_url: `https://steamcommunity.com/id/${username}`,
    visibility: extract('privacyState'),
  };
}

// ── Telegram ──────────────────────────────────────────────────
async function enrichTelegram(username) {
  const r = await get(`https://t.me/${encodeURIComponent(username)}`);
  const body = String(r.data || '');
  if (r.status !== 200 || !body.includes('tgme_page_title')) return { found: false };
  const extract = (cls) => { const m = body.match(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)<`)); return m ? m[1].trim() : null; };
  const descMatch = body.match(/class="tgme_page_description"[^>]*>([\s\S]*?)<\/div>/);
  const imgMatch = body.match(/class="tgme_page_photo_image"[^>]*src="([^"]+)"/);
  return {
    found: true, display_name: extract('tgme_page_title'),
    description: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : null,
    avatar_url: imgMatch ? imgMatch[1] : null, profile_url: `https://t.me/${username}`,
  };
}

// ── Tumblr ────────────────────────────────────────────────────
async function enrichTumblr(username) {
  const r = await get(`https://${encodeURIComponent(username)}.tumblr.com`);
  if (r.status !== 200) return { found: false };
  const titleMatch = String(r.data || '').match(/<title>([^<]+)<\/title>/);
  return { found: true, title: titleMatch ? titleMatch[1].trim() : username, profile_url: `https://${username}.tumblr.com` };
}

// ── Duolingo ──────────────────────────────────────────────────
async function enrichDuolingo(username) {
  const r = await get(`https://www.duolingo.com/2017-06-30/users?username=${encodeURIComponent(username)}`);
  if (r.status !== 200 || !r.data?.users?.length) return { found: false };
  const d = r.data.users[0];
  if (!d || d.username.toLowerCase() !== username.toLowerCase()) return { found: false };
  return {
    found: true, username: d.username, display_name: d.name || null,
    bio: d.bio || null,
    avatar_url: d.picture ? `https://simg-ssl.duolingo.com/avatars/${d.id}/large` : null,
    streak: d.streak, total_xp: d.totalXp,
    languages: (d.courses || []).map(c => c.learningLanguage).filter(Boolean).slice(0, 5),
    joined: d.creationDate ? new Date(d.creationDate * 1000).toISOString() : null,
    account_age_days: d.creationDate ? Math.floor((Date.now() / 1000 - d.creationDate) / 86400) : null,
    profile_url: `https://www.duolingo.com/profile/${d.username}`,
  };
}

// ── Chess.com ─────────────────────────────────────────────────
async function enrichChessCom(username) {
  const lower = username.toLowerCase();
  const [uRes, statsRes] = await Promise.all([
    get(`https://api.chess.com/pub/player/${encodeURIComponent(lower)}`),
    safe(() => get(`https://api.chess.com/pub/player/${encodeURIComponent(lower)}/stats`)),
  ]);
  if (uRes.status !== 200 || !uRes.data?.username) return { found: false };
  const d = uRes.data;
  const stats = statsRes?.data || {};
  return {
    found: true, username: d.username, name: d.name || null, location: d.location || null,
    avatar_url: d.avatar || null,
    country: d.country ? d.country.split('/').pop() : null,
    followers: d.followers,
    joined: d.joined ? new Date(d.joined * 1000).toISOString() : null,
    account_age_days: d.joined ? Math.floor((Date.now() / 1000 - d.joined) / 86400) : null,
    last_online: d.last_online ? new Date(d.last_online * 1000).toISOString() : null,
    blitz_rating: stats.chess_blitz?.last?.rating || null,
    rapid_rating: stats.chess_rapid?.last?.rating || null,
    bullet_rating: stats.chess_bullet?.last?.rating || null,
    profile_url: d.url,
  };
}

// ── Lichess ───────────────────────────────────────────────────
async function enrichLichess(username) {
  const r = await get(`https://lichess.org/api/user/${encodeURIComponent(username)}`);
  if (r.status !== 200 || !r.data?.username) return { found: false };
  const d = r.data;
  return {
    found: true, username: d.username,
    real_name: d.profile?.realName || null,
    bio: d.profile?.bio || null,
    location: d.profile?.location || null,
    country: d.profile?.country || null,
    website: d.profile?.links || null,
    created_at: d.createdAt ? new Date(d.createdAt).toISOString() : null,
    account_age_days: d.createdAt ? Math.floor((Date.now() - d.createdAt) / 86400000) : null,
    last_seen: d.seenAt ? new Date(d.seenAt).toISOString() : null,
    online: d.online || false,
    rating_bullet: d.perfs?.bullet?.rating || null,
    rating_blitz: d.perfs?.blitz?.rating || null,
    rating_rapid: d.perfs?.rapid?.rating || null,
    profile_url: `https://lichess.org/@/${d.username}`,
  };
}

// ── HackerNews ────────────────────────────────────────────────
async function enrichHackerNews(username) {
  const r = await get(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(username)}.json`);
  if (r.status !== 200 || !r.data || typeof r.data !== 'object' || !r.data.id) return { found: false };
  const d = r.data;
  const about = d.about ? d.about.replace(/<[^>]+>/g, '').trim() : null;
  return {
    found: true, username: d.id,
    about, karma: d.karma,
    created_at: d.created ? new Date(d.created * 1000).toISOString() : null,
    account_age_days: d.created ? Math.floor((Date.now() / 1000 - d.created) / 86400) : null,
    submission_count: (d.submitted || []).length,
    profile_url: `https://news.ycombinator.com/user?id=${d.id}`,
  };
}

// ── Dev.to ────────────────────────────────────────────────────
async function enrichDevTo(username) {
  const r = await get(`https://dev.to/api/users/by_username?url=${encodeURIComponent(username)}`);
  if (r.status !== 200 || !r.data?.username) return { found: false };
  const d = r.data;
  return {
    found: true, username: d.username, name: d.name || null,
    bio: d.summary || null, location: d.location || null,
    github: d.github_username || null, twitter: d.twitter_username || null,
    website: d.website_url || null,
    avatar_url: d.profile_image || null,
    joined: d.joined_at || null,
    profile_url: `https://dev.to/${d.username}`,
  };
}

// ── Codeforces ────────────────────────────────────────────────
async function enrichCodeforces(username) {
  const r = await get(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(username)}`);
  if (r.status !== 200 || r.data?.status !== 'OK' || !r.data?.result?.length) return { found: false };
  const d = r.data.result[0];
  const name = [d.firstName, d.lastName].filter(Boolean).join(' ') || null;
  return {
    found: true, handle: d.handle, name,
    country: d.country || null, city: d.city || null,
    organization: d.organization || null,
    rank: d.rank || null, rating: d.rating || null,
    max_rank: d.maxRank || null, max_rating: d.maxRating || null,
    avatar_url: d.avatar || d.titlePhoto || null,
    created_at: d.registrationTimeSeconds ? new Date(d.registrationTimeSeconds * 1000).toISOString() : null,
    account_age_days: d.registrationTimeSeconds ? Math.floor((Date.now() / 1000 - d.registrationTimeSeconds) / 86400) : null,
    contribution: d.contribution,
    profile_url: `https://codeforces.com/profile/${d.handle}`,
  };
}

// ─────────────────────────────────────────────────────────────
// Phone enrichment
// ─────────────────────────────────────────────────────────────

async function enrichPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  let country = null, area = null, type = 'unknown';
  if (digits.startsWith('1') && digits.length === 11) { country = 'US/Canada'; area = digits.slice(1, 4); type = 'landline or mobile'; }
  else if (digits.startsWith('44')) country = 'United Kingdom';
  else if (digits.startsWith('61')) country = 'Australia';
  else if (digits.startsWith('49')) country = 'Germany';
  else if (digits.startsWith('33')) country = 'France';
  else if (digits.startsWith('55')) country = 'Brazil';
  else if (digits.startsWith('91')) country = 'India';
  const enc = encodeURIComponent(phone);
  return {
    type: 'phone', value: phone,
    data: {
      digits, parsed: { country, area_code: area, type },
      manual_checks: [
        { name: 'Truecaller',    description: 'Caller ID — often shows real name and spam reports', url: `https://www.truecaller.com/search/us/${digits}` },
        { name: 'NumLookup',     description: 'Carrier, line type, and owner lookup', url: `https://www.numlookup.com/?number=${enc}` },
        { name: 'Epieos',        description: 'Find accounts registered with this phone', url: `https://epieos.com/?q=${enc}&t=phone` },
        { name: 'Sync.me',       description: 'Crowdsourced caller ID database', url: `https://sync.me/search/?number=${enc}` },
        { name: 'Google Search', description: 'Direct number search — finds listings and mentions', url: `https://www.google.com/search?q="${enc}"` },
        { name: 'Spy Dialer',    description: 'Free reverse phone lookup', url: `https://www.spydialer.com/default.aspx?phone=${digits}` },
      ],
    },
    discovered: [],
  };
}

// ─────────────────────────────────────────────────────────────
// Discord enrichment — real lookup for numeric IDs
// ─────────────────────────────────────────────────────────────

async function enrichDiscord(value) {
  const isId = /^\d{15,20}$/.test(value.trim());

  if (isId) {
    const r = await safe(() => get(`https://discordlookup.mesalytic.moe/v1/user/${value.trim()}`));
    if (r && !r.error && r.status === 200 && r.data?.id) {
      const d = r.data;
      const avatarUrl = d.avatar?.id
        ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar.id}.${d.avatar.is_animated ? 'gif' : 'png'}?size=256`
        : null;
      const createdAt = d.created_at || (d.id ? new Date(Number(BigInt(d.id) >> 22n) + 1420070400000).toISOString() : null);
      return {
        type: 'discord', value,
        data: {
          kind: 'user_id', id: d.id,
          global_name: d.global_name || null,
          username: d.username || null,
          display_name: d.display_name || d.global_name || d.username || null,
          created_at: createdAt,
          avatar_url: avatarUrl,
          badges: (d.badges || []).map(b => b.name || b).filter(Boolean),
          manual_checks: [
            { name: 'Discord Profile', description: 'View profile page', url: `https://discord.com/users/${value}` },
            { name: 'discord.id',      description: 'User info lookup', url: `https://discord.id/?prefill=${value}` },
            { name: 'Lookup.guru',     description: 'User + mutual server lookup', url: `https://discord.lookup.guru/${value}` },
          ],
        },
        discovered: d.username ? [{ type: 'username', value: d.username, source: 'Discord user lookup' }] : [],
      };
    }
  }

  return {
    type: 'discord', value,
    data: {
      kind: isId ? 'user_id' : 'username',
      manual_checks: [
        { name: 'Discord Profile', description: isId ? 'Profile by user ID' : 'Profile by username', url: `https://discord.com/users/${value}` },
        { name: 'discord.id',      description: 'User info lookup tool', url: `https://discord.id/?prefill=${value}` },
        { name: 'Lookup.guru',     description: 'Discord user/server info', url: `https://discord.lookup.guru/${value}` },
      ],
    },
    discovered: isId ? [] : [{ type: 'username', value, source: 'Discord username' }],
  };
}

// ─────────────────────────────────────────────────────────────
// Master investigate function
// ─────────────────────────────────────────────────────────────

async function investigate(seeds) {
  const seen = new Set(seeds.map(s => `${s.type}:${s.value.toLowerCase()}`));
  const enrichSeed = async (seed) => {
    switch (seed.type) {
      case 'email':    return enrichEmail(seed.value);
      case 'username': return enrichUsername(seed.value);
      case 'phone':    return enrichPhone(seed.value);
      case 'discord':  return enrichDiscord(seed.value);
      default:         return { type: seed.type, value: seed.value, data: {}, discovered: [] };
    }
  };

  // First pass
  const seedResults = await pool(seeds, enrichSeed, 3);

  // Collect discovered identifiers
  const newSeeds = [];
  for (const r of seedResults) {
    for (const d of r.discovered || []) {
      const key = `${d.type}:${d.value.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); newSeeds.push({ type: d.type, value: d.value, source: d.source, url: d.url }); }
    }
  }
  // Username candidates from emails (top 3)
  for (const r of seedResults) {
    if (r.type === 'email' && r.data.username_candidates) {
      for (const u of r.data.username_candidates.slice(0, 3)) {
        const key = `username:${u.toLowerCase()}`;
        if (!seen.has(key)) { seen.add(key); newSeeds.push({ type: 'username', value: u, source: `${r.value} (email candidate)` }); }
      }
    }
  }

  // Second pass
  const discoveredResults = newSeeds.length > 0
    ? await pool(newSeeds, (s) => enrichSeed(s).then(r => ({ ...r, _source: s.source, _source_url: s.url })), 3)
    : [];

  const profile = buildProfile([...seedResults, ...discoveredResults]);
  return { seeds: seedResults, discovered: discoveredResults, profile, investigated_at: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────
// Profile aggregation
// ─────────────────────────────────────────────────────────────

function buildProfile(results) {
  const p = {
    possible_real_names: new Set(), possible_locations: new Set(),
    avatar_urls: [], all_usernames: new Set(), all_emails: new Set(),
    all_phones: new Set(), all_urls: new Set(),
    confirmed_platforms: [], linked_accounts: [], account_ages: [],
  };

  for (const r of results) {
    if (r.type === 'username' && r.data?.platforms) {
      for (const [plat, d] of Object.entries(r.data.platforms)) {
        if (!d.found) continue;
        p.confirmed_platforms.push({ platform: plat, username: r.value, profile_url: d.profile_url, avatar_url: d.avatar_url || null, data: d });
        const nameVal = d.name || d.full_name || d.real_name || d.display_name || d.persona_name;
        if (nameVal) p.possible_real_names.add(nameVal);
        const locVal = d.location || d.city || d.country;
        if (locVal) p.possible_locations.add(locVal);
        if (d.email)   p.all_emails.add(d.email);
        if (d.website) p.all_urls.add(d.website);
        if (d.avatar_url) p.avatar_urls.push({ platform: plat, url: d.avatar_url });
        const ageDay = d.account_age_days;
        const createdAt = d.created_at || d.joined || d.registration_time || d.member_since;
        if (createdAt) p.account_ages.push({ platform: plat, username: r.value, created_at: createdAt, age_days: ageDay });
        if (d.linked_accounts) {
          for (const la of d.linked_accounts) {
            if (la.state === 'verified') p.linked_accounts.push({ ...la, via: `Keybase (${r.value})` });
          }
        }
      }
    }
    if (r.type === 'email') {
      p.all_emails.add(r.value);
      const g = r.data?.gravatar;
      if (g?.found) {
        if (g.display_name) p.possible_real_names.add(g.display_name);
        if (g.location)     p.possible_locations.add(g.location);
        if (g.avatar_url)   p.avatar_urls.push({ platform: 'Gravatar', url: g.avatar_url });
        for (const u of g.urls || []) if (u.value) p.all_urls.add(u.value);
      }
      const km = r.data?.keybase_match;
      if (km?.found && km.username) p.all_usernames.add(km.username);
      const gm = r.data?.github_match;
      if (gm?.found && gm.login) p.all_usernames.add(gm.login);
    }
    if (r.type === 'phone') p.all_phones.add(r.value);
    if (r.type === 'username') p.all_usernames.add(r.value);
    if (r.type === 'discord' && r.data?.username) p.all_usernames.add(r.data.username);
    if (r.type === 'discord' && r.data?.avatar_url) p.avatar_urls.push({ platform: 'Discord', url: r.data.avatar_url });
    if (r.type === 'discord' && r.data?.display_name) p.possible_real_names.add(r.data.display_name);
  }

  return {
    possible_real_names: [...p.possible_real_names].filter(Boolean),
    possible_locations:  [...p.possible_locations].filter(Boolean),
    avatar_urls:         p.avatar_urls,
    all_usernames:       [...p.all_usernames],
    all_emails:          [...p.all_emails],
    all_phones:          [...p.all_phones],
    all_urls:            [...p.all_urls],
    confirmed_platforms: p.confirmed_platforms,
    linked_accounts:     p.linked_accounts,
    account_ages:        p.account_ages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  };
}

module.exports = { investigate, enrichEmail, enrichUsername, enrichPhone, enrichDiscord, emailToUsernameCandidates };
