// ============================================================
// OSINT Correlation Engine
// ============================================================
//
// Core idea: every identifier (email, username, phone) is a seed.
// When we enrich a seed we often discover new identifiers (a GitHub
// profile shows a public email; Keybase lists every verified social
// account). Those get fed back in as new seeds, so one starting
// point fans out into a complete profile automatically.
//
// Enrichment functions return structured data — not just links.
// Where the platform exposes a real API, we call it and extract
// actual values (name, location, linked accounts…). Login-walled
// platforms that can't be checked automatically get a clearly-labelled
// "manual check" link so nothing is falsely claimed.

const axios  = require('axios');
const crypto = require('crypto');

const UA      = 'Mozilla/5.0 (compatible; research-tool/1.0)';
const TIMEOUT = 9000;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function get(url, opts = {}) {
  return axios.get(url, { headers: { 'User-Agent': UA }, validateStatus: null, timeout: TIMEOUT, ...opts });
}

async function post(url, data, opts = {}) {
  return axios.post(url, data, { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, validateStatus: null, timeout: TIMEOUT, ...opts });
}

// Run an async fn, catch and return the error as a "failed" result.
async function safe(fn) {
  try { return await fn(); }
  catch (e) { return { found: false, error: e.message }; }
}

// Pool: run many async tasks with max `limit` concurrent.
async function pool(items, fn, limit = 5) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx], idx);
      }
    })
  );
  return results;
}

// ─────────────────────────────────────────────────────────────
// Username candidate extraction from email
// ─────────────────────────────────────────────────────────────
// e.g. "john.doe123@gmail.com" → ["johndoe123","john.doe123","johndoe","john","jdoe123"…]

function emailToUsernameCandidates(email) {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const candidates = new Set([local]);

  // Strip dots/underscores/hyphens
  candidates.add(local.replace(/[._-]/g, ''));

  // Split into parts
  const parts = local.split(/[._-]/);
  if (parts.length > 1) {
    candidates.add(parts[0]);                          // first part only
    candidates.add(parts.join(''));                    // joined
    candidates.add(parts[0] + parts[1]);               // first two
    candidates.add(parts[0][0] + parts.slice(1).join('')); // initial + rest
    if (parts.length >= 2) {
      candidates.add(parts[0] + '_' + parts[1]);
      candidates.add(parts[0] + '.' + parts[1]);
    }
  }

  // Handle numeric suffix separately
  const numMatch = local.match(/^([a-z._-]+?)(\d+)$/);
  if (numMatch) {
    const [, base, nums] = numMatch;
    const cleanBase = base.replace(/[._-]/g, '');
    candidates.add(cleanBase);
    candidates.add(cleanBase + nums);
    const baseParts = base.split(/[._-]/);
    if (baseParts.length > 1) {
      candidates.add(baseParts[0] + nums);
      candidates.add(baseParts[0]);
    }
  }

  return [...candidates].filter(u => u.length >= 3 && u.length <= 32);
}

// ─────────────────────────────────────────────────────────────
// Email enrichment
// ─────────────────────────────────────────────────────────────

async function enrichEmail(email) {
  const norm = email.trim().toLowerCase();
  const [local, domain] = norm.split('@');
  const hash = crypto.createHash('md5').update(norm).digest('hex');

  const [gravatar] = await Promise.all([checkGravatar(norm, hash)]);

  const isFreemail = /^(gmail|yahoo|hotmail|outlook|icloud|proton|protonmail|live|msn|aol|me|mac|googlemail|ymail|gmx|tutanota|fastmail)\./.test(domain);

  // New identifiers discovered from enrichment
  const discovered = [];
  if (gravatar.found) {
    if (gravatar.username) discovered.push({ type: 'username', value: gravatar.username, source: 'Gravatar' });
    for (const acct of gravatar.accounts || []) {
      if (acct.username) discovered.push({ type: 'username', value: acct.username, source: `Gravatar → ${acct.service}`, url: acct.url });
    }
  }

  const usernameCandidates = emailToUsernameCandidates(norm);

  return {
    type: 'email',
    value: norm,
    data: {
      local,
      domain,
      domain_type: isFreemail ? 'free provider' : 'custom domain',
      hash_md5: hash,
      gravatar,
      username_candidates: usernameCandidates,
      manual_checks: [
        { name: 'Have I Been Pwned', description: 'Data breach check', url: `https://haveibeenpwned.com/account/${encodeURIComponent(norm)}` },
        { name: 'Epieos', description: 'Find accounts registered to this email', url: `https://epieos.com/?q=${encodeURIComponent(norm)}&t=email` },
        { name: 'Hunter.io', description: 'Email verification & company link', url: `https://hunter.io/email-verifier/${encodeURIComponent(norm)}` },
        ...(!isFreemail ? [{ name: 'WHOIS (domain)', description: `Who registered ${domain}?`, url: `https://www.whois.com/whois/${domain}` }] : []),
      ],
    },
    discovered,
  };
}

