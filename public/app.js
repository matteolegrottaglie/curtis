// ============================================================
//  Dashboard (vanilla JS, no build).
// ============================================================
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortUrl = (u) => String(u || '').replace(/^https?:\/\/(www\.)?linkedin\.com/, '');

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  const txt = await r.text();
  let data;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }
  if (!r.ok) throw new Error(typeof data === 'object' ? (data.error ? JSON.stringify(data.error) : JSON.stringify(data)) : String(data));
  return data;
}

// ---------------- TOASTS ----------------
function toast(msg, type = 'info', ms = 3400) {
  const wrap = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  }, ms);
}

// ---------------- STATUS ----------------
let lastControlsKey = '';

function setBar(sel, val, max) {
  const bar = $(sel);
  if (!bar) return;
  const ratio = max > 0 ? Math.min(1, val / max) : 0;
  bar.style.width = Math.round(ratio * 100) + '%';
  bar.style.background = ratio >= 1 ? 'var(--warn)' : 'var(--accent)';
}

function renderStatus(s) {
  if (!s) return;
  // L'indicatore di stato dell'engine in sidebar è stato rimosso; aggiorno solo se presente.
  const badge = $('#engineBadge');
  if (badge) {
    const label = badge.querySelector('.pill-label');
    let cls = 'pill-off', txt = 'fermo';
    if (s.halted) (cls = 'pill-halt'), (txt = 'HALT');
    else if (!s.running) (cls = 'pill-off'), (txt = 'fermo');
    else if (s.paused) (cls = 'pill-paused'), (txt = 'in pausa');
    else (cls = 'pill-on'), (txt = 'attivo');
    badge.className = 'pill ' + cls;
    if (label) label.textContent = txt;
  }

  $('#kpiToday').textContent = `${s.invitesToday ?? 0} / ${s.dailyTarget ?? 0}`;
  setBar('#kpiTodayBar', s.invitesToday ?? 0, s.dailyTarget ?? 0);
  $('#kpiWeek').textContent = `${s.invitesThisWeek ?? 0} / ${s.weeklyCeiling ?? 0}`;
  setBar('#kpiWeekBar', s.invitesThisWeek ?? 0, s.weeklyCeiling ?? 0);
  $('#kpiPending').textContent = s.pending ?? 0;
  $('#kpiAccept').textContent = s.acceptance == null ? '—' : Math.round(s.acceptance * 100) + '%';
  $('#kpiWindow').textContent = s.inWindow ? 'aperta' : 'chiusa';

  const note = $('#note');
  if (s.note) {
    note.hidden = false;
    note.textContent = s.note;
    note.className = 'statusbar' + (s.halted ? ' halt' : '');
  } else {
    note.hidden = true;
  }

  const key = `${s.running}|${s.paused}|${s.halted}`;
  if (key !== lastControlsKey) {
    lastControlsKey = key;
    renderControls(s);
  }
}

function renderControls(s) {
  const c = $('#engineControls');
  if (!c) return; // controlli engine rimossi dalla sidebar
  c.innerHTML = '';
  const mk = (html, cls, path, okMsg) => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.innerHTML = html;
    b.onclick = async () => {
      b.disabled = true;
      try {
        renderStatus(await api('POST', path));
        if (okMsg) toast(okMsg, 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
      b.disabled = false;
    };
    return b;
  };
  if (s.halted) {
    c.append(mk('⚠ Riprendi sicurezza', 'btn-warn', '/api/engine/clear-halt', 'Stop di sicurezza azzerato'), mk('■ Stop', '', '/api/engine/stop'));
  } else if (!s.running) {
    c.append(mk('▶ Avvia', 'btn-primary', '/api/engine/start', 'Engine avviato'));
  } else {
    c.append(mk('■ Stop', '', '/api/engine/stop', 'Engine fermato'));
    c.append(s.paused ? mk('⏵ Riprendi', 'btn-accent', '/api/engine/resume') : mk('⏸ Pausa', '', '/api/engine/pause'));
  }
}

async function loadStatus() {
  try {
    renderStatus(await api('GET', '/api/status'));
  } catch (e) {
    console.error(e);
  }
}

// ---------------- SSE ----------------
function connectSse() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    let ev;
    try {
      ev = JSON.parse(e.data);
    } catch {
      return;
    }
    if (ev.type === 'status') renderStatus(ev.data);
    else if (ev.type === 'action') addLog(ev.data, ev.ts, ev.data.status);
    else if (ev.type === 'signal') addLog({ type: ev.data.kind, detail: ev.data.detail || '' }, ev.ts, 'signal');
    else if (ev.type === 'log') addLog({ detail: ev.data }, ev.ts, '');
  };
}

function addLog(d, ts, cls) {
  $('#logEmpty').hidden = true;
  const log = $('#liveLog');
  const line = document.createElement('div');
  line.className = 'log-line ' + (cls || '');
  const t = new Date(ts || Date.now()).toLocaleTimeString('it-IT');
  const k = d.type ? `<span class="lk">${esc(d.type)}</span>` : '';
  const st = d.status ? `${esc(d.status)} ` : '';
  const who = d.contact ? `· ${esc(d.contact)} ` : '';
  const msg = d.detail ? esc(d.detail) : '';
  line.innerHTML = `<span class="lt">${t}</span>${k}<span class="lmsg">${st}${who}${msg}</span>`;
  log.prepend(line);
  while (log.children.length > 200) log.lastChild.remove();
}

// ---------------- NAV (sidebar) ----------------
const TAB_META = {
  account: { title: 'Account', sub: 'Collega il tuo profilo LinkedIn' },
  campaigns: { title: 'Nuova campagna', sub: 'Crea una sequenza di outreach' },
  mycampaigns: { title: 'Campagne', sub: 'Bozze, attive e archiviate' },
  log: { title: 'Log live', sub: "Attività dell'engine in tempo reale" },
};

document.querySelectorAll('.nav-item').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('#tab-' + t.dataset.tab).classList.add('active');
    const m = TAB_META[t.dataset.tab];
    if (m) {
      $('#pageTitle').textContent = m.title;
      $('#pageSub').textContent = m.sub;
    }
    if (t.dataset.tab === 'account') loadAuth();
    if (t.dataset.tab === 'campaigns') {
      loadCampaigns();
      loadEnrollContacts();
      loadCampSettings();
      // il pannello diventa visibile ora: ricalcola la posizione dell'indicatore
      requestAnimationFrame(() => updateWizIndicator());
    }
    if (t.dataset.tab === 'mycampaigns') loadCampaigns();
  };
});

