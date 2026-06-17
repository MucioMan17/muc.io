// ============================================================
// muc.io — Ultimate Lookup — single-page frontend
// ============================================================

// ---- Seed state ----
const seeds = [];                              // [{ type, value }]
const TYPES = ['username', 'email', 'phone', 'discord'];
const TYPE_LABEL = { username: 'Username', email: 'Email', phone: 'Phone', discord: 'Discord' };
const TYPE_ICON  = { username: '\u{1F464}', email: '✉️', phone: '\u{1F4DE}', discord: '\u{1F3AE}' };

let lastResult = null;                         // most recent investigation (for report export)

// Best-guess at what kind of identifier the user typed.
function detectType(raw) {
  const v = raw.trim();
  if (/^\S+@\S+\.\S+$/.test(v)) return 'email';
  if (/discord\.gg\//i.test(v) || /discord\.com\/invite\//i.test(v)) return 'discord'; // invite URL
  if (/^\d{17,20}$/.test(v)) return 'discord';            // Discord snowflake ID
  if (/^.+#\d{4}$/.test(v)) return 'discord';             // legacy name#1234
  const digits = v.replace(/\D/g, '');
  if (/^[+(]?[\d\s().\-]{7,}$/.test(v) && digits.length >= 7 && digits.length <= 15) return 'phone';
  return 'username';
}

const seedInput    = document.getElementById('seed-input');
const detectedHint = document.getElementById('detected-hint');

// Live "detected as ..." hint while typing.
seedInput.addEventListener('input', () => {
  const v = seedInput.value.trim();
  if (!v) { detectedHint.innerHTML = '&nbsp;'; return; }
  const t = detectType(v);
  detectedHint.innerHTML = `Detected as <strong>${TYPE_ICON[t]} ${TYPE_LABEL[t]}</strong> &mdash; press Enter to add`;
});

seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
});
document.getElementById('add-seed').addEventListener('click', addFromInput);

function addFromInput() {
  const raw = seedInput.value.trim();
  if (!raw) return;
  // Allow pasting several identifiers at once (comma / newline separated).
  raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).forEach((val) => {
    if (!seeds.some((s) => s.value.toLowerCase() === val.toLowerCase())) {
      seeds.push({ type: detectType(val), value: val });
    }
  });
  seedInput.value = '';
  detectedHint.innerHTML = '&nbsp;';
  renderChips();
  seedInput.focus();
}

function renderChips() {
  const wrap = document.getElementById('seed-chips');
  wrap.innerHTML = seeds.map((s, i) => `
    <span class="seed-chip">
      <button class="chip-type" title="Wrong type? Click to change" onclick="cycleType(${i})">${TYPE_ICON[s.type]} ${TYPE_LABEL[s.type]}</button>
      <span class="chip-val">${esc(s.value)}</span>
      <button class="chip-remove" title="Remove" onclick="removeSeed(${i})">&times;</button>
    </span>`).join('');
}

function cycleType(i) {
  const cur = TYPES.indexOf(seeds[i].type);
  seeds[i].type = TYPES[(cur + 1) % TYPES.length];
  renderChips();
}
function removeSeed(i) { seeds.splice(i, 1); renderChips(); }

// ---- Run the investigation ----
document.getElementById('run-investigate').addEventListener('click', async () => {
  // If the user typed something but didn't press Add, don't lose it.
  if (seedInput.value.trim()) addFromInput();
  if (!seeds.length) { showToast('Add at least one identifier first.'); seedInput.focus(); return; }

  const spinner = document.getElementById('investigate-spinner');
  const results = document.getElementById('investigate-results');
  const actions = document.getElementById('report-actions');
  results.innerHTML = '';
  actions.classList.add('hidden');
  spinner.classList.remove('hidden');

  try {
    const data = await api('/api/osint/investigate', 'POST', { seeds });
    lastResult = data;
    spinner.classList.add('hidden');
    results.innerHTML = renderInvestigateResults(data);
    actions.innerHTML = reportActionsHtml();
    actions.classList.remove('hidden');
    actions.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    spinner.classList.add('hidden');
    results.innerHTML = `<div class="feedback error" style="margin-top:1rem">${esc(err.message)}</div>`;
  }
});