async function checkGravatar(email, hash) {
  const r = await safe(() => get(`https://www.gravatar.com/${hash}.json`));
  if (!r.found && r.error) return { found: false };
  if (r.status === 200 && r.data && r.data.entry && r.data.entry[0]) {
    const e = r.data.entry[0];
    return {
      found: true,
      display_name: e.displayName || e.preferredUsername || null,
      username: e.preferredUsername || null,
      about: e.aboutMe || null,
      location: (e.currentLocation) || null,
      profile_url: e.profileUrl || `https://gravatar.com/${hash}`,
      avatar_url: e.thumbnailUrl || `https://www.gravatar.com/avatar/${hash}?s=200`,
      accounts: (e.accounts || []).map(a => ({ service: a.shortname, username: a.username, url: a.url })),
      urls: (e.urls || []).map(u => ({ title: u.title, value: u.value })),
    };
  }
  return { found: false };
}

// ─────────────────────────────────────────────────────────────
// Username enrichment — calls each platform's API for real data
// ─────────────────────────────────────────────────────────────

async function enrichUsername(username) {
  const checks = await pool([
    { name: 'GitHub',   fn: () => enrichGitHub(username) },
    { name: 'Reddit',   fn: () => enrichReddit(username) },
    { name: 'Keybase',  fn: () => enrichKeybase(username) },
    { name: 'Roblox',   fn: () => enrichRoblox(username) },
    { name: 'GitLab',   fn: () => enrichGitLab(username) },
    { name: 'Steam',    fn: () => enrichSteam(username) },
    { name: 'Telegram', fn: () => enrichTelegram(username) },
    { name: 'Tumblr',   fn: () => enrichTumblr(username) },
  ], ({ fn }) => safe(fn), 4);

  const byName = {};
  ['GitHub','Reddit','Keybase','Roblox','GitLab','Steam','Telegram','Tumblr']
    .forEach((n, i) => { byName[n] = checks[i]; });

  // Collect new identifiers discovered from the enriched data
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
      if (acct.username && acct.state === 'verified') {
        discovered.push({ type: 'username', value: acct.username, source: `Keybase → ${acct.service} (verified)`, url: acct.url });
      }
    }
    if (kb.website) discovered.push({ type: 'url', value: kb.website, source: 'Keybase website' });
  }

  const manual = [
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
  ];

  return {
    type: 'username',
    value: username,
    data: { platforms: byName, manual_checks: manual },
    discovered,
  };
}

async function enrichGitHub(username) {
  const r = await get(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
  });
  if (r.status !== 200) return { found: false, status: r.status };
  const d = r.data;
  return {
    found: true,
    id: d.id,
    login: d.login,
    name: d.name || null,
    bio: d.bio || null,
    location: d.location || null,
    email: d.email || null,
    website: d.blog || null,
    company: d.company || null,
    twitter: d.twitter_username || null,
    followers: d.followers,
    following: d.following,
    public_repos: d.public_repos,
    created_at: d.created_at,
    updated_at: d.updated_at,
    avatar_url: d.avatar_url,
    profile_url: d.html_url,
  };
}