// ---------------- CONTACTS table (legacy standalone page rimossa) ----------------
// La gestione contatti è ora dentro il wizard Campagne (tab Contatti). Questa funzione
// resta come no-op sicuro perché viene ancora invocata dai flussi import/✕ del wizard.
async function loadContacts() {
  if (!$('#contactsTable')) return; // pannello standalone rimosso
  const q = $('#contactSearch')?.value.trim() || '';
  const res = await api('GET', '/api/contacts?limit=300' + (q ? `&search=${encodeURIComponent(q)}` : ''));
  $('#contactsCount').textContent = res.total;
  const tb = $('#contactsTable tbody');
  tb.innerHTML = '';
  for (const c of res.contacts) {
    const name = c.full_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(name)}</td><td>${esc(c.company || '—')}</td><td>${esc(c.headline || '—')}</td><td><a href="${esc(c.profile_url)}" target="_blank" rel="noopener">${esc(shortUrl(c.profile_url))}</a></td>`;
    tb.appendChild(tr);
  }
  $('#contactsEmpty').hidden = res.total > 0;
}

// ---------------- CAMPAIGN SEQUENCE BUILDER (card flow) ----------------
let steps = [];
let openPickerAt = null; // indice del connettore con il menu "aggiungi" aperto

const STEP_META = {
  visit: {
    label: 'Visita profilo', desc: 'Visualizza il profilo del contatto', tone: 'tone-sky',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  },
  connect: {
    label: 'Richiesta di collegamento', desc: 'Invia una richiesta di connessione', tone: 'tone-blue',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.4 2.5-5.6 5.5-5.6 1 0 2 .25 2.8.7"/><path d="M18 13.5v5M15.5 16h5"/></svg>',
  },
  wait_accept: {
    label: 'Attendi accettazione', desc: 'Aspetta che il contatto accetti', tone: 'tone-amber',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10M7 21h10"/><path d="M7 3c0 4 4 5.5 5 6.5M17 3c0 4-4 5.5-5 6.5M7 21c0-4 4-5.5 5-6.5M17 21c0-4-4-5.5-5-6.5"/></svg>',
  },
  message: {
    label: 'Invia messaggio', desc: 'Messaggio diretto al contatto', tone: 'tone-violet',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.5a7.5 7.5 0 0 1-10.6 6.8L4 20l1.7-5.7A7.5 7.5 0 1 1 20.5 11.5Z"/></svg>',
  },
  follow: {
    label: 'Segui profilo', desc: 'Inizia a seguire il contatto', tone: 'tone-green',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8.2v7.6M8.2 12h7.6"/></svg>',
  },
  like_recent: {
    label: 'Like ai post recenti', desc: 'Metti like ai post del contatto', tone: 'tone-rose',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10.5V20H4.6a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1H7Zm0 0 3.7-6.8a.8.8 0 0 1 .8-.4c1 .1 1.7 1 1.6 2L12.8 9h5.1a1.6 1.6 0 0 1 1.6 2l-1.2 7a1.6 1.6 0 0 1-1.6 1.3H7"/></svg>',
  },
  wait: {
    label: 'Attesa', desc: 'Pausa tra due step', tone: 'tone-gray',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>',
  },
};
const STEP_ORDER = ['visit', 'connect', 'wait_accept', 'message', 'follow', 'like_recent', 'wait'];

const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V5.6a1.6 1.6 0 0 1 1.6-1.6h1.8a1.6 1.6 0 0 1 1.6 1.6V7M6.5 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L18 7"/></svg>';
const ICON_FLAG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 21V4M5.5 4.5h10l-1.4 3.2 1.4 3.3h-10"/></svg>';

function stepDefaults(type) {
  const s = { type };
  if (type === 'wait_accept') s.maxDays = 14;
  if (type === 'wait') (s.days = 1), (s.hours = 0);
  if (type === 'connect') s.note = '';
  if (type === 'message') s.text = 'Ciao {firstName}, grazie del collegamento! {Mi ha colpito|Ho trovato interessante} quello che fai in {company}.';
  if (type === 'like_recent') s.count = 1;
  return s;
}

function addStep(type, index) {
  const s = stepDefaults(type);
  if (index == null || index >= steps.length) steps.push(s);
  else steps.splice(index, 0, s);
  openPickerAt = null;
  renderSteps();
}

function cardBody(s, i) {
  if (s.type === 'connect')
    return `<textarea class="seq-input" data-i="${i}" data-k="note" placeholder="Nota opzionale · {firstName}, {company}…">${esc(s.note || '')}</textarea>`;
  if (s.type === 'message')
    return `<textarea class="seq-input" data-i="${i}" data-k="text">${esc(s.text || '')}</textarea>`;
  if (s.type === 'wait_accept')
    return `<div class="seq-field"><label>Giorni massimi di attesa</label><input type="number" min="1" max="60" data-i="${i}" data-k="maxDays" value="${s.maxDays}"></div>`;
  if (s.type === 'like_recent')
    return `<div class="seq-field"><label>Quanti post</label><input type="number" min="1" max="5" data-i="${i}" data-k="count" value="${s.count}"></div>`;
  return '';
}

function pickerHtml(index) {
  const items = STEP_ORDER.map((type) => {
    const m = STEP_META[type];
    return `<button type="button" class="seq-pick" data-pick="${type}" data-at="${index}">
        <span class="seq-ico sm ${m.tone}">${m.icon}</span>
        <span class="seq-pick-text"><b>${m.label}</b><span>${m.desc}</span></span>
      </button>`;
  }).join('');
  return `<div class="seq-picker"><div class="seq-picker-title">Scegli un'azione</div>${items}</div>`;
}

function connectorHtml(index, isEnd) {
  const open = openPickerAt === index;
  const cls = isEnd ? 'seq-conn seq-conn-end' : 'seq-conn';
  const btn = isEnd
    ? `<button type="button" class="seq-add seq-add-pill ${open ? 'open' : ''}" data-add-at="${index}"><span class="seq-plus">+</span> ${steps.length ? 'Aggiungi step' : 'Aggiungi il primo step'}</button>`
    : `<button type="button" class="seq-add ${open ? 'open' : ''}" data-add-at="${index}" aria-label="Inserisci step">+</button>`;
  return `<div class="${cls}"><span class="seq-line"></span>${btn}${open ? pickerHtml(index) : ''}</div>`;
}

function nodeHtml(s, i) {
  const m = STEP_META[s.type];
  if (s.type === 'wait') {
    return `<div class="seq-delay" data-card="${i}">
        <span class="seq-ico sm ${m.tone}">${m.icon}</span>
        <div class="seq-delay-body">
          <span class="seq-delay-label">Attesa</span>
          <span class="seq-delay-inputs">
            <input type="number" min="0" data-i="${i}" data-k="days" value="${s.days}"><span>giorni</span>
            <input type="number" min="0" data-i="${i}" data-k="hours" value="${s.hours}"><span>ore</span>
          </span>
        </div>
        <button type="button" class="seq-del" data-del="${i}" title="Rimuovi">${ICON_TRASH}</button>
      </div>`;
  }
  const body = cardBody(s, i);
  return `<div class="seq-card" data-card="${i}">
      <div class="seq-card-head">
        <span class="seq-ico ${m.tone}">${m.icon}</span>
        <span class="seq-card-meta"><span class="seq-card-title">${m.label}</span><span class="seq-card-desc">${m.desc}</span></span>
        <button type="button" class="seq-del" data-del="${i}" title="Rimuovi">${ICON_TRASH}</button>
      </div>
      ${body ? `<div class="seq-card-body">${body}</div>` : ''}
    </div>`;
}

function renderSteps() {
  const list = $('#stepsList');
  let html =
    '<div class="seq-node seq-start"><span class="seq-dot"></span><span class="seq-start-text"><b>Inizio sequenza</b><span>I contatti iscritti partono da qui</span></span></div>';
  steps.forEach((s, i) => {
    html += connectorHtml(i, false);
    html += nodeHtml(s, i);
  });
  html += connectorHtml(steps.length, true);
  html += '<div class="seq-conn"><span class="seq-line"></span></div>';
  html +=
    '<div class="seq-node seq-end"><span class="seq-ico sm tone-gray">' +
    ICON_FLAG +
    '</span><span class="seq-start-text"><b>Fine sequenza</b><span>Il contatto ha completato il percorso</span></span></div>';
  list.innerHTML = html;

  const hint = $('#seqHint');
  if (hint) hint.textContent = steps.length ? `${steps.length} step` : '';

  list.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    steps.splice(Number(b.dataset.del), 1);
    openPickerAt = null;
    renderSteps();
  }));
  list.querySelectorAll('[data-k]').forEach((inp) => (inp.oninput = () => {
    const i = Number(inp.dataset.i);
    const k = inp.dataset.k;
    steps[i][k] = inp.type === 'number' ? Number(inp.value) : inp.value;
  }));
  list.querySelectorAll('[data-add-at]').forEach((b) => (b.onclick = () => {
    const at = Number(b.dataset.addAt);
    openPickerAt = openPickerAt === at ? null : at;
    renderSteps();
  }));
  list.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => addStep(b.dataset.pick, Number(b.dataset.at))));
}

// ---------------- ENROLL CONTACTS (dentro il builder) ----------------
let enrollSel = new Set();
let enrollSearchTimer = null;
// Contatti del file caricato in QUESTA sessione (preview). Vuoto = nessun file → niente preview.
let importedContacts = [];