// ============================================================
// Results rendering
// ============================================================
function renderInvestigateResults(data) {
  const { profile, seeds: seedResults, discovered } = data;
  let html = '';

  // -- Aggregated profile card --
  html += '<div class="profile-card">';
  html += '<div class="profile-card-title">Aggregated Profile</div>';

  if (profile.avatar_urls.length) {
    html += `<div class="profile-avatars">${profile.avatar_urls.slice(0, 6).map((a) => `
      <div class="avatar-item">
        <img src="${esc(a.url)}" alt="${esc(a.platform)}" loading="lazy" onerror="this.parentElement.style.display='none'" />
        <div class="avatar-label">${esc(a.platform)}</div>
      </div>`).join('')}</div>`;
  }

  if (profile.possible_real_names.length) {
    html += `<div class="profile-section">
      <div class="ps-label">Possible Real Names</div>
      <div class="tag-list">${profile.possible_real_names.map((n) => `<span class="tag name-tag">${esc(n)}</span>`).join('')}</div>
    </div>`;
  }

  if (profile.possible_locations.length) {
    html += `<div class="profile-section">
      <div class="ps-label">Possible Locations</div>
      <div class="tag-list">${profile.possible_locations.map((l) => `<span class="tag">${esc(l)}</span>`).join('')}</div>
    </div>`;
  }

  if (profile.confirmed_platforms.length) {
    html += `<div class="profile-section">
      <div class="ps-label">Confirmed Platforms (${profile.confirmed_platforms.length})</div>
      <div class="platform-list">
        ${profile.confirmed_platforms.map((p) => `
          <a href="${esc(p.profile_url)}" target="_blank" rel="noreferrer noopener" class="platform-hit">
            <span class="ph-name">${esc(p.platform)}</span>
            <span class="ph-user">@${esc(p.username)}</span>
          </a>`).join('')}
      </div>
    </div>`;
  }

  if (profile.linked_accounts.length) {
    html += `<div class="profile-section">
      <div class="ps-label">Keybase-Verified Links</div>
      <div class="platform-list">
        ${profile.linked_accounts.map((la) => `
          <a href="${esc(la.url || '#')}" target="_blank" rel="noreferrer noopener" class="platform-hit verified-hit">
            <span class="ph-name">${esc(la.service)}</span>
            <span class="ph-user">@${esc(la.username)}</span>
            <span class="verified-badge">&#10003; verified</span>
          </a>`).join('')}
      </div>
    </div>`;
  }

  const hasIds = profile.all_usernames.length || profile.all_emails.length || profile.all_phones.length || profile.all_urls.length;
  if (hasIds) {
    html += '<div class="profile-section"><div class="ps-label">All Discovered Identifiers</div>';
    if (profile.all_usernames.length) html += `<div class="id-row"><span class="id-label">Usernames</span><div class="tag-list">${profile.all_usernames.map((u) => `<span class="tag">@${esc(u)}</span>`).join('')}</div></div>`;
    if (profile.all_emails.length)   html += `<div class="id-row"><span class="id-label">Emails</span><div class="tag-list">${profile.all_emails.map((e) => `<span class="tag">${esc(e)}</span>`).join('')}</div></div>`;
    if (profile.all_phones.length)   html += `<div class="id-row"><span class="id-label">Phones</span><div class="tag-list">${profile.all_phones.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div></div>`;
    if (profile.all_urls.length)     html += `<div class="id-row"><span class="id-label">URLs</span><div class="tag-list">${profile.all_urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noreferrer noopener" class="tag url-tag">${esc(u)}</a>`).join('')}</div></div>`;
    html += '</div>';
  }

  if (profile.account_ages.length) {
    html += `<div class="profile-section">
      <div class="ps-label">Account Ages (oldest first)</div>
      <div class="age-list">
        ${profile.account_ages.map((a) => `
          <div class="age-item">
            <span class="age-platform">${esc(a.platform)}</span>
            <span class="age-date">${fmtDate(a.created_at)}</span>
            ${a.age_days !== undefined ? `<span class="age-days">${a.age_days.toLocaleString()} days ago</span>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
  }

  if (!profile.confirmed_platforms.length && !profile.possible_real_names.length && !profile.linked_accounts.length) {
    html += '<div class="empty-state" style="padding:1.5rem 0;text-align:left">No confirmed accounts found on API-accessible platforms. Use the manual check links below to investigate further.</div>';
  }

  html += '</div>';

  // -- Per-seed manual check links --
  const allResults = [...seedResults, ...discovered.filter((r) => r.type === 'username')];
  const withLinks = allResults.filter((r) => (r.data?.manual_checks || []).length > 0);
  if (withLinks.length) {
    html += '<h3 class="results-heading">Manual Check Links</h3>';
    for (const r of withLinks) html += renderSeedDetail(r);
  }

  // -- Per-platform extracted data --
  const allResultsForData = [...seedResults, ...discovered];
  const platformCards = [];
  for (const r of allResultsForData) {
    if (r.type === 'username' && r.data?.platforms) {
      for (const [platName, d] of Object.entries(r.data.platforms)) {
        if (d.found) platformCards.push(renderPlatformCard(platName, r.value, d, r._source));
      }
    }
    if (r.type === 'discord') platformCards.push(renderDiscordCard(r));
  }
  if (platformCards.length) {
    html += '<h3 class="results-heading">Extracted Data</h3>';
    html += `<div class="platform-data-grid">${platformCards.join('')}</div>`;
  }

  // -- Sherlock results (username -> 400+ sites, if installed) --
  const sherlockHits = [];
  let sherlockRan = false;
  for (const r of allResultsForData) {
    if (r.type === 'username' && r.data?.sherlock) {
      sherlockRan = true;
      for (const acc of r.data.sherlock.accounts || []) sherlockHits.push({ ...acc, username: r.value });
    }
  }
  if (sherlockRan && sherlockHits.length) {
    html += '<h3 class="results-heading">Sherlock &mdash; Found Across the Web</h3>';
    html += `<div class="platform-list">${sherlockHits.map((h) => `
      <a href="${esc(h.url)}" target="_blank" rel="noreferrer noopener" class="platform-hit">
        <span class="ph-name">${esc(h.site)}</span>
        <span class="ph-user">@${esc(h.username)}</span>
      </a>`).join('')}</div>`;
  }

  return html;
}