async function enrichReddit(username) {
  const r = await get(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`);
  if (r.status !== 200 || !r.data || r.data.error) return { found: false, status: r.status };
  const d = r.data.data;
  return {
    found: true,
    id: d.id,
    name: d.name,
    total_karma: d.total_karma,
    link_karma: d.link_karma,
    comment_karma: d.comment_karma,
    created_at: new Date(d.created_utc * 1000).toISOString(),
    account_age_days: Math.floor((Date.now() / 1000 - d.created_utc) / 86400),
    is_gold: d.is_gold,
    is_mod: d.is_mod,
    avatar_url: d.icon_img ? d.icon_img.split('?')[0] : null,
    profile_url: `https://www.reddit.com/user/${d.name}`,
    subreddits_url: `https://www.reddit.com/user/${d.name}/submitted`,
  };
}

async function enrichKeybase(username) {
  const r = await get(`https://keybase.io/_/api/1.0/user/lookup.json?usernames=${encodeURIComponent(username)}`);
  if (r.status !== 200 || !r.data || r.data.status?.code !== 0 || !r.data.them?.[0]) return { found: false };
  const u = r.data.them[0];
  if (!u) return { found: false };
  const proofs = u.proofs_summary?.all || [];
  return {
    found: true,
    username: u.basics?.username,
    full_name: u.profile?.full_name || null,
    location: u.profile?.location || null,
    bio: u.profile?.bio || null,
    website: u.profile?.website || null,
    avatar_url: u.pictures?.primary?.url || null,
    profile_url: `https://keybase.io/${u.basics?.username}`,
    // Keybase's killer feature: cryptographically verified linked accounts
    linked_accounts: proofs.map(p => ({
      service: p.proof_type,
      username: p.nametag,
      url: p.service_url,
      state: p.state === 1 ? 'verified' : 'unverified',
      proof_url: p.proof_url,
    })),
  };
}

async function enrichRoblox(username) {
  const r1 = await post('https://users.roblox.com/v1/usernames/users', { usernames: [username], excludeBannedUsers: false });
  if (r1.status !== 200 || !r1.data?.data?.length) return { found: false };
  const uid = r1.data.data[0].id;
  const r2 = await get(`https://users.roblox.com/v1/users/${uid}`);
  if (r2.status !== 200) return { found: false };
  const d = r2.data;
  return {
    found: true,
    id: d.id,
    username: d.name,
    display_name: d.displayName,
    description: d.description || null,
    created_at: d.created,
    account_age_days: Math.floor((Date.now() - new Date(d.created).getTime()) / 86400000),
    is_banned: d.isBanned,
    profile_url: `https://www.roblox.com/users/${d.id}/profile`,
    avatar_url: `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${d.id}&size=420x420&format=Png`,
  };
}

async function enrichGitLab(username) {
  const r = await get(`https://gitlab.com/api/v4/users?username=${encodeURIComponent(username)}`);
  if (r.status !== 200 || !Array.isArray(r.data) || !r.data.length) return { found: false };
  const d = r.data[0];
  return {
    found: true,
    id: d.id,
    username: d.username,
    name: d.name || null,
    bio: d.bio || null,
    location: d.location || null,
    website: d.website_url || null,
    created_at: d.created_at,
    avatar_url: d.avatar_url,
    profile_url: d.web_url,
  };
}

async function enrichSteam(username) {
  const r = await get(`https://steamcommunity.com/id/${encodeURIComponent(username)}/?xml=1`);
  const body = String(r.data || '');
  if (r.status !== 200 || !body.includes('<steamID64>')) return { found: false };
  const extract = (tag) => { const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null; };
  return {
    found: true,
    steam_id64: extract('steamID64'),
    custom_url: extract('customURL'),
    persona_name: extract('steamID'),
    real_name: extract('realname'),
    location: extract('location'),
    summary: extract('summary'),
    avatar_url: extract('avatarFull'),
    member_since: extract('memberSince'),
    vac_bans: extract('vacBanned') === '1',
    profile_url: `https://steamcommunity.com/id/${username}`,
    visibility: extract('privacyState'),
  };
}

