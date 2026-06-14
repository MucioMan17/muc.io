// ============================================================
// OSINT Investigation Dashboard — Frontend
// ============================================================

let currentCaseId = null;

// ---- Navigation ----
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    showView(btn.dataset.view);
  });
});

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  const el = document.getElementById(`view-${name}`);
  if (el) el.classList.add('active');
  if (name === 'cases') loadCases();
  if (name === 'lookup' || name === 'evidence') loadCaseDropdowns();
}

// ---- Cases ----
async function loadCases() {
  const list = document.getElementById('cases-list');
  list.innerHTML = '<div class="empty-state">Loading...</div>';
  const cases = await api('/api/cases');
  if (!cases.length) {
    list.innerHTML = '<div class="empty-state">No cases yet. Create your first case above.</div>';
    return;
  }
  list.innerHTML = cases.map((c) => `
    <div class="case-card" data-id="${c.id}">
      <span class="status-badge badge-${c.status}">${c.status}</span>
      <h3>${esc(c.alias)}</h3>
      <div class="meta">Created: ${fmtDate(c.created_at)}</div>
      <div class="meta">Updated: ${fmtDate(c.updated_at)}</div>
    </div>
  `).join('');

  list.querySelectorAll('.case-card').forEach((card) => {
    card.addEventListener('click', () => openCase(card.dataset.id));
  });
}

document.getElementById('btn-new-case').addEventListener('click', () => {
  document.getElementById('new-case-form').classList.toggle('hidden');
});

document.getElementById('cancel-case').addEventListener('click', () => {
  document.getElementById('new-case-form').classList.add('hidden');
});

document.getElementById('submit-case').addEventListener('click', async () => {
  const alias = document.getElementById('case-alias').value.trim();
  const notes = document.getElementById('case-notes').value.trim();
  const lead_investigator = document.getElementById('case-lead').value.trim();
  if (!alias) return alert('Please enter a case alias.');
  await api('/api/cases', 'POST', { alias, notes, lead_investigator });
  document.getElementById('new-case-form').classList.add('hidden');
  document.getElementById('case-alias').value = '';
  document.getElementById('case-lead').value = '';
  document.getElementById('case-notes').value = '';
  loadCases();
});