function renderPlatformCard(platName, username, d, source) {
  const rows = [];
  const add = (label, val) => { if (val !== null && val !== undefined && val !== '') rows.push([label, String(val)]); };

  add('Name',         d.name || d.full_name || d.real_name || d.display_name || d.persona_name);
  add('Bio',          d.bio ? d.bio.slice(0, 280) + (d.bio.length > 280 ? '…' : '') : null);
  add('About',        d.about ? d.about.slice(0, 280) : null);
  add('Location',     d.location || d.city);
  add('Country',      d.country);
  add('Organization', d.organization);
  add('Email',        d.email);
  add('Twitter',      d.twitter ? `@${d.twitter}` : null);
  add('GitHub',       d.github ? `@${d.github}` : null);
  add('Website',      d.website);
  add('Followers',    d.followers !== undefined ? d.followers.toLocaleString() : null);
  add('Reddit karma', d.total_karma !== undefined ? d.total_karma.toLocaleString() : null);
  add('Duolingo XP',  d.total_xp !== undefined ? d.total_xp.toLocaleString() : null);
  add('Streak',       d.streak !== undefined ? `${d.streak} days` : null);
  add('Languages',    d.languages?.length ? d.languages.join(', ') : null);
  add('Blitz rating', d.blitz_rating);
  add('Rapid rating', d.rapid_rating);
  add('Bullet rating',d.bullet_rating);
  add('CF rating',    d.rating ? `${d.rating} (${d.rank || ''})` : null);
  add('HN karma',     d.karma !== undefined ? d.karma.toLocaleString() : null);
  add('Posts',        d.submission_count !== undefined ? d.submission_count.toLocaleString() : null);
  add('Friends',      d.friend_count !== undefined && d.friend_count !== null ? d.friend_count.toLocaleString() : null);
  add('Steam display',d.persona_name);
  add('Minecraft UUID', d.uuid);
  add('Twitch followers', d.followers !== undefined && d.followers !== null ? d.followers.toLocaleString() : null);
  add('VAC banned',   d.vac_bans ? '⚠️ YES' : null);
  add('Banned',       d.is_banned ? '⚠️ YES' : null);
  add('Visibility',   d.visibility === 'Private' ? '\u{1F512} Private profile' : null);
  if (d.recent_subreddits?.length) add('Active on', d.recent_subreddits.map((s) => 'r/' + s).join(', '));
  if (d.recent_repos?.length) add('Recent repos', d.recent_repos.map((r) => r.name + (r.language ? ` (${r.language})` : '')).join(', '));
  if (d.linked_accounts?.length) {
    const verified = d.linked_accounts.filter((a) => a.state === 'verified');
    if (verified.length) add('Keybase links', verified.map((a) => `${a.service} @${a.username}`).join(', '));
  }
  add('Joined', (() => {
    const ts = d.created_at || d.joined || d.registration_time;
    return ts ? new Date(ts).toLocaleDateString() : null;
  })());
  if (d.account_age_days !== undefined && d.account_age_days !== null) {
    add('Account age', `${d.account_age_days.toLocaleString()} days`);
  }

  const avatarHtml = d.avatar_url
    ? `<img src="${esc(d.avatar_url)}" alt="" class="pdc-avatar" onerror="this.style.display='none'" />`
    : '';
  const sourceHtml = source ? `<div class="pdc-source">via ${esc(source)}</div>` : '';
  const revImgHtml = d.avatar_url ? `<div class="rev-img-links">
    <span style="font-size:0.7rem;color:var(--text-muted)">Reverse image:</span>
    <a href="https://www.google.com/searchbyimage?image_url=${encodeURIComponent(d.avatar_url)}" target="_blank" rel="noreferrer noopener">Google</a>
    <a href="https://tineye.com/search?url=${encodeURIComponent(d.avatar_url)}" target="_blank" rel="noreferrer noopener">TinEye</a>
    <a href="https://yandex.com/images/search?url=${encodeURIComponent(d.avatar_url)}&rpt=imageview" target="_blank" rel="noreferrer noopener">Yandex</a>
  </div>` : '';

  return `<div class="platform-data-card">
    <div class="pdc-header">
      ${avatarHtml}
      <div style="flex:1;min-width:0">
        <div class="pdc-name">${esc(platName)}</div>
        <div class="pdc-user">@${esc(username)}</div>
        ${sourceHtml}
        ${d.profile_url ? `<a href="${esc(d.profile_url)}" target="_blank" rel="noreferrer noopener" class="pdc-link">View Profile ↗</a>` : ''}
      </div>
    </div>
    ${revImgHtml}
    ${rows.length ? `<table class="pdc-table">${rows.map(([k, v]) => `<tr><td class="pdc-key">${esc(k)}</td><td class="pdc-val">${esc(v)}</td></tr>`).join('')}</table>` : ''}
  </div>`;
}