const contactName = (c) => c.full_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || '—';

function updateEnrollCount() {
  const el = $('#enrollCount');
  if (!el) return;
  el.hidden = importedContacts.length === 0;
  el.textContent = `${enrollSel.size} selezionati`;
}

function syncEnrollAll() {
  const all = $('#enrollAll');
  if (!all) return;
  all.checked = importedContacts.length > 0 && importedContacts.every((c) => enrollSel.has(c.id));
}

// Renderizza la preview SOLO se c'è un file caricato; altrimenti mostra solo il bottone.
function loadEnrollContacts() {
  const box = $('#enrollList');
  if (!box) return;
  const tools = $('#enrollTools');
  const fileLoaded = importedContacts.length > 0;

  if (tools) tools.hidden = !fileLoaded;
  box.hidden = !fileLoaded;
  if (!fileLoaded) {
    box.innerHTML = '';
    updateEnrollCount();
    return;
  }

  const q = ($('#enrollSearch')?.value || '').trim().toLowerCase();
  const rows = importedContacts.filter((c) => {
    if (!q) return true;
    return (
      contactName(c).toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q) ||
      (c.profile_url || '').toLowerCase().includes(q)
    );
  });

  box.innerHTML = '';
  for (const c of rows) {
    const row = document.createElement('label');
    row.className = 'enroll-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enrollSel.has(c.id);
    cb.onchange = () => {
      cb.checked ? enrollSel.add(c.id) : enrollSel.delete(c.id);
      updateEnrollCount();
      syncEnrollAll();
    };
    row.appendChild(cb);
    const meta = document.createElement('span');
    meta.className = 'enroll-row-meta';
    meta.innerHTML = `<b>${esc(contactName(c))}</b>${c.company ? `<span>${esc(c.company)}</span>` : ''}`;
    row.appendChild(meta);
    box.appendChild(row);
  }
  updateEnrollCount();
  syncEnrollAll();
}

function resetEnroll() {
  enrollSel = new Set();
  importedContacts = [];
  if ($('#enrollAll')) $('#enrollAll').checked = false;
  if ($('#enrollSearch')) $('#enrollSearch').value = '';
  resetCampDz();
  loadEnrollContacts();
}

function resetCampDz() {
  if ($('#campDzText')) $('#campDzText').textContent = 'Carica un CSV di contatti';
  if ($('#campCsvFile')) $('#campCsvFile').value = '';
  if ($('#campDzClear')) $('#campDzClear').hidden = true;
}

if ($('#enrollSearch'))
  $('#enrollSearch').oninput = () => {
    clearTimeout(enrollSearchTimer);
    enrollSearchTimer = setTimeout(loadEnrollContacts, 200);
  };
if ($('#enrollAll'))
  $('#enrollAll').onchange = () => {
    enrollSel = $('#enrollAll').checked ? new Set(importedContacts.map((c) => c.id)) : new Set();
    loadEnrollContacts();
  };

// caricamento CSV direttamente dal builder
const campFile = $('#campCsvFile');
const campDz = $('#campDropzone');
if (campDz && campFile) {
  ['dragover', 'dragenter'].forEach((ev) =>
    campDz.addEventListener(ev, (e) => {
      e.preventDefault();
      campDz.classList.add('drag');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    campDz.addEventListener(ev, (e) => {
      e.preventDefault();
      campDz.classList.remove('drag');
    }),
  );
  campDz.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      campFile.files = e.dataTransfer.files;
      importCampCsv(f);
    }
  });
  campFile.onchange = () => {
    const f = campFile.files[0];
    if (f) importCampCsv(f);
  };
}

// ID dei contatti dell'ultimo file importato (inseriti + duplicati) → per "annulla import".
let lastImportContactIds = [];

async function importCampCsv(f) {
  $('#campDzText').textContent = 'Import in corso…';
  if ($('#campDzClear')) $('#campDzClear').hidden = true;
  try {
    const content = await f.text();
    const res = await api('POST', '/api/import', { filename: f.name, content });
    lastImportContactIds = Array.isArray(res.contactIds) ? res.contactIds : [];
    importedContacts = Array.isArray(res.contacts) ? res.contacts : [];
    $('#campDzText').textContent = `${esc(f.name)} · ${res.inserted} importati · ${res.duplicates} duplicati`;
    if ($('#campDzClear')) $('#campDzClear').hidden = false;
    toast(`${res.inserted} contatti importati`, 'success');
    // mostra la preview dei contatti DEL FILE, tutti selezionati di default
    enrollSel = new Set(importedContacts.map((c) => c.id));
    loadEnrollContacts();
    loadContacts();
  } catch (e) {
    resetCampDz();
    toast('Import fallito: ' + e.message, 'error');
  }
}

// pulsante "✕": annulla il file → rimuove dal DB tutti i contatti di quel file (inseriti + duplicati),
// tranne quelli già iscritti ad altre campagne (onlyUnenrolled), e ripulisce preview + selezione.
if ($('#campDzClear')) {
  $('#campDzClear').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = lastImportContactIds;
    resetCampDz();
    // svuota preview + selezione: niente file → solo il bottone
    importedContacts = [];
    enrollSel = new Set();
    if ($('#enrollAll')) $('#enrollAll').checked = false;
    loadEnrollContacts();
    if (ids.length) {
      try {
        const r = await api('POST', '/api/contacts/delete', { ids, onlyUnenrolled: true });
        toast(`File annullato — ${r.deleted} contatti rimossi`, 'info');
      } catch (err) {
        toast('Impossibile rimuovere i contatti: ' + err.message, 'error');
      }
    } else {
      toast('File annullato', 'info');
    }
    lastImportContactIds = [];
    loadContacts();
  });
}

// ---------------- CAMPAIGN SETTINGS FORM (pre-filled from global SafetyConfig) ----------------
// Spec dei gruppi/campi. tag = 'per-camp' onorato dall'engine; 'global' = salvato ma il runtime usa il globale.
const CAMP_SETTINGS_SPEC = [
  { title: 'Orari di lavoro', tag: 'per-camp', fields: [
    { key: 'workingDays', label: 'Giorni lavorativi', type: 'days' },
    { key: 'workStartHour', label: 'Ora inizio', type: 'int', min: 0, max: 23 },
    { key: 'workEndHour', label: 'Ora fine', type: 'int', min: 1, max: 24 },
    { key: 'timezone', label: 'Fuso orario', type: 'text' },
  ]},
  { title: 'Tetti giornalieri (cap per azione)', tag: 'per-camp', fields: [
    { key: 'caps.invites', label: 'Inviti', type: 'int', min: 0 },
    { key: 'caps.messages', label: 'Messaggi', type: 'int', min: 0 },
    { key: 'caps.visits', label: 'Visite', type: 'int', min: 0 },
    { key: 'caps.follows', label: 'Segui', type: 'int', min: 0 },
    { key: 'caps.likes', label: 'Like', type: 'int', min: 0 },
    { key: 'caps.withdraws', label: 'Withdraw', type: 'int', min: 0 },
  ]},
  { title: 'Ritardi tra azioni', tag: 'per-camp', fields: [
    { key: 'delays.betweenActionsMin', label: 'Min (sec)', type: 'int', min: 0, scale: 1000 },
    { key: 'delays.betweenActionsMax', label: 'Max (sec)', type: 'int', min: 0, scale: 1000 },
  ]},
  { title: 'Pause lunghe', tag: 'per-camp', fields: [
    { key: 'delays.longBreakEveryMin', label: 'Ogni N azioni · min', type: 'int', min: 0 },
    { key: 'delays.longBreakEveryMax', label: 'Ogni N azioni · max', type: 'int', min: 0 },
    { key: 'delays.longBreakMin', label: 'Durata · min (min)', type: 'int', min: 0, scale: 60000 },
    { key: 'delays.longBreakMax', label: 'Durata · max (min)', type: 'int', min: 0, scale: 60000 },
  ]},
  { title: 'Comportamento invito', tag: 'per-camp', fields: [
    { key: 'sendNoteOnConnect', label: 'Invia nota con la richiesta di collegamento', type: 'bool' },
  ]},
  { title: 'Rampa e tetto settimanale', tag: 'global', fields: [
    { key: 'weeklyInviteCeiling', label: 'Tetto inviti/settimana', type: 'int', min: 5 },
    { key: 'rampStartWeekOffset', label: 'Salta N settimane di rampa', type: 'int', min: 0 },
    { key: 'ramp', label: 'Rampa di warm-up (sett. → inviti/giorno)', type: 'ramp' },
  ]},
  { title: 'Controller adattivo', tag: 'global', fields: [
    { key: 'minAcceptanceRate', label: 'Acceptance minimo (0-1)', type: 'float', min: 0, max: 1, step: 0.05 },
    { key: 'backoffFactor', label: 'Backoff factor (0-1)', type: 'float', min: 0.1, max: 1, step: 0.05 },
    { key: 'recoveryStepPct', label: 'Recovery step (0-1)', type: 'float', min: 0.01, max: 1, step: 0.05 },
    { key: 'backoffCooldownHours', label: 'Backoff cooldown (ore)', type: 'int', min: 1 },
    { key: 'cleanDaysToRecover', label: 'Giorni puliti per recovery', type: 'int', min: 1 },
  ]},
  { title: 'Backlog inviti', tag: 'global', fields: [
    { key: 'autoWithdrawAfterDays', label: 'Auto-withdraw dopo N giorni', type: 'int', min: 3 },
    { key: 'maxPendingBacklog', label: 'Max backlog pendenti', type: 'int', min: 50 },
  ]},
];
const DAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