async function enrichTelegram(username) {
  const r = await get(`https://t.me/${encodeURIComponent(username)}`);
  const body = String(r.data || '');
  if (r.status !== 200 || !body.includes('tgme_page_title')) return { found: false };
  const extract = (cls) => { const m = body.match(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)<`)); return m ? m[1].trim() : null; };
  const descMatch = body.match(/class="tgme_page_description"[^>]*>([\s\S]*?)<\/div>/);
  const imgMatch = body.match(/class="tgme_page_photo_image"[^>]*src="([^"]+)"/);
  return {
    found: true,
    display_name: extract('tgme_page_title'),
    description: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : null,
    avatar_url: imgMatch ? imgMatch[1] : null,
    profile_url: `https://t.me/${username}`,
  };
}

async function enrichTumblr(username) {
  const r = await get(`https://${encodeURIComponent(username)}.tumblr.com`);
  if (r.status !== 200) return { found: false };
  const body = String(r.data || '');
  const titleMatch = body.match(/<title>([^<]+)<\/title>/);
  return {
    found: true,
    title: titleMatch ? titleMatch[1].trim() : username,
    profile_url: `https://${username}.tumblr.com`,
  };
}

// ─────────────────────────────────────────────────────────────
// Phone enrichment
// ─────────────────────────────────────────────────────────────

async function enrichPhone(phone) {
  const digits = phone.replace(/\D/g, '');

  // Parse basic structure
  let country = null, area = null, type = 'unknown';
  if (digits.startsWith('1') && digits.length === 11) {
    country = 'US/Canada'; area = digits.slice(1, 4); type = 'landline or mobile';
  } else if (digits.startsWith('44')) {
    country = 'United Kingdom';
  } else if (digits.startsWith('61')) {
    country = 'Australia';
  } else if (digits.startsWith('49')) {
    country = 'Germany';
  } else if (digits.startsWith('33')) {
    country = 'France';
  }

  const enc = encodeURIComponent(phone);
  return {
    type: 'phone',
    value: phone,
    data: {
      digits,
      parsed: { country, area_code: area, type },
      manual_checks: [
        { name: 'Truecaller',    description: 'Caller ID / spam database, may show real name', url: `https://www.truecaller.com/search/us/${digits}` },
        { name: 'NumLookup',     description: 'Carrier and line-type lookup', url: `https://www.numlookup.com/?number=${enc}` },
        { name: 'Epieos',        description: 'Find accounts registered with this phone', url: `https://epieos.com/?q=${enc}&t=phone` },
        { name: 'Google Search', description: 'Direct number search', url: `https://www.google.com/search?q="${enc}"` },
        { name: 'Sync.me',       description: 'Crowdsourced caller ID', url: `https://sync.me/search/?number=${enc}` },
      ],
    },
    discovered: [],
  };
}

// ─────────────────────────────────────────────────────────────
// Discord enrichment
// ─────────────────────────────────────────────────────────────

async function enrichDiscord(value, kind = 'username') {
  const enc = encodeURIComponent(value);
  // Discord's user lookup requires auth, so we provide manual check links
  // plus check if the value is a numeric ID (more reliable)
  const isId = /^\d{15,20}$/.test(value);

  return {
    type: 'discord',
    value,
    data: {
      kind: isId ? 'user_id' : 'username',
      manual_checks: [
        { name: 'Discord Profile', description: isId ? 'Direct profile by user ID' : 'Profile by username', url: `https://discord.com/users/${value}` },
        { name: 'Discord.id',      description: 'User info lookup tool', url: `https://discord.id/?prefill=${value}` },
        { name: 'Lookup.guru',     description: 'Discord user/server info', url: `https://discord.lookup.guru/${value}` },
        ...(isId ? [{ name: 'Discord API (public)', description: 'Raw user object (requires login to see)', url: `https://discordapp.com/api/users/${value}` }] : []),
      ],
    },
    discovered: isId ? [] : [{ type: 'username', value, source: 'Discord username' }],
  };
}