function renderDiscordCard(r) {
  const d = r.data;
  if (!d) return '';

  // ── Server invite result ───────────────────────────────────
  if (d.kind === 'server_invite') {
    const iconHtml = d.server_icon_url
      ? `<img src="${esc(d.server_icon_url)}" alt="" class="pdc-avatar" onerror="this.style.display='none'" />`
      : `<div class="pdc-avatar-placeholder">&#x1F4AC;</div>`;
    const rows = [];
    if (d.server_name)        rows.push(['Server name',   d.server_name]);
    if (d.server_id)          rows.push(['Server ID',     d.server_id]);
    if (d.server_description) rows.push(['Description',   d.server_description]);
    if (d.member_count)       rows.push(['Members',       d.member_count.toLocaleString()]);
    if (d.online_count)       rows.push(['Online now',    d.online_count.toLocaleString()]);
    if (d.channel_name)       rows.push(['Invite channel',d.channel_name]);
    if (d.invite_code)        rows.push(['Invite code',   d.invite_code]);

    let inviterSection = '';
    if (d.inviter_id) {
      const invAv = d.inviter_avatar_url
        ? `<img src="${esc(d.inviter_avatar_url)}" alt="" class="discord-inviter-av" onerror="this.style.display='none'" />`
        : '';
      inviterSection = `<div class="discord-inviter">
        <div class="discord-inviter-label">&#x26A0;&#xFE0F; Invite was created by this user — their Discord ID has been added to the investigation:</div>
        <div class="discord-inviter-row">
          ${invAv}
          <div>
            <div class="discord-inviter-name">${esc(d.inviter_username || 'Unknown')}</div>
            <div class="discord-inviter-id">ID: ${esc(d.inviter_id)}</div>
            <a href="https://discord.com/users/${esc(d.inviter_id)}" target="_blank" rel="noreferrer noopener" class="pdc-link">View their Discord profile ↗</a>
          </div>
        </div>
      </div>`;
    } else {
      inviterSection = `<div class="discord-inviter-label" style="color:var(--text-muted);font-size:0.8rem;margin-top:0.5rem">No inviter recorded — this may be a server-generated permanent invite.</div>`;
    }

    return `<div class="platform-data-card discord-invite-card">
      <div class="pdc-header">
        ${iconHtml}
        <div style="flex:1;min-width:0">
          <div class="pdc-name">Discord Server Invite</div>
          <div class="pdc-user">discord.gg/${esc(d.invite_code || r.value)}</div>
          <a href="https://discord.gg/${esc(d.invite_code || r.value)}" target="_blank" rel="noreferrer noopener" class="pdc-link">Open Invite ↗</a>
        </div>
      </div>
      ${d.error ? `<div style="color:var(--danger);font-size:0.82rem;margin-top:0.5rem">${esc(d.error)}</div>` : ''}
      ${rows.length ? `<table class="pdc-table">${rows.map(([k, v]) => `<tr><td class="pdc-key">${esc(k)}</td><td class="pdc-val">${esc(v)}</td></tr>`).join('')}</table>` : ''}
      ${inviterSection}
    </div>`;
  }

  // ── User ID result ─────────────────────────────────────────
  const rows = [];
  if (d.global_name || d.display_name) rows.push(['Display name', d.global_name || d.display_name]);
  if (d.username)        rows.push(['Username',       d.username]);
  if (d.id)              rows.push(['User ID',        d.id]);
  if (d.created_at)      rows.push(['Account created', new Date(d.created_at).toLocaleDateString()]);
  if (d.account_age_days !== undefined && d.account_age_days !== null)
                         rows.push(['Account age',    `${d.account_age_days.toLocaleString()} days`]);
  if (d.badges?.length)  rows.push(['Badges',         d.badges.join(', ')]);

  const avatarHtml = d.avatar_url
    ? `<img src="${esc(d.avatar_url)}" alt="" class="pdc-avatar" onerror="this.style.display='none'" />`
    : `<div class="pdc-avatar-placeholder">&#x1F4AC;</div>`;

  const revImgHtml = d.avatar_url ? `<div class="rev-img-links">
    <span style="font-size:0.7rem;color:var(--text-muted)">Reverse image search avatar:</span>
    <a href="https://www.google.com/searchbyimage?image_url=${encodeURIComponent(d.avatar_url)}" target="_blank" rel="noreferrer noopener">Google</a>
    <a href="https://tineye.com/search?url=${encodeURIComponent(d.avatar_url)}" target="_blank" rel="noreferrer noopener">TinEye</a>
    <a href="https://yandex.com/images/search?url=${encodeURIComponent(d.avatar_url)}&rpt=imageview" target="_blank" rel="noreferrer noopener">Yandex</a>
    <a href="https://facecheck.id/#${encodeURIComponent(d.avatar_url)}" target="_blank" rel="noreferrer noopener">FaceCheck.ID</a>
    <a href="https://pimeyes.com/en" target="_blank" rel="noreferrer noopener">PimEyes ↗</a>
  </div>` : '';

  let connectedHtml = '';
  if (d.connected_accounts?.length) {
    connectedHtml = `<div class="discord-connected">
      <div class="discord-connected-label">&#x1F517; Connected Accounts (publicly linked by user):</div>
      <div class="platform-list">
        ${d.connected_accounts.map((a) => `
          <span class="platform-hit">
            <span class="ph-name">${esc(a.service)}</span>
            <span class="ph-user">${esc(a.username)}</span>
          </span>`).join('')}
      </div>
      <div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.4rem">These usernames have been automatically added to the investigation above.</div>
    </div>`;
  }

  return `<div class="platform-data-card">
    <div class="pdc-header">
      ${avatarHtml}
      <div style="flex:1;min-width:0">
        <div class="pdc-name">Discord User</div>
        <div class="pdc-user">${d.username ? esc(d.username) : `ID: ${esc(d.id || r.value)}`}</div>
        <a href="https://discord.com/users/${esc(d.id || r.value)}" target="_blank" rel="noreferrer noopener" class="pdc-link">View Profile ↗</a>
      </div>
    </div>
    ${revImgHtml}
    ${rows.length ? `<table class="pdc-table">${rows.map(([k, v]) => `<tr><td class="pdc-key">${esc(k)}</td><td class="pdc-val">${esc(v)}</td></tr>`).join('')}</table>` : ''}
    ${connectedHtml}
  </div>`;
}