let campSettingsGlobal = null; // snapshot dei globali (da /api/settings)
let campSettingsCurrent = null; // valori correnti del form (modificati dall'utente)

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  if (value === undefined) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = value;
}

function renderCampSettingsForm() {
  const root = $('#campSettingsForm');
  if (!root || !campSettingsCurrent) return;
  root.innerHTML = '';
  for (const group of CAMP_SETTINGS_SPEC) {
    const g = document.createElement('div');
    g.className = 'cs-group';
    const head = document.createElement('div');
    head.className = 'cs-group-head';
    head.innerHTML = `<h4>${esc(group.title)}</h4><span class="cs-tag ${group.tag === 'per-camp' ? 'tag-per' : 'tag-global'}">${group.tag === 'per-camp' ? 'per-campagna' : 'globale'}</span>`;
    g.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'cs-grid';
    for (const f of group.fields) {
      grid.appendChild(buildField(f));
    }
    g.appendChild(grid);
    root.appendChild(g);
  }
}

function buildField(f) {
  if (f.type === 'ramp') {
    const wrap = document.createElement('div');
    wrap.className = 'cs-ramp full';
    wrap.innerHTML = `<span class="cs-label">${esc(f.label)}</span><div class="cs-ramp-list" id="csRampList"></div>`;
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-sm';
    add.textContent = '+ settimana';
    add.onclick = () => {
      if (!campSettingsCurrent.ramp) campSettingsCurrent.ramp = [];
      const r = campSettingsCurrent.ramp;
      const last = r[r.length - 1];
      r.push({ week: (last?.week || 0) + 1, dailyInvites: last?.dailyInvites || 10 });
      renderRamp();
    };
    wrap.appendChild(add);
    setTimeout(renderRamp, 0);
    return wrap;
  }
  if (f.type === 'bool') {
    const wrap = document.createElement('label');
    wrap.className = 'check check-inline full';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!getPath(campSettingsCurrent, f.key);
    cb.onchange = () => setPath(campSettingsCurrent, f.key, cb.checked);
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(' ' + f.label));
    return wrap;
  }
  if (f.type === 'days') {
    const wrap = document.createElement('div');
    wrap.className = 'cs-days full';
    wrap.innerHTML = `<span class="cs-label">${esc(f.label)}</span>`;
    const row = document.createElement('div');
    row.className = 'days-row';
    const current = new Set(getPath(campSettingsCurrent, f.key) || []);
    DAYS_IT.forEach((d, idx) => {
      const n = idx + 1;
      const chip = document.createElement('label');
      chip.className = 'day-chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = current.has(n);
      cb.onchange = () => {
        cb.checked ? current.add(n) : current.delete(n);
        setPath(campSettingsCurrent, f.key, [...current].sort((a, b) => a - b));
      };
      chip.appendChild(cb);
      chip.appendChild(document.createTextNode(d));
      row.appendChild(chip);
    });
    wrap.appendChild(row);
    return wrap;
  }
  if (f.type === 'text') {
    const wrap = document.createElement('label');
    wrap.innerHTML = `<span>${esc(f.label)}</span>`;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = getPath(campSettingsCurrent, f.key) || '';
    inp.oninput = () => setPath(campSettingsCurrent, f.key, inp.value);
    wrap.appendChild(inp);
    return wrap;
  }
  // int / float
  const wrap = document.createElement('label');
  wrap.innerHTML = `<span>${esc(f.label)}</span>`;
  const inp = document.createElement('input');
  inp.type = 'number';
  if (f.min !== undefined) inp.min = f.min;
  if (f.max !== undefined) inp.max = f.max;
  if (f.step !== undefined) inp.step = f.step;
  const cur = getPath(campSettingsCurrent, f.key);
  const scale = f.scale || 1;
  inp.value = cur != null ? Math.round((cur / scale) * 1000) / 1000 : '';
  inp.oninput = () => {
    const v = inp.value === '' ? undefined : Number(inp.value);
    setPath(campSettingsCurrent, f.key, v === undefined ? undefined : Math.round(v * scale * 1000) / 1000);
  };
  wrap.appendChild(inp);
  return wrap;
}

function renderRamp() {
  const list = document.querySelector('#csRampList');
  if (!list || !campSettingsCurrent) return;
  list.innerHTML = '';
  const ramp = campSettingsCurrent.ramp || [];
  ramp.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'cs-ramp-row';
    const wkLabel = document.createElement('label');
    wkLabel.innerHTML = `<span>Settimana</span>`;
    const wkInput = document.createElement('input');
    wkInput.type = 'number'; wkInput.min = '1'; wkInput.value = r.week;
    wkInput.oninput = () => { ramp[i].week = Number(wkInput.value); };
    wkLabel.appendChild(wkInput);
    const dailyLabel = document.createElement('label');
    dailyLabel.innerHTML = `<span>Inviti/giorno</span>`;
    const dailyInput = document.createElement('input');
    dailyInput.type = 'number'; dailyInput.min = '0'; dailyInput.value = r.dailyInvites;
    dailyInput.oninput = () => { ramp[i].dailyInvites = Number(dailyInput.value); };
    dailyLabel.appendChild(dailyInput);
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn btn-sm btn-danger'; del.textContent = '✕';
    del.onclick = () => { ramp.splice(i, 1); renderRamp(); };
    row.appendChild(wkLabel); row.appendChild(dailyLabel); row.appendChild(del);
    list.appendChild(row);
  });
}

// L'oggetto da inviare al backend è semplicemente lo snapshot corrente (è già una SafetyConfig).
function collectCampaignOverrides() {
  return campSettingsCurrent ? JSON.parse(JSON.stringify(campSettingsCurrent)) : {};
}

function resetCampOverrides() {
  if (!campSettingsGlobal) return;
  campSettingsCurrent = JSON.parse(JSON.stringify(campSettingsGlobal));
  renderCampSettingsForm();
}

async function loadCampSettings(force = false) {
  if (campSettingsGlobal && !force) {
    renderCampSettingsForm();
    return;
  }
  try {
    campSettingsGlobal = await api('GET', '/api/settings');
    campSettingsCurrent = JSON.parse(JSON.stringify(campSettingsGlobal));
    renderCampSettingsForm();
  } catch (e) {
    console.error(e);
  }
}