// ---- Case Detail ----
async function openCase(id) {
  currentCaseId = id;
  const data = await api(`/api/cases/${id}`);
  showView('case-detail');

  const found_profiles = (data.lookups || []).flatMap((l) =>
    l.results.filter((r) => r.found)
  );

  document.getElementById('case-detail-content').innerHTML = `
    <div class="section-header">
      <div>
        <span class="status-badge badge-${data.status}">${data.status}</span>
        <h2 style="margin-top:0.25rem">${esc(data.alias)}</h2>
        <div class="meta" style="color:var(--text-muted);font-size:0.8rem">
          Opened: ${fmtDate(data.created_at)} &nbsp;|&nbsp; Updated: ${fmtDate(data.updated_at)}
        </div>
      </div>
      <div class="btn-row report-actions">
        <button class="btn btn-success report-btn" onclick="downloadReport('${id}','text')">&#128196; Text Report</button>
        <button class="btn btn-ghost report-btn" onclick="openReport('${id}')">&#128462; Printable (PDF)</button>
        <button class="btn btn-primary report-btn" onclick="downloadBundle('${id}')">&#128230; Evidence Bundle (.zip)</button>
        <button class="btn btn-danger report-btn" onclick="deleteCase('${id}', '${esc(data.alias).replace(/'/g, "\\'")}')">Delete</button>
      </div>
    </div>

    <div class="detail-tabs">
      <button class="tab-btn active" data-tab="suspects">Suspects (${data.suspects.length})</button>
      <button class="tab-btn" data-tab="evidence">Evidence (${data.evidence.length})</button>
      <button class="tab-btn" data-tab="lookups">Lookups (${data.lookups.length})</button>
      <button class="tab-btn" data-tab="timeline">Timeline</button>
      <button class="tab-btn" data-tab="notes">Notes</button>
    </div>

    <div id="tab-suspects" class="tab-content active">
      ${renderSuspects(data.suspects, id)}
      <button class="btn btn-ghost" onclick="showAddSuspectForm('${id}')">+ Add Suspect Profile</button>
      <div id="add-suspect-form-${id}" class="card add-suspect-form hidden">
        ${suspectFormHtml(id)}
      </div>
    </div>

    <div id="tab-evidence" class="tab-content">
      ${data.evidence.length
        ? data.evidence.map(renderEvidence).join('')
        : '<div class="empty-state">No evidence logged yet.</div>'}
    </div>

    <div id="tab-lookups" class="tab-content">
      ${data.lookups.length
        ? data.lookups.map(renderLookup).join('')
        : '<div class="empty-state">No username lookups for this case yet.</div>'}
    </div>

    <div id="tab-timeline" class="tab-content">
      ${renderTimeline(data)}
    </div>

    <div id="tab-notes" class="tab-content">
      <div class="card">
        <label>Lead Investigator
          <input type="text" id="case-lead-edit" value="${esc(data.lead_investigator || '')}" placeholder="Name / handle for the report" />
        </label>
        <label>Case Notes
          <textarea id="case-notes-edit" rows="6">${esc(data.notes || '')}</textarea>
        </label>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="saveNotes('${id}')">Save</button>
          <label style="margin:0;flex-direction:row;align-items:center;gap:0.5rem">
            Status:
            <select id="case-status-edit" style="width:auto">
              <option value="active" ${data.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="referred" ${data.status === 'referred' ? 'selected' : ''}>Referred to LE</option>
              <option value="closed" ${data.status === 'closed' ? 'selected' : ''}>Closed</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('view-case-detail').classList.remove('hidden');
  document.getElementById('view-case-detail').classList.add('active');
}

function renderSuspects(suspects, caseId) {
  if (!suspects.length) return '<div class="empty-state" style="padding:1rem 0">No suspect profiles added yet.</div>';
  return suspects.map((s) => `
    <div class="suspect-block" id="suspect-${s.id}">
      <div class="suspect-head">
        <h4>${esc(s.display_name)}</h4>
        <div class="suspect-actions">
          <button class="icon-btn" title="Edit" onclick='editSuspect(${JSON.stringify(s).replace(/'/g, "&#39;")}, "${caseId}")'>&#9998;</button>
          <button class="icon-btn danger" title="Delete" onclick="deleteSuspect('${caseId}','${s.id}','${esc(s.display_name).replace(/'/g, "\\'")}')">&#128465;</button>
        </div>
      </div>
      ${s.known_usernames.length ? `<div><span style="color:var(--text-muted);font-size:0.8rem">Usernames:</span><div class="tag-list">${s.known_usernames.map((u) => `<span class="tag">@${esc(u)}</span>`).join('')}</div></div>` : ''}
      ${s.known_emails.length ? `<div style="margin-top:0.4rem"><span style="color:var(--text-muted);font-size:0.8rem">Emails:</span><div class="tag-list">${s.known_emails.map((e) => `<span class="tag">${esc(e)}</span>`).join('')}</div></div>` : ''}
      ${s.known_phones.length ? `<div style="margin-top:0.4rem"><span style="color:var(--text-muted);font-size:0.8rem">Phone #s:</span><div class="tag-list">${s.known_phones.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div></div>` : ''}
      ${s.platform_profiles.length ? `<div style="margin-top:0.4rem"><span style="color:var(--text-muted);font-size:0.8rem">Profiles:</span><div class="tag-list">${s.platform_profiles.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div></div>` : ''}
      ${s.notes ? `<div style="margin-top:0.5rem;font-size:0.82rem;color:var(--text-muted)">${esc(s.notes)}</div>` : ''}
    </div>
  `).join('');
}

function editSuspect(s, caseId) {
  const block = document.getElementById(`suspect-${s.id}`);
  if (!block) return;
  const j = (arr) => (arr || []).join(', ');
  block.innerHTML = `
    <h4>Edit Suspect</h4>
    <label>Display Name <input type="text" id="es-name-${s.id}" value="${esc(s.display_name)}" /></label>
    <div class="form-row">
      <label>Usernames <input type="text" id="es-usernames-${s.id}" value="${esc(j(s.known_usernames))}" /></label>
      <label>Emails <input type="text" id="es-emails-${s.id}" value="${esc(j(s.known_emails))}" /></label>
    </div>
    <div class="form-row">
      <label>Phones <input type="text" id="es-phones-${s.id}" value="${esc(j(s.known_phones))}" /></label>
      <label>Profile URLs <input type="text" id="es-profiles-${s.id}" value="${esc(j(s.platform_profiles))}" /></label>
    </div>
    <label>Notes <textarea id="es-notes-${s.id}" rows="2">${esc(s.notes || '')}</textarea></label>
    <div class="btn-row">
      <button class="btn btn-primary" onclick="saveSuspect('${caseId}','${s.id}')">Save</button>
      <button class="btn btn-ghost" onclick="openCase('${caseId}')">Cancel</button>
    </div>`;
}

async function saveSuspect(caseId, sid) {
  const split = (id) => document.getElementById(id).value.split(',').map((x) => x.trim()).filter(Boolean);
  await api(`/api/cases/${caseId}/suspects/${sid}`, 'PATCH', {
    display_name: document.getElementById(`es-name-${sid}`).value.trim(),
    known_usernames: split(`es-usernames-${sid}`),
    known_emails: split(`es-emails-${sid}`),
    known_phones: split(`es-phones-${sid}`),
    platform_profiles: split(`es-profiles-${sid}`),
    notes: document.getElementById(`es-notes-${sid}`).value.trim(),
  });
  openCase(caseId);
}

async function deleteSuspect(caseId, sid, name) {
  if (!confirm(`Delete suspect "${name}"?`)) return;
  await api(`/api/cases/${caseId}/suspects/${sid}`, 'DELETE');
  openCase(caseId);
}

// Merge all case activity into a single reverse-chronological timeline.
function renderTimeline(data) {
  const events = [];
  events.push({ t: data.created_at, icon: '📂', text: `Case "${esc(data.alias)}" opened` });
  data.suspects.forEach((s) => events.push({ t: null, icon: '👤', text: `Suspect on file: ${esc(s.display_name)}` }));
  data.lookups.forEach((l) => {
    const found = l.results.filter((r) => r.status === 'FOUND').length;
    events.push({ t: l.searched_at, icon: '🔎', text: `Lookup @${esc(l.username)} — ${found} verified` });
  });
  data.evidence.forEach((e) => {
    const att = e.attachments && e.attachments.length ? ` (+${e.attachments.length} file)` : '';
    events.push({ t: e.timestamp, icon: '🧾', text: `${fmtType(e.type)}${e.platform ? ' · ' + esc(e.platform) : ''}${att}`, added: e.added_at });
  });
  const withTime = events.filter((e) => e.t).sort((a, b) => new Date(b.t) - new Date(a.t));
  const noTime = events.filter((e) => !e.t);
  const all = [...withTime, ...noTime];
  if (!all.length) return '<div class="empty-state">No activity yet.</div>';
  return `<div class="timeline">${all.map((e) => `
    <div class="tl-item">
      <div class="tl-icon">${e.icon}</div>
      <div class="tl-body">
        <div class="tl-text">${e.text}</div>
        <div class="tl-time">${e.t ? fmtDate(e.t) : 'time not recorded'}${e.added ? ` · logged ${fmtDate(e.added)}` : ''}</div>
      </div>
    </div>`).join('')}</div>`;
}

function suspectFormHtml(caseId) {
  return `
    <h3>Add Suspect Profile</h3>
    <label>Display Name / Handle <input type="text" id="s-name" placeholder="Known name or handle" /></label>
    <div class="form-row">
      <label>Known Usernames (comma separated) <input type="text" id="s-usernames" placeholder="user1, user2..." /></label>
      <label>Known Emails (comma separated) <input type="text" id="s-emails" placeholder="email@example.com..." /></label>
    </div>
    <div class="form-row">
      <label>Known Phone Numbers (comma separated) <input type="text" id="s-phones" placeholder="+1 555 000 0000..." /></label>
      <label>Platform Profile URLs (comma separated) <input type="text" id="s-profiles" placeholder="https://..." /></label>
    </div>
    <label>Notes <textarea id="s-notes" rows="2"></textarea></label>
    <div class="btn-row">
      <button class="btn btn-primary" onclick="submitSuspect('${caseId}')">Save Suspect</button>
      <button class="btn btn-ghost" onclick="document.getElementById('add-suspect-form-${caseId}').classList.add('hidden')">Cancel</button>
    </div>
  `;
}

function showAddSuspectForm(caseId) {
  document.getElementById(`add-suspect-form-${caseId}`).classList.toggle('hidden');
}

async function submitSuspect(caseId) {
  const split = (val) => val.split(',').map((s) => s.trim()).filter(Boolean);
  await api(`/api/cases/${caseId}/suspects`, 'POST', {
    display_name: document.getElementById('s-name').value.trim(),
    known_usernames: split(document.getElementById('s-usernames').value),
    known_emails: split(document.getElementById('s-emails').value),
    known_phones: split(document.getElementById('s-phones').value),
    platform_profiles: split(document.getElementById('s-profiles').value),
    notes: document.getElementById('s-notes').value.trim(),
  });
  openCase(caseId);
}

function renderEvidence(e) {
  let integrity = '';
  if (e.integrity_ok === true) integrity = '<span class="integrity ok" title="SHA-256 hash matches — record unaltered">&#10003; verified</span>';
  else if (e.integrity_ok === false) integrity = '<span class="integrity bad" title="Hash mismatch — record may have been altered">&#9888; tampered</span>';
  return `
    <div class="evidence-entry ${e.type}">
      <div class="ev-meta">
        <strong>${fmtType(e.type)}</strong>
        ${e.platform ? ` &bull; ${esc(e.platform)}` : ''}
        &bull; ${fmtDate(e.timestamp)}
        ${e.investigator ? ` &bull; by ${esc(e.investigator)}` : ''}
        ${integrity}
        ${e.notes ? ` &bull; <em>${esc(e.notes)}</em>` : ''}
      </div>
      <div class="ev-content">${esc(e.content)}</div>
      ${renderAttachments(e)}
      ${e.content_hash ? `<div class="ev-hash" title="Integrity hash">SHA-256: ${esc(e.content_hash)}</div>` : ''}
    </div>
  `;
}

function renderAttachments(e) {
  if (!e.attachments || !e.attachments.length) return '';
  const items = e.attachments.map((a) => {
    const url = `/api/cases/${currentCaseId}/attachments/${a.id}`;
    const isImg = /^image\//.test(a.mime || '');
    return `<div class="att-thumb">
      ${isImg
        ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(a.filename)}" loading="lazy"></a>`
        : `<a class="att-file" href="${url}" target="_blank" rel="noopener">📎 ${esc(a.filename)}</a>`}
      <div class="att-cap" title="SHA-256: ${esc(a.sha256)}">${esc(a.filename)} · ${fmtBytes(a.size)}</div>
    </div>`;
  }).join('');
  return `<div class="att-grid">${items}</div>`;
}

function renderLookup(l) {
  return `
    <div class="card" style="margin-bottom:0.75rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <strong>@${esc(l.username)}</strong>
        <span style="font-size:0.78rem;color:var(--text-muted)">${fmtDate(l.searched_at)}</span>
      </div>
      ${renderLookupSummary(l.results)}
      ${renderLookupGroups(l.results)}
    </div>
  `;
}

const BLOCKED_STATUSES = ['CHECK BLOCKED', 'ERROR', 'TIMEOUT'];

function renderLookupSummary(results) {
  const found = results.filter((r) => r.status === 'FOUND').length;
  const manual = results.filter((r) => r.status === 'MANUAL CHECK').length;
  const absent = results.filter((r) => r.status === 'NOT FOUND').length;
  const blocked = results.filter((r) => BLOCKED_STATUSES.includes(r.status)).length;
  return `<div class="lookup-summary">
    <span class="pill pill-found">${found} verified</span>
    <span class="pill pill-manual">${manual} manual</span>
    ${blocked ? `<span class="pill pill-blocked">${blocked} undetermined</span>` : ''}
    <span class="pill pill-absent">${absent} absent</span>
  </div>`;
}

// Order: verified hits, then manual leads, then undetermined, then absent.
function renderLookupGroups(results) {
  const rank = (s) =>
    s === 'FOUND' ? 0 : s === 'MANUAL CHECK' ? 1 : s === 'NOT FOUND' ? 3 : 2;
  const sorted = [...results].sort((a, b) => rank(a.status) - rank(b.status));
  return `<div class="lookup-result-grid">${sorted.map(renderLookupItem).join('')}</div>`;
}

function renderLookupItem(r) {
  let cls = '', dot = 'dot-not-found';
  const blocked = BLOCKED_STATUSES.includes(r.status);
  if (r.status === 'FOUND') { cls = 'found'; dot = 'dot-found'; }
  else if (r.status === 'MANUAL CHECK') { cls = 'manual'; dot = 'dot-manual'; }
  else if (blocked) { cls = 'error'; dot = 'dot-error'; }

  // We can offer a link whenever we have a candidate URL (everything but a
  // confirmed absence). For blocked auto-checks the link lets the user verify.
  const showLink = r.status !== 'NOT FOUND' && r.url;
  let linkText = 'Check manually';
  if (r.status === 'FOUND') linkText = 'View profile';
  else if (blocked) linkText = 'Re-check by hand';

  return `
    <div class="lookup-item ${cls}">
      <div class="lookup-dot ${dot}"></div>
      <div style="min-width:0">
        <div class="platform-name">${esc(r.platform)}</div>
        ${blocked ? `<div class="platform-status">${esc(r.status)}</div>` : ''}
        ${showLink
          ? `<a href="${esc(r.url)}" target="_blank" rel="noreferrer noopener">${linkText}</a>`
          : (!blocked ? `<div class="platform-status">${esc(r.status)}</div>` : '')}
      </div>
    </div>
  `;
}

async function saveNotes(caseId) {
  const notes = document.getElementById('case-notes-edit').value;
  const status = document.getElementById('case-status-edit').value;
  const lead_investigator = document.getElementById('case-lead-edit').value;
  await api(`/api/cases/${caseId}`, 'PATCH', { notes, status, lead_investigator });
  alert('Saved.');
}

async function deleteCase(caseId, alias) {
  if (!confirm(`Permanently delete case "${alias}" and all its suspects, evidence, and lookups? This cannot be undone.`)) return;
  await api(`/api/cases/${caseId}`, 'DELETE');
  showView('cases');
  document.getElementById('view-case-detail').classList.add('hidden');
}

async function downloadReport(caseId) {
  window.location.href = `/api/reports/${caseId}?format=text`;
}

function openReport(caseId) {
  window.open(`/api/reports/${caseId}?format=html`, '_blank');
}

function downloadBundle(caseId) {
  window.location.href = `/api/reports/${caseId}/bundle`;
}

document.getElementById('back-to-cases').addEventListener('click', () => {
  showView('cases');
  document.getElementById('view-case-detail').classList.add('hidden');
});

// ---- Username Lookup ----
document.getElementById('run-lookup').addEventListener('click', async () => {
  const username = document.getElementById('lookup-username').value.trim();
  if (!username) return alert('Enter a username to search.');
  const case_id = document.getElementById('lookup-case-id').value;

  document.getElementById('lookup-results').innerHTML = '';
  document.getElementById('lookup-spinner').classList.remove('hidden');

  const data = await api('/api/lookup', 'POST', { username, case_id: case_id || undefined });

  document.getElementById('lookup-spinner').classList.add('hidden');

  document.getElementById('lookup-results').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h3 style="margin:0">Results for @${esc(data.username)}</h3>
      </div>
      ${renderLookupSummary(data.results)}
      ${renderLookupGroups(data.results)}
    </div>
  `;
});