function renderAccountFinder(r) {
  if (r.type !== 'email') return '';
  const af = r.data?.account_finder;
  const holehe = r.data?.holehe;

  const confirmed = [];
  if (af && af.registered) for (const s of af.registered) confirmed.push({ name: s.name, ref: s.ref, src: 'built-in' });
  if (holehe && holehe.sites) for (const domain of holehe.sites) confirmed.push({ name: domain, ref: `https://${domain}`, src: 'holehe' });

  if (!confirmed.length && !(af && af.checked)) return '';

  let html = '<div class="account-finder">';
  html += `<div class="ps-label">Automated Account Check${holehe ? ' + holehe' : ''}</div>`;

  if (confirmed.length) {
    html += `<div class="af-hits">
      <div class="af-hits-title">✓ Email is registered on ${confirmed.length} site${confirmed.length > 1 ? 's' : ''}:</div>
      <div class="platform-list">
        ${confirmed.map((c) => `<a href="${esc(c.ref)}" target="_blank" rel="noreferrer noopener" class="platform-hit">
          <span class="ph-name">${esc(c.name)}</span>${c.src === 'holehe' ? '<span class="ph-user">holehe</span>' : ''}
        </a>`).join('')}
      </div>
    </div>`;
  } else {
    html += '<div class="af-none">No confirmed registrations from automated checks. (Sites may be rate-limiting — confirm manually below.)</div>';
  }

  if (af && af.checked) {
    const reg = af.registered.length, no = af.not_registered.length, unk = af.unknown.length;
    html += `<div class="af-stats">${reg} found · ${no} not registered · ${unk} blocked/unknown (of ${af.checked} checked)</div>`;
  }
  if (!holehe) {
    html += '<div class="af-tip">\u{1F4A1} Install <code>holehe</code> in Power Tools for 120+ site coverage (used automatically once present).</div>';
  }
  html += '</div>';
  return html;
}