// Pulsante "↺ Ripristina globali"
document.addEventListener('click', (e) => {
  if (e.target?.id === 'campSettingsReset' || e.target?.closest?.('#campSettingsReset')) {
    resetCampOverrides();
    toast('Ripristinati i valori globali', 'info');
  }
});

// ---------------- WIZARD TABS (sub-tabs dentro Campagne) ----------------
function setWizTab(name) {
  document.querySelectorAll('.wiz-tab').forEach((t) => t.classList.toggle('active', t.dataset.wiz === name));
  document.querySelectorAll('.wiz-panel').forEach((p) => p.classList.toggle('active', p.id === 'wiz-' + name));
  // Il footer "Nome campagna + Crea" appare solo nel tab Sequenza
  const foot = $('#wizFooter');
  if (foot) foot.hidden = name !== 'sequence';
  updateWizIndicator();
  // ogni cambio tab fa scrollare il top della card in vista, per UX coerente
  const card = document.querySelector('.wizard-card');
  if (card) {
    const r = card.getBoundingClientRect();
    if (r.top < 0) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // ricarica la lista contatti quando si torna sul tab Contatti, per riflettere import recenti
  if (name === 'contacts') loadEnrollContacts();
  // carica/renderizza il form impostazioni quando si entra nel tab
  if (name === 'settings') loadCampSettings();
}
function updateWizIndicator() {
  const ind = document.querySelector('#wizIndicator');
  const active = document.querySelector('.wiz-tab.active');
  if (!ind || !active) return;
  ind.style.width = active.offsetWidth + 'px';
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
}
document.querySelectorAll('.wiz-tab').forEach((t) => (t.onclick = () => setWizTab(t.dataset.wiz)));
window.addEventListener('resize', updateWizIndicator);
// rifresca l'indicatore quando la pagina diventa visibile (es. cambio tab principale)
setTimeout(updateWizIndicator, 50);

// ---------------- SIDEBAR USER PROFILE: popover menu ----------------
let lastAuthState = { loggedIn: false, busy: false };

function setUserMenuOpen(open) {
  const menu = $('#userMenu');
  const btn = $('#userProfile');
  if (!menu || !btn) return;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

if ($('#userProfile')) {
  $('#userProfile').onclick = (e) => {
    e.stopPropagation();
    setUserMenuOpen($('#userMenu')?.hidden);
  };
}
// Click fuori chiude il menu
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.user-wrap');
  if (wrap && !wrap.contains(e.target)) setUserMenuOpen(false);
});
// Esc chiude il menu
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setUserMenuOpen(false);
});

if ($('#userMenuToggle')) {
  $('#userMenuToggle').onclick = async () => {
    setUserMenuOpen(false);
    if (lastAuthState.busy) {
      toast("Ferma l'engine prima di cambiare account", 'warn');
      return;
    }
    if (lastAuthState.loggedIn) await onLogout();
    else await onConnect();
  };
}
// Fallback se /avatar.jpg non esiste: nascondi l'immagine (resta solo nome + sub)
if ($('#userAvatar')) {
  $('#userAvatar').onerror = () => { $('#userAvatar').style.display = 'none'; };
}

// "Crea bozza" = crea e basta (status default = draft).
// "Avvia" = crea, iscrivi i contatti e setta lo status a 'running'.
async function createCampaignFlow(action) {
  const name = $('#campName').value.trim();
  if (!name) return toast('Dai un nome alla campagna', 'warn');
  if (!steps.length) return toast('Aggiungi almeno uno step', 'warn');
  const settings = collectCampaignOverrides();
  // Validazione locale: min<=max per delays
  if (settings.delays?.betweenActionsMin != null && settings.delays?.betweenActionsMax != null && settings.delays.betweenActionsMin > settings.delays.betweenActionsMax)
    return toast('Ritardi: min deve essere <= max', 'warn');
  if (settings.delays?.longBreakMin != null && settings.delays?.longBreakMax != null && settings.delays.longBreakMin > settings.delays.longBreakMax)
    return toast('Pause lunghe: durata min deve essere <= max', 'warn');
  if (settings.delays?.longBreakEveryMin != null && settings.delays?.longBreakEveryMax != null && settings.delays.longBreakEveryMin > settings.delays.longBreakEveryMax)
    return toast('Pause lunghe: ogni N azioni min deve essere <= max', 'warn');
  if (action === 'run' && !enrollSel.size) {
    if (!confirm('Nessun contatto selezionato. Avviare comunque la campagna vuota?')) return;
  }
  const buttons = [$('#btnCreateDraft'), $('#btnCreateRun')].filter(Boolean);
  buttons.forEach((b) => (b.disabled = true));
  try {
    const camp = await api('POST', '/api/campaigns', { name, steps, settings });
    let enrolledMsg = '';
    if (enrollSel.size) {
      const r = await api('POST', `/api/campaigns/${camp.id}/enroll`, { contactIds: [...enrollSel] });
      enrolledMsg = ` · ${r.enrolled} contatti iscritti`;
    }
    let statusMsg = ' come bozza';
    if (action === 'run') {
      await api('POST', `/api/campaigns/${camp.id}/status`, { status: 'running' });
      statusMsg = ' e avviata';
    }
    steps = [];
    renderSteps();
    $('#campName').value = '';
    resetEnroll();
    // ricarica i globali (potrebbero essere cambiati da Sicurezza nel frattempo)
    loadCampSettings(true);
    // torna al tab Contatti del wizard, pronto per la prossima campagna
    setWizTab('contacts');
    toast('Campagna creata' + statusMsg + enrolledMsg, 'success');
    loadCampaigns();
    // porta l'utente alla lista "Campagne", preselezionando il filtro appropriato
    campaignFilter = action === 'run' ? 'running' : 'draft';
    document.querySelectorAll('.mycamp-filter').forEach((b) => b.classList.toggle('active', b.dataset.filter === campaignFilter));
    document.querySelector('[data-tab=mycampaigns]')?.click();
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
  buttons.forEach((b) => (b.disabled = false));
}

if ($('#btnCreateDraft')) $('#btnCreateDraft').onclick = () => createCampaignFlow('draft');
if ($('#btnCreateRun')) $('#btnCreateRun').onclick = () => createCampaignFlow('run');

// ---------------- CAMPAIGNS LIST ----------------
let campaignFilter = 'all';

async function loadCampaigns() {
  const list = $('#campaignsList');
  const all = await api('GET', '/api/campaigns');
  const camps = campaignFilter === 'all' ? all : all.filter((c) => c.status === campaignFilter);
  if (!all.length) {
    list.innerHTML =
      '<div class="empty">Nessuna campagna ancora. Vai su <b>Campagne</b> nella sidebar per crearne una.</div>';
    return;
  }
  if (!camps.length) {
    list.innerHTML = `<div class="empty">Nessuna campagna con stato “${esc(campaignFilter)}”.</div>`;
    return;
  }
  list.innerHTML = '';
  for (const c of camps) {
    const counts = Object.entries(c.counts || {})
      .map(([k, v]) => `<span class="pill-tag">${esc(k)} · ${v}</span>`)
      .join(' ');
    const stepDesc = c.steps.map((s) => STEP_META[s.type]?.label || s.type).join('  →  ');
    const item = document.createElement('div');
    item.className = 'campaign-item';
    item.innerHTML = `
      <div class="ci-head">
        <span class="ci-name">${esc(c.name)} <span class="pill-status ${esc(c.status)}">${esc(c.status)}</span></span>
        <div class="ci-actions">
          <button class="btn btn-sm btn-primary" data-act="run">▶ Avvia</button>
          <button class="btn btn-sm" data-act="pause">⏸ Pausa</button>
          <button class="btn btn-sm" data-act="enroll">+ Iscrivi contatti</button>
          <button class="btn btn-sm" data-act="archive">Archivia</button>
          <button class="btn btn-sm btn-danger" data-act="delete">Elimina</button>
        </div>
      </div>
      <div class="ci-steps">${esc(stepDesc)}</div>
      <div class="ci-counts">${counts || '<span class="pill-tag">nessun contatto iscritto</span>'}</div>`;
    const act = async (a) => {
      try {
        if (a === 'run') (await api('POST', `/api/campaigns/${c.id}/status`, { status: 'running' })), toast('Campagna avviata', 'success');
        if (a === 'pause') await api('POST', `/api/campaigns/${c.id}/status`, { status: 'paused' });
        if (a === 'archive') await api('POST', `/api/campaigns/${c.id}/status`, { status: 'archived' });
        if (a === 'enroll') {
          const r = await api('POST', `/api/campaigns/${c.id}/enroll`, { all: true });
          toast(`Iscritti ${r.enrolled} contatti`, 'success');
        }
        if (a === 'delete') {
          if (!confirm('Eliminare la campagna?')) return;
          await api('DELETE', `/api/campaigns/${c.id}`);
          toast('Campagna eliminata', 'success');
        }
        loadCampaigns();
      } catch (e) {
        toast('Errore: ' + e.message, 'error');
      }
    };
    item.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act)));
    list.appendChild(item);
  }
}

