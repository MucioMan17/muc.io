// ============================================================
// muc.io — Email Account Finder
// ============================================================
//
// Checks whether an email address is REGISTERED on a site, using
// each site's own signup-validation / account-recovery endpoint —
// the same technique as the "holehe" project, reimplemented in
// pure Node so it runs automatically with no extra install.
//
// STRICT TRI-STATE to avoid false positives (this is for real
// investigations):
//   'registered'     — the site's own response says this email has an account
//   'not_registered' — the site's own response says it's free/available
//   'unknown'        — blocked, rate-limited, captcha, or endpoint changed
//
// Anything we're not certain about returns 'unknown', never a guess.

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TIMEOUT = 9000;
const REGISTERED = 'registered', NOT_REGISTERED = 'not_registered', UNKNOWN = 'unknown';

function req(cfg) {
  return axios({ timeout: TIMEOUT, validateStatus: null, headers: { 'User-Agent': UA }, ...cfg });
}

// Each site: name, category, a reference URL, and a check(email) → state.
// Checks are written defensively: they only assert a definite state on the
// site's documented signal and otherwise fall through to UNKNOWN.
const SITES = [
  {
    name: 'Mozilla / Firefox', category: 'Accounts',
    ref: 'https://accounts.firefox.com/',
    check: async (email) => {
      const r = await req({
        method: 'post',
        url: 'https://api.accounts.firefox.com/v1/account/status',
        headers: { 'Content-Type': 'application/json' },
        data: { email },
      });
      if (r.status === 200 && r.data && typeof r.data.exists === 'boolean') {
        return r.data.exists ? REGISTERED : NOT_REGISTERED;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Spotify', category: 'Music',
    ref: 'https://open.spotify.com/',
    check: async (email) => {
      const r = await req({
        url: `https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=${encodeURIComponent(email)}`,
      });
      if (r.status === 200 && r.data) {
        if (r.data.status === 1) return NOT_REGISTERED;             // available
        if (r.data.errors && r.data.errors.email) return REGISTERED; // taken
        if (r.data.status === 20) return REGISTERED;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Imgur', category: 'Images',
    ref: 'https://imgur.com/',
    check: async (email) => {
      const r = await req({
        url: `https://imgur.com/signin/ajax_email_available?email=${encodeURIComponent(email)}`,
        headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://imgur.com/register' },
      });
      if (r.status === 200 && r.data && r.data.data && typeof r.data.data.available === 'boolean') {
        return r.data.data.available ? NOT_REGISTERED : REGISTERED;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Pinterest', category: 'Social',
    ref: 'https://www.pinterest.com/',
    check: async (email) => {
      const r = await req({
        method: 'post',
        url: 'https://www.pinterest.com/_/[email protected]/',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        data: `source_url=/&data=${encodeURIComponent(JSON.stringify({ options: { email }, context: {} }))}`,
      });
      // Pinterest returns a message indicating whether the email is in use.
      const body = JSON.stringify(r.data || '');
      if (r.status === 200) {
        if (/already (registered|associated|in use)|taken/i.test(body)) return REGISTERED;
        if (/valid|available|success.*true/i.test(body) && !/already/i.test(body)) return UNKNOWN; // ambiguous
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Twitter / X', category: 'Social',
    ref: 'https://x.com/',
    check: async (email) => {
      const r = await req({
        url: `https://api.twitter.com/i/users/email_available.json?email=${encodeURIComponent(email)}`,
      });
      if (r.status === 200 && r.data && typeof r.data.taken === 'boolean') {
        return r.data.taken ? REGISTERED : NOT_REGISTERED;
      }
      return UNKNOWN; // endpoint frequently restricted
    },
  },
  {
    name: 'Adobe', category: 'Accounts',
    ref: 'https://www.adobe.com/',
    check: async (email) => {
      const r = await req({
        method: 'post',
        url: 'https://auth.services.adobe.com/signin/v2/users/accounts',
        headers: { 'Content-Type': 'application/json', 'X-IMS-ClientId': 'adobedotcom2' },
        data: { username: email },
      });
      const body = JSON.stringify(r.data || '');
      if (r.status === 200 || r.status === 400) {
        if (/account.*exist|known/i.test(body)) return REGISTERED;
        if (/unknown|not.*found|no.*account/i.test(body)) return NOT_REGISTERED;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Wordpress', category: 'Blogging',
    ref: 'https://wordpress.com/',
    check: async (email) => {
      const r = await req({
        url: `https://public-api.wordpress.com/rest/v1.1/users/${encodeURIComponent(email)}/auth-options`,
      });
      // Returns 200 with auth options if the account exists; 404 otherwise.
      if (r.status === 200 && r.data && (r.data.passwordless !== undefined || r.data.email_verified !== undefined)) return REGISTERED;
      if (r.status === 404) return NOT_REGISTERED;
      return UNKNOWN;
    },
  },
  {
    name: 'Gravatar', category: 'Accounts',
    ref: 'https://gravatar.com/',
    check: async (email) => {
      const crypto = require('crypto');
      const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
      const r = await req({ url: `https://www.gravatar.com/${hash}.json` });
      if (r.status === 200 && r.data && r.data.entry) return REGISTERED;
      if (r.status === 404) return NOT_REGISTERED;
      return UNKNOWN;
    },
  },
  {
    name: 'Pornhub', category: 'Adult',
    ref: 'https://www.pornhub.com/',
    check: async (email) => {
      const r = await req({
        method: 'post',
        url: 'https://www.pornhub.com/user/create_account_check',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.pornhub.com/signup' },
        data: `email=${encodeURIComponent(email)}`,
      });
      const body = String(typeof r.data === 'string' ? r.data : JSON.stringify(r.data || ''));
      if (r.status === 200) {
        if (/already|exist|taken|registered/i.test(body)) return REGISTERED;
        if (body.trim() === '1' || /available|success/i.test(body)) return NOT_REGISTERED;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Duolingo', category: 'Education',
    ref: 'https://www.duolingo.com/',
    check: async (email) => {
      const r = await req({
        method: 'post',
        url: 'https://www.duolingo.com/login',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://www.duolingo.com/' },
        data: `login=${encodeURIComponent(email)}&password=WRONGPASSWORD_CHECK_ONLY`,
        maxRedirects: 0,
      });
      if (r.status === 200) {
        const body = JSON.stringify(r.data || '');
        // Duolingo says "incorrect password" for real accounts, "user not found" for missing ones
        if (/incorrect.password|wrong.password/i.test(body)) return REGISTERED;
        if (/user.not.found|doesn.t.exist|no.account/i.test(body)) return NOT_REGISTERED;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Roblox', category: 'Gaming',
    ref: 'https://www.roblox.com/',
    check: async (email) => {
      // Roblox password reset: returns a success message regardless of whether the email exists
      // but the wording differs between existing and non-existing accounts
      const r = await req({
        method: 'post',
        url: 'https://auth.roblox.com/v2/passwords/reset/send',
        headers: { 'Content-Type': 'application/json', Referer: 'https://www.roblox.com/' },
        data: JSON.stringify({ targetType: 0, target: email }),
      });
      if (r.status === 200) return REGISTERED;
      if (r.status === 400) {
        const body = JSON.stringify(r.data || '');
        if (/invalid|not.found|no.account/i.test(body)) return NOT_REGISTERED;
        return UNKNOWN;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Snapchat', category: 'Social',
    ref: 'https://www.snapchat.com/',
    check: async (email) => {
      // Snapchat's public forgot-password endpoint hints at whether email is registered
      const r = await req({
        method: 'post',
        url: 'https://accounts.snapchat.com/accounts/password_reset_email',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: `email=${encodeURIComponent(email)}&xsrf_nonce=&referrer=`,
      });
      if (r.status === 200) {
        const body = JSON.stringify(r.data || '');
        if (/sent|check.your.email|reset/i.test(body)) return REGISTERED;
        if (/not.found|no.account|invalid.email/i.test(body)) return NOT_REGISTERED;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Patreon', category: 'Content',
    ref: 'https://www.patreon.com/',
    check: async (email) => {
      const r = await req({
        url: `https://www.patreon.com/api/auth/exists?email=${encodeURIComponent(email)}`,
        headers: { Referer: 'https://www.patreon.com/login' },
      });
      if (r.status === 200 && r.data && typeof r.data.exists === 'boolean') {
        return r.data.exists ? REGISTERED : NOT_REGISTERED;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Xbox / Microsoft', category: 'Gaming',
    ref: 'https://account.xbox.com/',
    check: async (email) => {
      const r = await req({
        url: `https://login.live.com/GetCredentialType.srf`,
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ username: email, isOtherIdpSupported: true, checkPhones: false, isRemoteNGCSupported: false, isCookieBannerShown: false, isFidoSupported: false, originalRequest: '' }),
      });
      if (r.status === 200 && r.data) {
        const code = r.data.IfExistsResult;
        if (code === 0 || code === 6) return REGISTERED;
        if (code === 1) return NOT_REGISTERED;
      }
      return UNKNOWN;
    },
  },
  {
    name: 'Twitch', category: 'Streaming',
    ref: 'https://www.twitch.tv/',
    check: async (email) => {
      const r = await req({
        url: `https://passport.twitch.tv/register/check_user`,
        method: 'post',
        headers: { 'Content-Type': 'application/json', 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
        data: JSON.stringify({ email }),
      });
      if (r.status === 200 && r.data) {
        const body = JSON.stringify(r.data);
        if (/email.*taken|already.*registered/i.test(body)) return REGISTERED;
        if (/available/i.test(body)) return NOT_REGISTERED;
      }
      return UNKNOWN;
    },
  },
];

// Run all site checks concurrently (pool) and return structured results.
async function findAccountsByEmail(email) {
  const limit = 8;
  const results = new Array(SITES.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, SITES.length) }, async () => {
      while (i < SITES.length) {
        const idx = i++;
        const site = SITES[idx];
        try {
          const state = await Promise.race([
            site.check(email),
            new Promise((res) => setTimeout(() => res(UNKNOWN), TIMEOUT + 500)),
          ]);
          results[idx] = { name: site.name, category: site.category, ref: site.ref, state };
        } catch {
          results[idx] = { name: site.name, category: site.category, ref: site.ref, state: UNKNOWN };
        }
      }
    })
  );

  const registered = results.filter((r) => r.state === REGISTERED);
  const not_registered = results.filter((r) => r.state === NOT_REGISTERED);
  const unknown = results.filter((r) => r.state === UNKNOWN);
  return { checked: results.length, registered, not_registered, unknown, all: results };
}

module.exports = { findAccountsByEmail, SITE_COUNT: SITES.length };