function renderSeedDetail(r) {
  const manualChecks = r.data?.manual_checks || [];
  const source = r._source ? ` <span style="font-size:0.75rem;color:var(--text-muted)">&larr; ${esc(r._source)}</span>` : '';
  let extra = renderAccountFinder(r);

  if (r.type === 'email' && r.data?.gravatar?.found) {
    const g = r.data.gravatar;
    extra = `<div class="gravatar-row">
      <img src="${esc(g.avatar_url)}" alt="Gravatar" class="gravatar-img" onerror="this.style.display='none'" />
      <div>
        <strong>Gravatar:</strong> ${esc(g.display_name || g.username || 'account found')}
        ${g.about ? `<div class="gravatar-about">${esc(g.about)}</div>` : ''}
        ${(g.accounts || []).length ? `<div class="gravatar-about">Linked: ${g.accounts.map((a) => esc(a.service) + ' @' + esc(a.username)).join(', ')}</div>` : ''}
      </div>
    </div>` + extra;
  }

  if (r.type === 'email' && r.data?.username_candidates?.length) {
    extra += `<div class="ps-label" style="margin-bottom:0.3rem">Username candidates from email</div>
      <div class="tag-list" style="margin-bottom:0.75rem">${r.data.username_candidates.slice(0, 8).map((u) => `<span class="tag">@${esc(u)}</span>`).join('')}</div>`;
  }

  if (!extra && !manualChecks.length) return '';

  return `<div class="seed-detail-card">
    <div class="seed-detail-header">${esc(r.type)}: <code>${esc(r.value)}</code>${source}</div>
    ${extra}
    ${manualChecks.length ? renderOsintLinks(manualChecks, r.value, r.type) : ''}
  </div>`;
}