// filtro per stato in "Le mie campagne"
document.querySelectorAll('.mycamp-filter').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.mycamp-filter').forEach((x) => x.classList.toggle('active', x === b));
  campaignFilter = b.dataset.filter;
  loadCampaigns();
}));

// ---------------- SETTINGS ----------------
let settings = null;
const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function numField(label, obj, key, opts = {}) {
  const scale = opts.scale || 1;
  const wrap = document.createElement('label');
  wrap.innerHTML = `<span>${label}</span>`;
  const inp = document.createElement('input');
  inp.type = 'number';
  if (opts.step) inp.step = opts.step;
  if (opts.min != null) inp.min = opts.min;
  inp.value = obj[key] / scale;
  inp.oninput = () => (obj[key] = Math.round(Number(inp.value) * scale * 1000) / 1000);
  wrap.appendChild(inp);
  return wrap;
}

function boolField(label, obj, key) {
  const wrap = document.createElement('label');
  wrap.className = 'check full';
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.checked = !!obj[key];
  inp.onchange = () => (obj[key] = inp.checked);
  wrap.appendChild(inp);
  wrap.appendChild(document.createElement('span')).textContent = label;
  return wrap;
}

async function loadSettings() {
  if (!$('#settingsForm')) return; // pannello Sicurezza standalone rimosso
  settings = await api('GET', '/api/settings');
  const f = $('#settingsForm');
  f.innerHTML = '';

  // giorni
  const daysBox = document.createElement('div');
  daysBox.className = 'subgroup full';
  daysBox.innerHTML = '<h3>Giorni lavorativi</h3>';
  const daysRow = document.createElement('div');
  daysRow.className = 'days-row';
  DAYS.forEach((d, idx) => {
    const n = idx + 1;
    const chip = document.createElement('label');
    chip.className = 'day-chip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = settings.workingDays.includes(n);
    cb.onchange = () => {
      const set = new Set(settings.workingDays);
      cb.checked ? set.add(n) : set.delete(n);
      settings.workingDays = [...set].sort((a, b) => a - b);
    };
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(d));
    daysRow.appendChild(chip);
  });
  daysBox.appendChild(daysRow);
  f.appendChild(daysBox);

  const tz = document.createElement('label');
  tz.innerHTML = '<span>Fuso orario</span>';
  const tzin = document.createElement('input');
  tzin.type = 'text';
  tzin.value = settings.timezone;
  tzin.oninput = () => (settings.timezone = tzin.value);
  tz.appendChild(tzin);
  f.appendChild(tz);

  f.appendChild(numField('Ora inizio', settings, 'workStartHour', { min: 0 }));
  f.appendChild(numField('Ora fine', settings, 'workEndHour', { min: 1 }));
  f.appendChild(numField('Tetto inviti / settimana', settings, 'weeklyInviteCeiling', { min: 5 }));
  f.appendChild(numField('Salta avanti N sett. rampa', settings, 'rampStartWeekOffset', { min: 0 }));
  f.appendChild(numField('Acceptance minima (0-1)', settings, 'minAcceptanceRate', { step: '0.05', min: 0 }));
  f.appendChild(numField('Backoff factor (0-1)', settings, 'backoffFactor', { step: '0.05', min: 0.1 }));
  f.appendChild(numField('Recovery step (0-1)', settings, 'recoveryStepPct', { step: '0.05', min: 0.01 }));
  f.appendChild(numField('Backoff cooldown (ore)', settings, 'backoffCooldownHours', { min: 1 }));
  f.appendChild(numField('Giorni puliti per recupero', settings, 'cleanDaysToRecover', { min: 1 }));
  f.appendChild(numField('Auto-withdraw dopo (giorni)', settings, 'autoWithdrawAfterDays', { min: 3 }));
  f.appendChild(numField('Max backlog pendenti', settings, 'maxPendingBacklog', { min: 50 }));
  f.appendChild(boolField('Invia nota con la richiesta (sconsigliato su FREE)', settings, 'sendNoteOnConnect'));

  // caps
  const caps = document.createElement('div');
  caps.className = 'subgroup full';
  caps.innerHTML = '<h3>Tetti giornalieri per azione</h3>';
  const capRow = document.createElement('div');
  capRow.className = 'inline-inputs';
  for (const k of ['invites', 'messages', 'visits', 'follows', 'likes', 'withdraws']) {
    const d = document.createElement('div');
    d.appendChild(numField(k, settings.caps, k, { min: 0 }));
    capRow.appendChild(d);
  }
  caps.appendChild(capRow);
  f.appendChild(caps);

  // delays
  const del = document.createElement('div');
  del.className = 'subgroup full';
  del.innerHTML = '<h3>Ritardi (secondi / minuti)</h3>';
  const delRow = document.createElement('div');
  delRow.className = 'inline-inputs';
  const dd = (lbl, key, scale) => {
    const d = document.createElement('div');
    d.appendChild(numField(lbl, settings.delays, key, { min: 0, scale }));
    delRow.appendChild(d);
  };
  dd('tra azioni min (s)', 'betweenActionsMin', 1000);
  dd('tra azioni max (s)', 'betweenActionsMax', 1000);
  dd('pausa ogni · min', 'longBreakEveryMin', 1);
  dd('pausa ogni · max', 'longBreakEveryMax', 1);
  dd('pausa lunga min (min)', 'longBreakMin', 60000);
  dd('pausa lunga max (min)', 'longBreakMax', 60000);
  del.appendChild(delRow);
  f.appendChild(del);

  // ramp
  const ramp = document.createElement('div');
  ramp.className = 'subgroup full';
  ramp.innerHTML = '<h3>Rampa di warm-up (inviti/giorno per settimana)</h3>';
  const rampList = document.createElement('div');
  const renderRamp = () => {
    rampList.innerHTML = '';
    settings.ramp.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'inline-inputs';
      row.style.marginBottom = '8px';
      row.innerHTML = `<div><label><span>Settimana</span><input type="number" min="1" value="${r.week}" data-ri="${i}" data-rk="week"></label></div><div><label><span>Inviti/giorno</span><input type="number" min="0" value="${r.dailyInvites}" data-ri="${i}" data-rk="dailyInvites"></label></div>`;
      const dwrap = document.createElement('div');
      dwrap.style.cssText = 'flex:0 0 auto;display:flex;align-items:flex-end';
      const del = document.createElement('button');
      del.className = 'btn btn-sm btn-danger';
      del.textContent = '✕';
      del.onclick = () => {
        settings.ramp.splice(i, 1);
        renderRamp();
      };
      dwrap.appendChild(del);
      row.appendChild(dwrap);
      rampList.appendChild(row);
    });
    rampList.querySelectorAll('[data-rk]').forEach((inp) => (inp.oninput = () => {
      settings.ramp[Number(inp.dataset.ri)][inp.dataset.rk] = Number(inp.value);
    }));
  };
  renderRamp();
  ramp.appendChild(rampList);
  const addRamp = document.createElement('button');
  addRamp.className = 'btn btn-sm';
  addRamp.textContent = '+ settimana';
  addRamp.onclick = () => {
    const last = settings.ramp[settings.ramp.length - 1];
    settings.ramp.push({ week: (last?.week || 0) + 1, dailyInvites: last?.dailyInvites || 10 });
    renderRamp();
  };
  ramp.appendChild(addRamp);
  f.appendChild(ramp);

  const info = document.createElement('p');
  info.className = 'hint full';
  info.textContent = `Warm-up iniziato: ${settings.warmupStartDate || '(al primo avvio dell\'engine)'}`;
  f.appendChild(info);
}