// ─────────────────────────────────────────────────────────────
// Master investigate function
// ─────────────────────────────────────────────────────────────
//
// Takes a list of seeds: [{ type: 'email'|'username'|'phone'|'discord', value }]
// Enriches each, collects discovered identifiers, enriches those too (one level).
// Returns { seeds: enriched[], discovered: enriched[], profile: aggregated }

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

  // First pass: enrich all provided seeds
  const seedResults = await pool(seeds, enrichSeed, 3);

  // Collect discovered identifiers from first pass
  const newSeeds = [];
  for (const r of seedResults) {
    for (const d of r.discovered || []) {
      const key = `${d.type}:${d.value.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); newSeeds.push({ type: d.type, value: d.value, source: d.source, url: d.url }); }
    }
  }

  // Also enrich username candidates from any emails (limited to top 3 to avoid spam)
  for (const r of seedResults) {
    if (r.type === 'email' && r.data.username_candidates) {
      for (const u of r.data.username_candidates.slice(0, 3)) {
        const key = `username:${u.toLowerCase()}`;
        if (!seen.has(key)) { seen.add(key); newSeeds.push({ type: 'username', value: u, source: `${r.value} (email candidate)` }); }
      }
    }
  }

  // Second pass: enrich newly discovered identifiers
  const discoveredResults = newSeeds.length > 0
    ? await pool(newSeeds, (s) => enrichSeed(s).then(r => ({ ...r, _source: s.source, _source_url: s.url })), 3)
    : [];

  // Build an aggregated profile from all results
  const profile = buildProfile([...seedResults, ...discoveredResults]);

  return { seeds: seedResults, discovered: discoveredResults, profile, investigated_at: new Date().toISOString() };
}

// Aggregate everything into a single suspect profile object
function buildProfile(results) {
  const profile = {
    possible_real_names: new Set(),
    possible_locations:  new Set(),
    avatar_urls:         [],
    all_usernames:       new Set(),
    all_emails:          new Set(),
    all_phones:          new Set(),
    all_urls:            new Set(),
    confirmed_platforms: [],
    linked_accounts:     [],
    account_ages:        [],
  };

  for (const r of results) {
    if (r.type === 'username' && r.data.platforms) {
      for (const [plat, d] of Object.entries(r.data.platforms)) {
        if (!d.found) continue;
        profile.confirmed_platforms.push({ platform: plat, username: r.value, profile_url: d.profile_url, avatar_url: d.avatar_url || null });
        if (d.name)         profile.possible_real_names.add(d.name);
        if (d.full_name)    profile.possible_real_names.add(d.full_name);
        if (d.real_name)    profile.possible_real_names.add(d.real_name);
        if (d.persona_name) profile.all_usernames.add(d.persona_name);
        if (d.location)     profile.possible_locations.add(d.location);
        if (d.email)        profile.all_emails.add(d.email);
        if (d.website)      profile.all_urls.add(d.website);
        if (d.avatar_url)   profile.avatar_urls.push({ platform: plat, url: d.avatar_url });
        if (d.created_at)   profile.account_ages.push({ platform: plat, created_at: d.created_at, age_days: d.account_age_days });
        if (d.linked_accounts) {
          for (const la of d.linked_accounts) {
            if (la.state === 'verified') profile.linked_accounts.push({ ...la, via: `Keybase (${r.value})` });
          }
        }
      }
    }
    if (r.type === 'email' && r.data.gravatar?.found) {
      const g = r.data.gravatar;
      if (g.display_name) profile.possible_real_names.add(g.display_name);
      if (g.location)     profile.possible_locations.add(g.location);
      if (g.avatar_url)   profile.avatar_urls.push({ platform: 'Gravatar', url: g.avatar_url });
      for (const u of g.urls || []) profile.all_urls.add(u.value);
    }
    if (r.type === 'email') profile.all_emails.add(r.value);
    if (r.type === 'phone') profile.all_phones.add(r.value);
    if (r.type === 'username') profile.all_usernames.add(r.value);
  }

  return {
    possible_real_names: [...profile.possible_real_names].filter(Boolean),
    possible_locations:  [...profile.possible_locations].filter(Boolean),
    avatar_urls:         profile.avatar_urls,
    all_usernames:       [...profile.all_usernames],
    all_emails:          [...profile.all_emails],
    all_phones:          [...profile.all_phones],
    all_urls:            [...profile.all_urls],
    confirmed_platforms: profile.confirmed_platforms,
    linked_accounts:     profile.linked_accounts,
    account_ages:        profile.account_ages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  };
}

module.exports = { investigate, enrichEmail, enrichUsername, enrichPhone, enrichDiscord, emailToUsernameCandidates };