function renderOsintLinks(links, query, type) {
  const withUrl = links.filter((l) => l.url);
  const allUrlsJson = JSON.stringify(withUrl.map((l) => l.url));

  // Group by category if present
  const groups = {};
  for (const l of links) {
    const cat = l.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(l);
  }
  const hasCategories = Object.keys(groups).length > 1;

  let inner = '';
  if (hasCategories) {
    for (const [cat, items] of Object.entries(groups)) {
      inner += `<div class="oli-group">
        <div class="oli-group-label">${esc(cat)}</div>
        <div class="oli-group-items">
          ${items.map((l) => renderOsintLinkItem(l)).join('')}
        </div>
      </div>`;
    }
  } else {
    inner = links.map((l) => renderOsintLinkItem(l)).join('');
  }

  return `
    <div style="margin-top:1rem">
      <div class="osint-links-header">
        <span style="font-size:0.85rem;color:var(--text-muted)">Check each one manually &mdash; these open in a new tab.</span>
        ${withUrl.length > 1 ? `<button class="btn-open-all" onclick='openAllLinks(${allUrlsJson})'>Open All ${withUrl.length} Tabs ↗</button>` : ''}
      </div>
      <div class="osint-link-list ${hasCategories ? 'has-categories' : ''}">
        ${inner}
      </div>
    </div>`;
}

function renderOsintLinkItem(l) {
  return `<div class="osint-link-item">
    <div class="oli-name">${esc(l.name)}</div>
    ${l.description ? `<div class="oli-desc">${esc(l.description)}</div>` : ''}
    ${l.url
      ? `<a class="oli-link" href="${esc(l.url)}" target="_blank" rel="noreferrer noopener">Open ↗</a>`
      : `<span class="oli-link muted">run locally</span>`}
  </div>`;
}

function openAllLinks(urls) {
  for (const url of urls) window.open(url, '_blank', 'noopener,noreferrer');
}

// ============================================================
// Report export (for handoff to your team / law enforcement)
// ============================================================
function reportActionsHtml() {
  return `
    <button class="btn btn-primary" onclick="copyReport()">\u{1F4CB} Copy Report</button>
    <button class="btn btn-ghost" onclick="downloadReport()">\u{1F4BE} Download .txt</button>
    <span class="ra-hint">A plain-text summary you can paste into a handoff.</span>`;
}

function buildReportText() {
  if (!lastResult) return '';
  const { profile, seeds: seedResults } = lastResult;
  const L = [];
  const rule = '='.repeat(50);
  L.push('muc.io — Investigation Report');
  L.push('Generated: ' + new Date().toLocaleString());
  L.push(rule, '');

  L.push('IDENTIFIERS INVESTIGATED:');
  seedResults.forEach((s) => L.push(`  - ${s.type}: ${s.value}`));
  L.push('');

  if (profile.possible_real_names?.length) { L.push('POSSIBLE REAL NAMES:'); profile.possible_real_names.forEach((n) => L.push('  - ' + n)); L.push(''); }
  if (profile.possible_locations?.length)  { L.push('POSSIBLE LOCATIONS:');  profile.possible_locations.forEach((n) => L.push('  - ' + n)); L.push(''); }

  if (profile.confirmed_platforms?.length) {
    L.push('CONFIRMED ACCOUNTS:');
    profile.confirmed_platforms.forEach((p) => L.push(`  - ${p.platform}: @${p.username}  ${p.profile_url || ''}`));
    L.push('');
  }
  if (profile.linked_accounts?.length) {
    L.push('CRYPTOGRAPHICALLY-VERIFIED LINKS (Keybase):');
    profile.linked_accounts.forEach((p) => L.push(`  - ${p.service}: @${p.username}  ${p.url || ''}`));
    L.push('');
  }
  if (profile.all_emails?.length)    L.push('EMAILS:    ' + profile.all_emails.join(', '));
  if (profile.all_usernames?.length) L.push('USERNAMES: ' + profile.all_usernames.map((u) => '@' + u).join(', '));
  if (profile.all_phones?.length)    L.push('PHONES:    ' + profile.all_phones.join(', '));
  if (profile.all_emails?.length || profile.all_usernames?.length || profile.all_phones?.length) L.push('');
  if (profile.all_urls?.length) { L.push('URLS:'); profile.all_urls.forEach((u) => L.push('  ' + u)); L.push(''); }

  if (profile.account_ages?.length) {
    L.push('ACCOUNT AGES (oldest first):');
    profile.account_ages.forEach((a) => L.push(`  - ${a.platform}: ${fmtDate(a.created_at)}`));
    L.push('');
  }

  L.push(rule);
  L.push('Collected for information-gathering / referral purposes only.');
  return L.join('\n');
}