if ($('#btnSaveSettings')) {
  $('#btnSaveSettings').onclick = async () => {
    if (!settings) return;
    try {
      await api('PUT', '/api/settings', settings);
      $('#settingsResult').textContent = 'salvato ✓';
      toast('Impostazioni salvate', 'success');
    } catch (e) {
      toast('Errore salvataggio: ' + e.message, 'error');
    }
  };
}

// ---------------- ACCOUNT / LOGIN ----------------
const GOOGLE_SVG =
  '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>';
const ICON_PERSON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

let connecting = false;
let authPollTimer = null;

const mkBtn = (label, cls, fn) => {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.onclick = fn;
  return b;
};

async function loadAuth() {
  try {
    renderAuth(await api('GET', '/api/auth/status'));
  } catch (e) {
    console.error(e);
  }
}

function syncSidebarAuth(s) {
  lastAuthState = { loggedIn: !!s.loggedIn, busy: !!s.busy };
  const dot = $('#userStatusDot');
  if (dot) dot.classList.toggle('on', !!s.loggedIn);
  const toggle = $('#userMenuToggle');
  if (toggle) {
    if (s.busy) {
      toggle.textContent = "Engine attivo — fermalo per cambiare";
      toggle.disabled = true;
      toggle.classList.remove('danger');
    } else if (s.loggedIn) {
      toggle.textContent = 'Disconnetti';
      toggle.disabled = false;
      toggle.classList.add('danger');
    } else {
      toggle.textContent = 'Connetti account';
      toggle.disabled = false;
      toggle.classList.remove('danger');
    }
  }
}

function renderAuth(s) {
  syncSidebarAuth(s);
  const icon = $('#acctIcon'), title = $('#acctTitle'), sub = $('#acctSub'), actions = $('#acctActions');
  if (!icon) return;
  actions.innerHTML = '';

  if (s.loggedIn) {
    const was = connecting;
    connecting = false;
    stopAuthPoll();
    // Priorità: /avatar.jpg locale → avatar LinkedIn → spunta ✓
    const tryLocal = '/avatar.jpg';
    icon.className = 'acct-icon ok acct-icon-photo';
    const img = document.createElement('img');
    img.alt = s.account || 'profilo';
    img.className = 'acct-photo';
    img.src = tryLocal;
    img.onerror = () => {
      if (s.avatar && img.src !== s.avatar) {
        img.src = s.avatar; // fallback all'avatar di LinkedIn
      } else {
        // fallback finale: spunta ✓
        icon.className = 'acct-icon ok';
        icon.innerHTML = ICON_CHECK;
      }
    };
    icon.innerHTML = '';
    icon.appendChild(img);
    // Sync profilo sidebar
    const sidebarSubLogged = $('#userSub');
    if (sidebarSubLogged) sidebarSubLogged.textContent = 'Connesso';
    if (s.account) {
      const sidebarName = $('#userName');
      if (sidebarName) sidebarName.textContent = s.account;
    }
    title.textContent = s.account ? `Connesso come ${s.account}` : 'Connesso a LinkedIn';
    sub.textContent = s.busy ? 'Sessione attiva · engine in esecuzione' : 'Sessione attiva nel browser';
    if (s.busy) {
      const n = document.createElement('span');
      n.className = 'waiting';
      n.textContent = "Ferma l'engine per cambiare account";
      actions.appendChild(n);
    } else {
      actions.appendChild(mkBtn('Disconnetti', 'btn-danger', onLogout));
      actions.appendChild(mkBtn('Vai alle campagne →', 'btn-ghost', () => document.querySelector('[data-tab=campaigns]').click()));
    }
    if (was) toast(`Connesso${s.account ? ' come ' + s.account : ''} ✓`, 'success');
    return;
  }

  if (connecting) {
    icon.className = 'acct-icon off';
    icon.innerHTML = ICON_PERSON;
    title.textContent = 'Accedi nella finestra del browser…';
    sub.textContent =
      "Completa l'accesso a LinkedIn (con Google o con email) nella finestra che si è aperta, poi premi «Ho fatto il login».";
    const w = document.createElement('span');
    w.className = 'waiting';
    w.innerHTML = '<span class="spinner"></span> rilevo la connessione…';
    actions.appendChild(w);
    actions.appendChild(mkBtn('✓ Ho fatto il login', 'btn-primary', loadAuth));
    actions.appendChild(mkBtn('Annulla', 'btn-ghost', () => { connecting = false; stopAuthPoll(); loadAuth(); }));
    return;
  }

  icon.className = 'acct-icon off';
  icon.innerHTML = ICON_PERSON;
  title.textContent = 'Non connesso';
  sub.textContent = s.busy
    ? "L'engine è in esecuzione ma non risulta il login: fermalo e connettiti."
    : 'Collega il tuo profilo LinkedIn per far agire il tool.';
  const sidebarSub = $('#userSub');
  if (sidebarSub) sidebarSub.textContent = 'Non connesso';
  if (!s.busy) {
    const g = document.createElement('button');
    g.className = 'btn-google';
    g.innerHTML = `${GOOGLE_SVG}<span>Accedi a LinkedIn con Google</span>`;
    g.onclick = onConnect;
    actions.appendChild(g);
  }
}

async function onConnect() {
  try {
    const s = await api('POST', '/api/auth/open');
    if (s && s.error === 'engine_running') return toast("Ferma l'engine per gestire il login", 'warn');
    connecting = true;
    toast('Ho aperto LinkedIn nella finestra del browser: accedi con Google', 'info', 5500);
    renderAuth(s);
    startAuthPoll();
  } catch (e) {
    toast('Errore apertura login: ' + e.message, 'error');
  }
}

async function onLogout() {
  try {
    renderAuth(await api('POST', '/api/auth/logout'));
    toast('Disconnesso', 'success');
  } catch (e) {
    toast('Errore: ' + e.message, 'error');
  }
}

function startAuthPoll() {
  stopAuthPoll();
  let elapsed = 0;
  authPollTimer = setInterval(async () => {
    elapsed += 3;
    await loadAuth();
    if (!connecting || elapsed > 180) stopAuthPoll();
  }, 3000);
}
function stopAuthPoll() {
  if (authPollTimer) {
    clearInterval(authPollTimer);
    authPollTimer = null;
  }
}

// ---------------- METRICS (pagina Account) ----------------
// Renderers SVG inline — niente librerie esterne.

function chartBar(container, dailyInvites) {
  if (!container) return;
  const n = dailyInvites.length;
  if (!n) { container.innerHTML = '<div class="empty" style="margin:0">Nessun dato</div>'; return; }
  const W = 600, H = 168, PAD_T = 18, PAD_B = 28, PAD_X = 12;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...dailyInvites.map((d) => d.sent));
  const gap = 4;
  const barW = (innerW - gap * (n - 1)) / n;
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Invii per giorno">`;
  // gridline top
  svg += `<line class="grid-line" x1="${PAD_X}" y1="${PAD_T}" x2="${W - PAD_X}" y2="${PAD_T}"/>`;
  svg += `<text class="axis-text" x="${PAD_X}" y="${PAD_T - 5}" text-anchor="start">${max}</text>`;
  dailyInvites.forEach((d, i) => {
    const x = PAD_X + i * (barW + gap);
    const hSent = Math.max(2, (d.sent / max) * innerH);
    const ySent = PAD_T + (innerH - hSent);
    svg += `<rect class="${d.sent > 0 ? 'bar-sent' : 'bar-empty'}" x="${x}" y="${ySent}" width="${barW}" height="${hSent}" rx="2"><title>${d.date}: ${d.sent} inviati · ${d.accepted} accettati</title></rect>`;
    if (d.accepted > 0) {
      const hAcc = Math.max(2, (d.accepted / max) * innerH);
      const yAcc = PAD_T + (innerH - hAcc);
      svg += `<rect class="bar-accepted" x="${x}" y="${yAcc}" width="${barW}" height="${hAcc}" rx="2"></rect>`;
    }
    // tick label: solo primo, metà, ultimo
    if (i === 0 || i === n - 1 || i === Math.floor(n / 2)) {
      const lbl = d.date.slice(5); // MM-DD
      const tx = x + barW / 2;
      svg += `<text class="axis-text" x="${tx}" y="${H - 10}" text-anchor="middle">${lbl}</text>`;
    }
  });
  svg += '</svg>';
  container.innerHTML = svg;
}

