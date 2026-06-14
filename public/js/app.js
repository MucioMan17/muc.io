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
  if (!alias) return alert('Please enter a case alias.');
  await api('/api/cases', 'POST', { alias, notes });
  document.getElementById('new-case-form').classList.add('hidden');
  document.getElementById('case-alias').value = '';
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
      <div class="btn-row">
        <button class="btn btn-success report-btn" onclick="downloadReport('${id}')">&#128196; Export LE Report</button>
      </div>
    </div>

    <div class="detail-tabs">
      <button class="tab-btn active" data-tab="suspects">Suspects</button>
      <button class="tab-btn" data-tab="evidence">Evidence (${data.evidence.length})</button>
      <button class="tab-btn" data-tab="lookups">Lookups (${data.lookups.length})</button>
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

    <div id="tab-notes" class="tab-content">
      <div class="card">
        <label>Case Notes
          <textarea id="case-notes-edit" rows="6">${esc(data.notes || '')}</textarea>
        </label>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="saveNotes('${id}')">Save Notes</button>
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
    <div class="suspect-block">
      <h4>${esc(s.display_name)}</h4>
      ${s.known_usernames.length ? `<div><span style="color:var(--text-muted);font-size:0.8rem">Usernames:</span><div class="tag-list">${s.known_usernames.map((u) => `<span class="tag">@${esc(u)}</span>`).join('')}</div></div>` : ''}
      ${s.known_emails.length ? `<div style="margin-top:0.4rem"><span style="color:var(--text-muted);font-size:0.8rem">Emails:</span><div class="tag-list">${s.known_emails.map((e) => `<span class="tag">${esc(e)}</span>`).join('')}</div></div>` : ''}
      ${s.known_phones.length ? `<div style="margin-top:0.4rem"><span style="color:var(--text-muted);font-size:0.8rem">Phone #s:</span><div class="tag-list">${s.known_phones.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div></div>` : ''}
      ${s.platform_profiles.length ? `<div style="margin-top:0.4rem"><span style="color:var(--text-muted);font-size:0.8rem">Profiles:</span><div class="tag-list">${s.platform_profiles.map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div></div>` : ''}
      ${s.notes ? `<div style="margin-top:0.5rem;font-size:0.82rem;color:var(--text-muted)">${esc(s.notes)}</div>` : ''}
    </div>
  `).join('');
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
  return `
    <div class="evidence-entry ${e.type}">
      <div class="ev-meta">
        <strong>${fmtType(e.type)}</strong>
        ${e.platform ? ` &bull; ${esc(e.platform)}` : ''}
        &bull; ${fmtDate(e.timestamp)}
        ${e.notes ? ` &bull; <em>${esc(e.notes)}</em>` : ''}
      </div>
      <div class="ev-content">${esc(e.content)}</div>
    </div>
  `;
}

function renderLookup(l) {
  const found = l.results.filter((r) => r.found);
  return `
    <div class="card" style="margin-bottom:0.75rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
        <strong>@${esc(l.username)}</strong>
        <span style="font-size:0.78rem;color:var(--text-muted)">${fmtDate(l.searched_at)}</span>
      </div>
      <div style="margin-bottom:0.5rem;font-size:0.82rem;color:var(--success)">${found.length} platform(s) found</div>
      <div class="lookup-result-grid">
        ${l.results.map(renderLookupItem).join('')}
      </div>
    </div>
  `;
}

function renderLookupItem(r) {
  const cls = r.found ? 'found' : r.status === 'ERROR' || r.status === 'TIMEOUT' ? 'error' : '';
  const dot = r.found ? 'dot-found' : r.status !== 'NOT FOUND' ? 'dot-error' : 'dot-not-found';
  return `
    <div class="lookup-item ${cls}">
      <div class="lookup-dot ${dot}"></div>
      <div>
        <div class="platform-name">${esc(r.platform)}</div>
        ${r.found
          ? `<a href="${r.url}" target="_blank" rel="noreferrer noopener">${esc(r.url)}</a>`
          : `<div class="platform-status">${r.status}</div>`}
      </div>
    </div>
  `;
}

async function saveNotes(caseId) {
  const notes = document.getElementById('case-notes-edit').value;
  const status = document.getElementById('case-status-edit').value;
  await api(`/api/cases/${caseId}`, 'PATCH', { notes, status });
  alert('Saved.');
}

async function downloadReport(caseId) {
  window.location.href = `/api/reports/${caseId}`;
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

  const found = data.results.filter((r) => r.found);
  document.getElementById('lookup-results').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h3 style="margin:0">Results for @${esc(data.username)}</h3>
        <span style="color:var(--success);font-weight:700">${found.length} / ${data.results.length} found</span>
      </div>
      <div class="lookup-result-grid">
        ${data.results.map(renderLookupItem).join('')}
      </div>
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

document.getElementById('submit-evidence').addEventListener('click', async () => {
  const case_id = document.getElementById('evidence-case-id').value;
  if (!case_id) return alert('Select a case first.');
  const content = document.getElementById('evidence-content').value.trim();
  if (!content) return alert('Evidence content is required.');

  const tsRaw = document.getElementById('evidence-timestamp').value;
  const timestamp = tsRaw ? new Date(tsRaw).toISOString() : new Date().toISOString();

  await api(`/api/cases/${case_id}/evidence`, 'POST', {
    suspect_id: document.getElementById('evidence-suspect-id').value || undefined,
    type: document.getElementById('evidence-type').value,
    platform: document.getElementById('evidence-platform').value.trim(),
    content,
    timestamp,
    notes: document.getElementById('evidence-notes').value.trim(),
  });

  const fb = document.getElementById('evidence-feedback');
  fb.textContent = 'Evidence logged successfully.';
  fb.className = 'feedback success';
  fb.classList.remove('hidden');
  document.getElementById('evidence-content').value = '';
  document.getElementById('evidence-notes').value = '';
  setTimeout(() => fb.classList.add('hidden'), 3000);
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

// Init
loadCases();