function copyReport() {
  navigator.clipboard.writeText(buildReportText())
    .then(() => showToast('Report copied to clipboard'))
    .catch(() => showToast('Copy failed — try Download instead'));
}

function downloadReport() {
  const blob = new Blob([buildReportText()], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `muc-io-report-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ============================================================
// Power Tools panel
// ============================================================
async function loadToolsStatus() {
  try {
    const data = await api('/api/tools/status');
    const hasPython = data.python && data.python.found;
    if (!hasPython) document.getElementById('pt-python-warn').classList.remove('hidden');

    for (const tool of ['holehe', 'sherlock']) {
      const badge = document.getElementById(`${tool}-badge`);
      const btn   = document.getElementById(`install-${tool}`);
      const installed = data[tool] && data[tool].installed;
      if (installed) {
        badge.textContent = '✓ installed';
        badge.className = 'pt-badge pt-installed';
        btn.classList.add('hidden');
      } else {
        badge.textContent = 'not installed';
        badge.className = 'pt-badge pt-missing';
        if (hasPython) btn.classList.remove('hidden');
      }
    }
  } catch {
    ['holehe-badge', 'sherlock-badge'].forEach((id) => { document.getElementById(id).textContent = 'status unknown'; });
  }
}

function startInstall(tool) {
  const log   = document.getElementById('install-log');
  const badge = document.getElementById(`${tool}-badge`);
  const btn   = document.getElementById(`install-${tool}`);

  log.innerHTML = '';
  log.classList.remove('hidden');
  badge.textContent = 'installing…';
  badge.className = 'pt-badge pt-installing';
  btn.disabled = true;

  const addLine = (text, cls = '') => {
    const line = document.createElement('div');
    line.className = 'il-line' + (cls ? ' ' + cls : '');
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  };

  const es = new EventSource(`/api/tools/install/${encodeURIComponent(tool)}`);
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'log') {
      addLine(msg.text);
    } else if (msg.type === 'done') {
      es.close();
      btn.disabled = false;
      if (msg.success) {
        addLine(msg.msg, 'il-success');
        badge.textContent = '✓ installed';
        badge.className = 'pt-badge pt-installed';
        btn.classList.add('hidden');
        showToast(`${tool} installed — your next search will use it!`);
      } else {
        addLine(msg.msg, 'il-error');
        badge.textContent = 'install failed';
        badge.className = 'pt-badge pt-missing';
      }
    }
  };
  es.onerror = () => {
    es.close();
    addLine('Connection lost — check the terminal running muc.io.', 'il-error');
    btn.disabled = false;
    badge.textContent = 'error';
    badge.className = 'pt-badge pt-missing';
  };
}

document.getElementById('install-holehe').addEventListener('click', () => startInstall('holehe'));
document.getElementById('install-sherlock').addEventListener('click', () => startInstall('sherlock'));

// ============================================================
// Shared helpers
// ============================================================
async function api(url, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function fmtBytes(n) {
  n = Number(n) || 0;
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2500);
}

// ---- Init ----
loadToolsStatus();
seedInput.focus();