function chartLine(container, dailyAcceptance) {
  if (!container) return;
  const n = dailyAcceptance.length;
  if (!n) { container.innerHTML = '<div class="empty" style="margin:0">Nessun dato</div>'; return; }
  const W = 600, H = 168, PAD_T = 18, PAD_B = 28, PAD_L = 30, PAD_R = 12;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  // y in 0..1 (acceptance rate)
  const vals = dailyAcceptance.map((d) => d.rate);
  const x = (i) => PAD_L + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v) => PAD_T + innerH - v * innerH;
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Acceptance rate negli ultimi 30 giorni">`;
  // gridlines a 0%, 25%, 50%, 75%, 100%
  [0, 0.25, 0.5, 0.75, 1].forEach((r) => {
    const yy = y(r);
    svg += `<line class="grid-line" x1="${PAD_L}" y1="${yy}" x2="${W - PAD_R}" y2="${yy}"/>`;
    svg += `<text class="axis-text" x="${PAD_L - 6}" y="${yy + 3}" text-anchor="end">${Math.round(r * 100)}%</text>`;
  });
  // area + linea — interpolazione "step" per buchi (rate null)
  let pathD = '';
  let areaD = '';
  let started = false;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (v == null) { started = false; continue; }
    const xx = x(i), yy = y(v);
    if (!started) { pathD += `M ${xx} ${yy}`; areaD += `M ${xx} ${PAD_T + innerH} L ${xx} ${yy}`; started = true; }
    else { pathD += ` L ${xx} ${yy}`; areaD += ` L ${xx} ${yy}`; }
    if (i === n - 1) areaD += ` L ${xx} ${PAD_T + innerH} Z`;
  }
  if (areaD) svg += `<path class="line-area" d="${areaD}"/>`;
  if (pathD) svg += `<path class="line-path" d="${pathD}"/>`;
  // ultimo dot
  for (let i = n - 1; i >= 0; i--) {
    if (vals[i] != null) {
      svg += `<circle class="line-dot" cx="${x(i)}" cy="${y(vals[i])}" r="3"/>`;
      break;
    }
  }
  // tick label X (primo, metà, ultimo)
  [0, Math.floor(n / 2), n - 1].forEach((i) => {
    svg += `<text class="axis-text" x="${x(i)}" y="${H - 10}" text-anchor="middle">${dailyAcceptance[i].date.slice(5)}</text>`;
  });
  container.innerHTML = svg;
}

function renderFunnel(container, f) {
  if (!container) return;
  const top = Math.max(f.visits, f.invitesSent, f.accepted, f.messages, 1);
  const pct = (v) => Math.round((v / top) * 100);
  const conv = (a, b) => (b > 0 ? Math.round((a / b) * 100) + '%' : '—');
  const rows = [
    { k: 'Visite', v: f.visits, conv: null },
    { k: 'Inviti', v: f.invitesSent, conv: conv(f.invitesSent, f.visits) },
    { k: 'Accettati', v: f.accepted, conv: conv(f.accepted, f.invitesSent) },
    { k: 'Messaggi', v: f.messages, conv: conv(f.messages, f.accepted) },
  ];
  container.innerHTML = rows.map((r) => `
    <div class="funnel-row" title="${esc(r.k)}: ${r.v}">
      <span class="funnel-label">${esc(r.k)}</span>
      <span class="funnel-bar"><span style="width:${pct(r.v)}%"></span></span>
      <span class="funnel-val">${r.v}</span>
      ${r.conv ? `<span class="funnel-conv">↳ ${r.conv} dal precedente</span>` : ''}
    </div>
  `).join('');
}

function renderCampStats(container, c) {
  if (!container) return;
  const tiles = [
    { k: 'Totale', v: c.total, cls: '' },
    { k: 'Attive', v: c.running, cls: 'run' },
    { k: 'Bozze', v: c.draft, cls: '' },
    { k: 'In pausa', v: c.paused, cls: 'paused' },
  ];
  container.innerHTML = tiles.map((t) => `
    <div class="camp-stat ${t.cls}">
      <span class="v">${t.v}</span>
      <span class="k">${esc(t.k)}</span>
    </div>
  `).join('');
}

function renderSignals(container, s) {
  if (!container) return;
  const items = [
    { k: 'Captcha', v: s.captcha, bad: s.captcha > 0 },
    { k: 'Restrizioni', v: s.restriction, bad: s.restriction > 0 },
    { k: 'Limite settimanale', v: s.weeklyLimit, bad: s.weeklyLimit > 0 },
    { k: 'Warning', v: s.warning, bad: s.warning > 0 },
    { k: 'Errori azione', v: s.error, bad: false },
  ];
  let html = items.map((i) => `
    <div class="signal-row ${i.bad ? 'bad' : ''}">
      <span class="k">${esc(i.k)}</span>
      <span class="v">${i.v}</span>
    </div>
  `).join('');
  if (s.lastAt) {
    const dt = new Date(s.lastAt).toLocaleString('it-IT');
    html += `<div class="signal-last">Ultimo segnale: ${esc(dt)}</div>`;
  } else {
    html += `<div class="signal-last">Nessun segnale registrato negli ultimi 7 giorni.</div>`;
  }
  container.innerHTML = html;

  // pill salute generale
  const pill = $('#healthPill');
  if (pill) {
    if (s.captcha > 0 || s.restriction > 0) {
      pill.className = 'health-pill bad'; pill.textContent = 'critico';
    } else if (s.weeklyLimit > 0 || s.warning > 0) {
      pill.className = 'health-pill warn'; pill.textContent = 'attenzione';
    } else {
      pill.className = 'health-pill ok'; pill.textContent = 'ok';
    }
  }
}

async function loadMetrics() {
  if (!$('#chartInvites')) return; // pannello non presente
  try {
    const m = await api('GET', '/api/metrics');
    chartBar($('#chartInvites'), m.dailyInvites);
    chartLine($('#chartAcceptance'), m.dailyAcceptance);
    renderFunnel($('#funnelBox'), m.funnel);
    renderCampStats($('#campStatsBox'), m.campaigns);
    renderSignals($('#signalsBox'), m.signals);
    // pill aggregate
    const totalInvites = m.dailyInvites.reduce((s, d) => s + d.sent, 0);
    if ($('#invitesTotal')) $('#invitesTotal').textContent = `${totalInvites} totali · 14gg`;
    const last = [...m.dailyAcceptance].reverse().find((d) => d.rate != null);
    if ($('#acceptanceCurrent')) $('#acceptanceCurrent').textContent = last ? `${Math.round(last.rate * 100)}% oggi` : '—';
  } catch (e) {
    console.error('loadMetrics', e);
  }
}

// ---------------- INIT ----------------
loadStatus();
loadAuth();
loadContacts();
loadMetrics();
renderSteps();
connectSse();
setInterval(() => {
  loadStatus();
  loadAuth();
}, 6000);
// metriche ogni 60s (più "pesanti", non serve refresh frequente)
setInterval(loadMetrics, 60_000);