// ---- Evidence Logging ----
document.getElementById('evidence-case-id').addEventListener('change', async function () {
  const caseId = this.value;
  const suspectSel = document.getElementById('evidence-suspect-id');
  suspectSel.innerHTML = '<option value="">— None —</option>';
  if (!caseId) return;
  const data = await api(`/api/cases/${caseId}`);
  data.suspects.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.display_name;
    suspectSel.appendChild(opt);
  });
});

// Show selected file names as they're chosen.
document.getElementById('evidence-files').addEventListener('change', function () {
  const list = document.getElementById('evidence-file-list');
  const files = Array.from(this.files || []);
  list.innerHTML = files.length
    ? files.map((f) => `<span class="file-chip">📎 ${esc(f.name)} (${fmtBytes(f.size)})</span>`).join('')
    : '';
});

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      resolve({ filename: file.name, mime: file.type || 'application/octet-stream', data_base64: res.split(',')[1] || '' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('submit-evidence').addEventListener('click', async () => {
  const case_id = document.getElementById('evidence-case-id').value;
  if (!case_id) return alert('Select a case first.');
  const content = document.getElementById('evidence-content').value.trim();
  if (!content) return alert('Evidence content is required.');

  const tsRaw = document.getElementById('evidence-timestamp').value;
  const timestamp = tsRaw ? new Date(tsRaw).toISOString() : new Date().toISOString();

  const fileInput = document.getElementById('evidence-files');
  const files = Array.from(fileInput.files || []);
  const fb = document.getElementById('evidence-feedback');

  let attachments = [];
  try {
    attachments = await Promise.all(files.map(readFileAsBase64));
  } catch (err) {
    fb.textContent = 'Failed to read attachment.';
    fb.className = 'feedback error';
    fb.classList.remove('hidden');
    return;
  }

  try {
    await api(`/api/cases/${case_id}/evidence`, 'POST', {
      suspect_id: document.getElementById('evidence-suspect-id').value || undefined,
      type: document.getElementById('evidence-type').value,
      platform: document.getElementById('evidence-platform').value.trim(),
      content,
      timestamp,
      investigator: document.getElementById('evidence-investigator').value.trim(),
      notes: document.getElementById('evidence-notes').value.trim(),
      attachments,
    });
  } catch (err) {
    fb.textContent = err.message || 'Failed to log evidence.';
    fb.className = 'feedback error';
    fb.classList.remove('hidden');
    return;
  }

  fb.textContent = `Evidence logged${attachments.length ? ` with ${attachments.length} attachment(s)` : ''} and hashed.`;
  fb.className = 'feedback success';
  fb.classList.remove('hidden');
  document.getElementById('evidence-content').value = '';
  document.getElementById('evidence-notes').value = '';
  fileInput.value = '';
  document.getElementById('evidence-file-list').innerHTML = '';
  setTimeout(() => fb.classList.add('hidden'), 4000);
});

// ---- Helpers ----
async function loadCaseDropdowns() {
  const cases = await api('/api/cases');
  ['lookup-case-id', 'evidence-case-id'].forEach((selId) => {
    const sel = document.getElementById(selId);
    const first = sel.options[0];
    sel.innerHTML = '';
    sel.appendChild(first);
    cases.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.alias;
      sel.appendChild(opt);
    });
  });
}

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

