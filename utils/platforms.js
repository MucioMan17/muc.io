const axios = require('axios');

// Platform definitions: each has a URL template and a method to detect if profile exists.
// We use HEAD or GET requests to public profile URLs (no auth required).
// Status 200 = found, 404 = not found, other = unknown/private.
const PLATFORMS = [
  {
    name: 'Reddit',
    url: (u) => `https://www.reddit.com/user/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://www.reddit.com/user/${u}/about.json`, {
        headers: { 'User-Agent': 'OSINT-Dashboard/1.0' },
        validateStatus: null,
      });
      return r.status === 200 && !r.data.error;
    },
  },
  {
    name: 'GitHub',
    url: (u) => `https://github.com/${u}`,
    check: async (u) => {
      const r = await axios.head(`https://github.com/${u}`, { validateStatus: null });
      return r.status === 200;
    },
  },
  {
    name: 'Twitter / X',
    url: (u) => `https://x.com/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://x.com/${u}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      // X returns 200 even for non-existent accounts sometimes; look for 404 signal
      return r.status === 200 && !String(r.data).includes('This account doesn’t exist');
    },
  },
  {
    name: 'Instagram',
    url: (u) => `https://www.instagram.com/${u}/`,
    check: async (u) => {
      const r = await axios.get(`https://www.instagram.com/${u}/?__a=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200;
    },
  },
  {
    name: 'TikTok',
    url: (u) => `https://www.tiktok.com/@${u}`,
    check: async (u) => {
      const r = await axios.get(`https://www.tiktok.com/@${u}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200 && !String(r.data).includes("couldn't find this account");
    },
  },
  {
    name: 'YouTube',
    url: (u) => `https://www.youtube.com/@${u}`,
    check: async (u) => {
      const r = await axios.get(`https://www.youtube.com/@${u}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200 && !String(r.data).includes('404 Not Found');
    },
  },
  {
    name: 'Twitch',
    url: (u) => `https://www.twitch.tv/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://www.twitch.tv/${u}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200 && !String(r.data).includes('Sorry. Unless you');
    },
  },
  {
    name: 'Pinterest',
    url: (u) => `https://www.pinterest.com/${u}/`,
    check: async (u) => {
      const r = await axios.get(`https://www.pinterest.com/${u}/`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200;
    },
  },
  {
    name: 'Tumblr',
    url: (u) => `https://${u}.tumblr.com`,
    check: async (u) => {
      const r = await axios.get(`https://${u}.tumblr.com`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200;
    },
  },
  {
    name: 'Steam',
    url: (u) => `https://steamcommunity.com/id/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://steamcommunity.com/id/${u}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200 && !String(r.data).includes('The specified profile could not be found');
    },
  },
  {
    name: 'Roblox',
    url: (u) => `https://www.roblox.com/user.aspx?username=${u}`,
    check: async (u) => {
      const r = await axios.get(
        `https://users.roblox.com/v1/usernames/users`,
        {
          method: 'POST',
          data: { usernames: [u], excludeBannedUsers: false },
          headers: { 'Content-Type': 'application/json' },
          validateStatus: null,
        }
      );
      return r.status === 200 && r.data?.data?.length > 0;
    },
  },
  {
    name: 'Telegram',
    url: (u) => `https://t.me/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://t.me/${u}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200 && !String(r.data).includes('If you have Telegram, you can contact');
    },
  },
  {
    name: 'LinkedIn',
    url: (u) => `https://www.linkedin.com/in/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://www.linkedin.com/in/${u}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200;
    },
  },
  {
    name: 'Snapchat',
    url: (u) => `https://www.snapchat.com/add/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://www.snapchat.com/add/${u}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200 && !String(r.data).includes('Page Not Found');
    },
  },
  {
    name: 'Facebook',
    url: (u) => `https://www.facebook.com/${u}`,
    check: async (u) => {
      const r = await axios.get(`https://www.facebook.com/${u}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: null,
      });
      return r.status === 200 && !String(r.data).includes('Page Not Found');
    },
  },
];

async function checkPlatform(platform, username) {
  try {
    const found = await Promise.race([
      platform.check(username),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    return {
      platform: platform.name,
      found,
      url: found ? platform.url(username) : null,
      status: found ? 'FOUND' : 'NOT FOUND',
    };
  } catch (err) {
    return {
      platform: platform.name,
      found: false,
      url: null,
      status: err.message === 'timeout' ? 'TIMEOUT' : 'ERROR',
    };
  }
}

async function lookupUsername(username) {
  const results = await Promise.all(PLATFORMS.map((p) => checkPlatform(p, username)));
  return results;
}

module.exports = { lookupUsername, PLATFORMS };