function fmtType(t) {
  return { chat_log: 'Chat Log', screenshot_desc: 'Screenshot', profile_info: 'Profile Info', url: 'URL/Link', phone_call: 'Phone Log', other: 'Other' }[t] || t;
}

function fmtBytes(n) {
  n = Number(n) || 0;
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

// ---- Global search ----
const searchInput = document.getElementById('global-search');
const searchResults = document.getElementById('search-results');
let searchTimer;

searchInput.addEventListener('input', function () {
  const q = this.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) { searchResults.classList.add('hidden'); return; }
  searchTimer = setTimeout(() => runSearch(q), 220);
});

async function runSearch(q) {
  const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
  if (!data.hits.length) {
    searchResults.innerHTML = '<div class="search-empty">No matches</div>';
    searchResults.classList.remove('hidden');
    return;
  }
  const icon = { case: '📂', suspect: '👤', evidence: '🧾', lookup: '🔎' };
  searchResults.innerHTML = data.hits.map((h) => `
    <div class="search-hit" data-case="${h.case_id}">
      <span class="sh-icon">${icon[h.type] || '•'}</span>
      <span class="sh-main">${esc(h.label)}</span>
      <span class="sh-sub">${esc(h.sub || '')}</span>
    </div>`).join('');
  searchResults.classList.remove('hidden');
  searchResults.querySelectorAll('.search-hit').forEach((el) => {
    el.addEventListener('click', () => {
      searchResults.classList.add('hidden');
      searchInput.value = '';
      openCase(el.dataset.case);
    });
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.nav-search')) searchResults.classList.add('hidden');
});

// Init
loadCases();
