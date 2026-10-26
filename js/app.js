/* ══════════════════════════════════════════════════════════
   ROTACIÓN DE MANTENIMIENTO — Romero Panificados
   App individual. Firestore: planning / config
   Edita quien inicia sesión (Firebase Auth); el resto ve en solo lectura.
══════════════════════════════════════════════════════════ */
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { db, COL, DOC_ID, buscarUsuario } from "./firebase.js";

const ref = doc(db, COL, DOC_ID);

const EX_NAMES = {
  vacaciones: 'Vacaciones', compensatorio: 'Compensatorio (día tomado)', trabajo_franco: 'Trabajó día libre (suma compensatorio)', cambio_turno: 'Cambio de turno',
  cambio_grupo: 'Cambio de grupo', fuera_rotacion: 'Fuera de rotación',
  licencia_medica: 'Ausente por licencia médica', otro: 'Otro'
};
const SHIFTS = ['Mañana', 'Noche', 'Tarde'];
const SHORT = { M: 'M', T: 'T', N: 'N', VAC: 'V', COMP: 'C', EXT: '+', CAM: '↔', LIC: 'L', FIJO: 'F', DESC: 'D', 'F/R': '–', OTRO: '•' };   // etiqueta corta para celular

const esc = x => String(x ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const dk = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysOf = (y, m) => { const a = []; for (let d = new Date(y, m, 1); d.getMonth() === m; d.setDate(d.getDate() + 1)) a.push(new Date(d)); return a; };
const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

let root, canEdit = false, loaded = false, docExists = false, user = null, unsub = null;
let state = emptyState();
let cur = startOfMonth(new Date());

function emptyState() {
  return {
    rotation: ['Mañana', 'Noche', 'Tarde'],
    hours: { 'Mañana': '06:00 - 14:00', 'Tarde': '14:00 - 22:00', 'Noche': '22:00 - 06:00' },
    cycleStart: '2026-09-28', groups: [], people: [], exceptions: [], compAdj: []
  };
}
function normalize(s) {
  const b = emptyState(); s = s || {};
  return {
    rotation: s.rotation || b.rotation, hours: { ...b.hours, ...(s.hours || {}) }, cycleStart: s.cycleStart || b.cycleStart,
    groups: s.groups || [], people: s.people || [], exceptions: s.exceptions || [], compAdj: s.compAdj || []
  };
}

/* ══ TOAST (el de Parte Diario) ══ */
let tt;
function toast(msg, err = false) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = `toast ${err ? 'err' : ''} show`;
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ══ REGLAS DE ROTACIÓN ══ */
function groupAt(p, d) {
  let g = p.group || '';
  state.exceptions.filter(e => e.person === p.id && e.type === 'cambio_grupo')
    .sort((a, b) => a.start.localeCompare(b.start))
    .forEach(e => { if (d >= pd(e.start) && d <= pd(e.end || e.start)) g = e.value || ''; });
  return g;
}
function exAt(p, d) {
  const k = dk(d);
  return state.exceptions.find(e => e.person === p.id && k >= e.start && k <= (e.end || e.start) && e.type !== 'cambio_grupo');
}
// Horario de un turno para una persona: el propio (si lo tiene cargado) o el general
const hoursFor = (p, t) => (p.hours && p.hours[t]) || state.hours[t];
const isCustom = (p, t) => !!(p.hours && p.hours[t]) && p.hours[t] !== state.hours[t];
// Corre la hora de entrada: "06:00 - 14:00" con 2 h antes → "04:00 - 14:00"
function shiftStart(str, h) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(.+)$/.exec(str || '');
  if (!m) return str || '';
  const min = ((((+m[1]) * 60 + (+m[2]) - Math.round(h * 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')} - ${m[3].trim()}`;
}
// → [etiqueta, detalle, clase css, horario propio?]
function assignment(p, d) {
  const e = exAt(p, d);
  if (e) {
    if (e.type === 'vacaciones') return ['VAC', 'Vacaciones', 'vac'];
    if (e.type === 'compensatorio') return ['COMP', 'Compensatorio', 'comp'];
    if (e.type === 'trabajo_franco') return ['EXT', hoursFor(p, e.value) || 'Trabajó día libre', 'extra', isCustom(p, e.value)];
    if (e.type === 'cambio_turno') return ['CAM', hoursFor(p, e.value) || e.value, 'change', isCustom(p, e.value)];
    if (e.type === 'fuera_rotacion') return ['F/R', 'Fuera de rotación', 'out'];
    if (e.type === 'licencia_medica') return ['LIC', 'Licencia médica', 'lic'];
    if (e.type === 'otro') return ['OTRO', e.note || 'Otro', 'other'];
  }
  if (p.mode === 'fuera_rotacion') return ['F/R', 'Fuera de rotación', 'out'];
  const sunday = d.getDay() === 0;   // los fijos y la rotación de tarde no vienen los domingos
  if (p.mode === 'fijo') return sunday ? ['DESC', 'Descanso', 'rest'] : ['FIJO', p.fixed || 'Horario fijo', 'fixed'];
  const g = state.groups.find(q => q.id === groupAt(p, d));
  if (!g) return ['F/R', 'Fuera de rotación', 'out'];
  if (g.fixedShift) return sunday ? ['DESC', 'Descanso', 'rest'] : ['FIJO', hoursFor(p, g.fixedShift), 'fixed', isCustom(p, g.fixedShift)];
  const s = pd(state.cycleStart);
  const diff = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const weeks = Math.floor(diff / 604800000);
  const shiftOf = w => state.rotation[(((w + g.start) % 3) + 3) % 3];
  let t = shiftOf(weeks);
  const dow = d.getDay();
  // Noche: la semana arranca el DOMINGO (22:00) y el SÁBADO no viene el turno noche.
  //  · domingo: si la semana siguiente es de noche, el grupo entra hoy a la noche;
  //    si venía de una semana de noche, descansa (su última noche fue el viernes).
  //  · sábado de semana de noche: descanso.
  if (dow === 0) {
    if (shiftOf(weeks + 1) === 'Noche') t = 'Noche';
    else if (t === 'Noche' || t === 'Tarde') return ['DESC', 'Descanso', 'rest'];
  } else if (dow === 6 && t === 'Noche') {
    return ['DESC', 'Descanso', 'rest'];
  }
  return [t === 'Mañana' ? 'M' : t === 'Tarde' ? 'T' : 'N', hoursFor(p, t), t.toLowerCase(), isCustom(p, t)];
}

/* ══ COMPENSATORIOS ══
   + Trabajó día libre (excepción 'trabajo_franco')  → suma 1 día por cada día del rango
   − Compensatorio (excepción 'compensatorio')       → resta 1 día por cada día del rango
   ± Ajustes manuales (state.compAdj)                → saldo inicial o correcciones           */
const utcDay = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
const spanDays = e => Math.round((utcDay(pd(e.end || e.start)) - utcDay(pd(e.start))) / 86400000) + 1;
const fmtDays = n => Number.isInteger(n) ? String(n) : n.toFixed(1);
function compMoves() {
  const m = [];
  state.exceptions.forEach(e => {
    if (e.type === 'trabajo_franco') m.push({ kind: 'ex', id: e.id, person: e.person, date: e.start, end: e.end || e.start, days: spanDays(e), note: e.note || '', label: 'Trabajó día libre' });
    else if (e.type === 'compensatorio') m.push({ kind: 'ex', id: e.id, person: e.person, date: e.start, end: e.end || e.start, days: -spanDays(e), note: e.note || '', label: 'Compensatorio tomado' });
  });
  state.compAdj.forEach(a => m.push({ kind: 'adj', id: a.id, person: a.person, date: a.date || '', end: a.date || '', days: +a.days || 0, note: a.note || '', label: 'Ajuste' }));
  return m;
}
function compBalance(pid) {
  let earned = 0, taken = 0, adj = 0;
  compMoves().filter(x => x.person === pid).forEach(x => {
    if (x.kind === 'adj') adj += x.days; else if (x.days > 0) earned += x.days; else taken += -x.days;
  });
  return { earned, taken, adj, saldo: earned + adj - taken };
}

/* ══ GUARDAR ══ */
async function save(okMsg = '✓ Rotación guardada') {
  try {
    await setDoc(ref, JSON.parse(JSON.stringify(state)));
    toast(okMsg);
  } catch (e) {
    console.error(e);
    toast(e.code === 'permission-denied'
      ? 'Firestore rechazó el guardado: falta permitir la colección "planning" en las reglas'
      : 'Error al guardar: ' + e.message, true);
    throw e;
  }
}

/* ══ PANEL (HTML) ══ */
function panelHTML() {
  return `<div class="app-content rt-wide">
  <div class="context-toolbar" id="rt-viewbar">
    <div class="context-toolbar-copy">
      <div class="context-eyebrow">ROTACIÓN</div>
      <div class="context-title" id="rt-title">Calendario</div>
    </div>
    <label class="context-picker"><span>Vista</span>
      <select class="context-view-select" id="rt-view">
        <option value="rt-cal">CALENDARIO</option>
        <option value="rt-people">PERSONAS</option>
        <option value="rt-groups">GRUPOS</option>
        <option value="rt-ex">EXCEPCIONES</option>
        <option value="rt-comp">COMPENSATORIOS</option>
        <option value="rt-set">CONFIGURACIÓN</option>
      </select>
    </label>
  </div>

  <div id="rt-cal" class="rt-sub">
    <div class="section-header"><div class="section-title">ROTACIÓN MENSUAL</div><div class="fecha-badge" id="rt-badge"></div></div>
    <div class="rt-toolbar">
      <div class="rt-month">
        <button class="rt-nav" id="rt-prev" type="button" aria-label="Mes anterior">‹</button>
        <strong id="rt-month">—</strong>
        <button class="rt-nav" id="rt-next" type="button" aria-label="Mes siguiente">›</button>
        <button class="rt-nav rt-today" id="rt-today" type="button">HOY</button>
      </div>
      <div class="rt-filters">
        <label class="context-picker"><span>Grupo</span><select class="context-view-select" id="rt-fg"></select></label>
        <label class="context-picker"><span>Persona</span><select class="context-view-select" id="rt-fp"></select></label>
      </div>
    </div>
    <div class="rt-legend">
      <span><i class="rt-dot" style="background:#f5b324"></i>Mañana</span>
      <span><i class="rt-dot" style="background:#ff6b57"></i>Tarde</span>
      <span><i class="rt-dot" style="background:#60a5fa"></i>Noche</span>
      <span><i class="rt-dot" style="background:#e8798a"></i>Vacaciones</span>
      <span><i class="rt-dot" style="background:#d96a8c"></i>Licencia</span>
      <span><i class="rt-dot" style="background:#63b167"></i>Fijo / Cambio</span>
      <span><i class="rt-dot" style="background:#b794f4"></i>Compensatorio (tomado)</span>
      <span><i class="rt-dot" style="background:#4fd1c5"></i>Trabajó día libre (+comp.)</span>
      <span><i class="rt-dot" style="background:#6b6f76"></i>Fuera de rotación</span>
      <span><i class="rt-dot" style="background:#4a4d52"></i>Descanso</span>
    </div>
    <div class="rt-tablewrap"><table id="rt-table" class="rt-table"></table></div>
    <p class="rt-hint" id="rt-hint"></p>
  </div>

  <div id="rt-people" class="rt-sub" hidden>
    <div class="section-header"><div class="section-title">PERSONAS</div><button class="btn btn-sm" id="rt-add-person" type="button">+ NUEVA PERSONA</button></div>
    <div id="rt-people-list" class="rt-cards"></div>
  </div>

  <div id="rt-groups" class="rt-sub" hidden>
    <div class="section-header"><div class="section-title">GRUPOS Y ROTACIÓN</div><button class="btn btn-sm" id="rt-add-group" type="button">+ NUEVO GRUPO</button></div>
    <div id="rt-group-list" class="rt-cards"></div>
  </div>

  <div id="rt-ex" class="rt-sub" hidden>
    <div class="section-header"><div class="section-title">EXCEPCIONES</div><button class="btn btn-sm" id="rt-add-ex" type="button">+ NUEVA EXCEPCIÓN</button></div>
    <div id="rt-ex-list"></div>
  </div>

  <div id="rt-comp" class="rt-sub" hidden>
    <div class="section-header"><div class="section-title">COMPENSATORIOS</div>
      <div class="rt-comp-btns"><button class="btn btn-sm" id="rt-add-extra" type="button">+ DÍA TRABAJADO</button><button class="btn btn-sm btn-outline" id="rt-add-take" type="button">+ DÍA TOMADO</button><button class="btn btn-sm btn-outline" id="rt-add-adj" type="button">AJUSTE / SALDO INICIAL</button></div></div>
    <p class="rt-small" style="margin:0 0 12px">Cada día <b>trabajado</b> en un domingo o día libre suma 1 compensatorio a favor. Cada día <b>tomado</b> (marcado como “Compensatorio”, en el calendario o acá) lo descuenta.</p>
    <div id="rt-comp-bal" class="rt-balances"></div>
    <div class="rt-toolbar" style="margin-top:20px"><strong>Movimientos</strong><div class="rt-filters"><label class="context-picker"><span>Tipo</span><select class="context-view-select" id="rt-ct"><option value="">Trabajados y tomados</option><option value="work">Solo trabajados</option><option value="take">Solo tomados</option><option value="adj">Solo ajustes</option></select></label><label class="context-picker"><span>Persona</span><select class="context-view-select" id="rt-cf"></select></label></div></div>
    <div id="rt-comp-list"></div>
  </div>

  <div id="rt-set" class="rt-sub" hidden>
    <div class="section-header"><div class="section-title">CONFIGURACIÓN</div></div>
    <div class="card" id="rt-set-card"></div>
  </div>
</div>`;
}

const $ = s => root.querySelector(s);
const $$ = s => [...root.querySelectorAll(s)];

/* ══ MODAL ══ */
let modalEl;
function ensureModal() {
  if (modalEl) return;
  modalEl = document.createElement('div');
  modalEl.className = 'modal-overlay'; modalEl.style.display = 'none';
  modalEl.innerHTML = `<div class="modal-parte"><div class="modal-header"><div class="modal-title" id="rt-mt"></div><button class="btn-logout" type="button" data-rt-close>CERRAR</button></div><div class="modal-body" id="rt-mb"></div></div>`;
  document.body.appendChild(modalEl);
  modalEl.addEventListener('click', e => { if (e.target === modalEl || e.target.closest('[data-rt-close]')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}
function openModal(title, html) {
  ensureModal();
  modalEl.querySelector('#rt-mt').textContent = title;
  modalEl.querySelector('#rt-mb').innerHTML = html;
  modalEl.style.display = 'flex';
  const f = modalEl.querySelector('input:not([type=checkbox]), select'); if (f) setTimeout(() => f.focus(), 30);
}
function closeModal() { if (modalEl) { modalEl.style.display = 'none'; modalEl.querySelector('#rt-mb').innerHTML = ''; } }
const M = s => modalEl.querySelector(s);

/* ══ CALENDARIO ══ */
function monthRows() {
  const mid = new Date(cur.getFullYear(), cur.getMonth(), 15);
  return state.people.map(p => {
    const gid = groupAt(p, mid), g = state.groups.find(x => x.id === gid);
    return { p, gid: gid || '', gname: g?.name || '' };
  });
}
function renderCal() {
  const lbl = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(cur);
  $('#rt-month').textContent = lbl.charAt(0).toUpperCase() + lbl.slice(1);
  const table = $('#rt-table');

  if (!loaded) { fillFilters([]); table.innerHTML = '<tbody><tr><td class="rt-empty">Cargando rotación…</td></tr></tbody>'; return; }
  if (!state.people.length) {
    fillFilters([]);
    table.innerHTML = `<tbody><tr><td class="rt-empty">${canEdit
      ? 'Todavía no hay personas cargadas.<br><br><button class="btn btn-sm" id="rt-seed" type="button">CARGAR LOS 3 GRUPOS DE MANTENIMIENTO</button><br><span class="rt-small">o agregalas a mano en la vista PERSONAS</span>'
      : 'Todavía no hay una rotación cargada. Lo carga Administración.'}</td></tr></tbody>`;
    return;
  }
  const rows = monthRows();
  fillFilters(rows);
  const gf = $('#rt-fg').value, pf = $('#rt-fp').value, today = dk(new Date());
  const ds = daysOf(cur.getFullYear(), cur.getMonth());
  const list = rows.filter(r => (!pf || r.p.id === pf) && (!gf || r.gid === gf));

  let h = '<thead><tr><th class="rt-sticky rt-n">Persona</th>';
  ds.forEach(d => {
    const wd = new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(d).replace('.', '');
    h += `<th class="${isWeekend(d) ? 'rt-we' : ''} ${dk(d) === today ? 'rt-today-col' : ''}">${d.getDate()}<small>${esc(wd)}</small></th>`;
  });
  h += '</tr></thead><tbody>';
  let last = null;
  list.forEach(({ p, gid, gname }) => {
    if (gid !== last) { h += `<tr class="rt-group"><td colspan="${ds.length + 1}">${esc(gname || 'Fuera de rotación / sin grupo')}</td></tr>`; last = gid; }
    const badge = p.mode === 'fijo' ? 'FIJO' : p.mode === 'fuera_rotacion' ? 'F/R' : '';
    h += `<tr><td class="rt-sticky rt-n rt-person" ${p.role ? `title="${esc(p.role)}"` : ''}>${esc(p.name)}${badge ? `<span class="rt-mini">${badge}</span>` : ''}${p.role ? `<span class="rt-mini rt-role">${esc(p.role)}</span>` : ''}</td>`;
    ds.forEach(d => {
      const a = assignment(p, d);
      h += `<td class="rt-cell ${esc(a[2])} ${a[3] ? 'rt-custom' : ''} ${isWeekend(d) ? 'rt-we' : ''} ${canEdit ? 'rt-edit' : ''}" ${canEdit ? `data-p="${esc(p.id)}" data-d="${dk(d)}"` : ''} title="${esc(a[1])}"><span class="rt-l">${esc(a[1])}</span><span class="rt-s">${esc(SHORT[a[0]] || a[0])}</span></td>`;
    });
    h += '</tr>';
  });
  if (!list.length) h += `<tr><td class="rt-empty" colspan="${ds.length + 1}">Sin resultados para los filtros elegidos.</td></tr>`;
  table.innerHTML = h + '</tbody>';
}
function fillFilters(rows) {
  const g = $('#rt-fg'), p = $('#rt-fp'), gv = g.value, pv = p.value;
  const groups = [...new Map(rows.filter(r => r.gid).map(r => [r.gid, r.gname])).entries()];
  g.innerHTML = '<option value="">Todos los grupos</option>' + groups.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
  p.innerHTML = '<option value="">Todas las personas</option>' + rows.map(r => `<option value="${esc(r.p.id)}">${esc(r.p.name)}</option>`).join('');
  g.value = gv; p.value = pv;
}

/* ══ PERSONAS ══ */
function renderPeople() {
  $('#rt-people-list').innerHTML = state.people.map(p => {
    const g = state.groups.find(q => q.id === p.group);
    return `<article><div class="rt-ct"><div><h3>${esc(p.name)}</h3><p>${p.mode === 'fijo' ? 'Horario fijo' : p.mode === 'fuera_rotacion' ? 'Fuera de rotación · sin grupo' : 'Rotación del grupo'}</p></div><span class="rt-pill">${esc(g?.name || 'Sin grupo')}</span></div>
      <div class="rt-meta">${esc(p.mode === 'fijo' ? p.fixed : p.mode === 'fuera_rotacion' ? 'Sin grupo / fuera de rotación' : 'Mañana → Noche → Tarde')}${p.role ? `<br>Función: ${esc(p.role)}` : ''}<br>Compensatorios a favor: <b>${fmtDays(compBalance(p.id).saldo)}</b>${p.mode === 'rotativo' ? SHIFTS.filter(t => isCustom(p, t)).map(t => `<br>${t}: ${esc(p.hours[t])} <span class="rt-small">(general ${esc(state.hours[t])})</span>`).join('') : ''}</div>
      <div class="rt-actions"><button class="rt-btn" data-act="edit-person" data-id="${esc(p.id)}">EDITAR</button><button class="rt-btn rt-danger" data-act="del-person" data-id="${esc(p.id)}">ELIMINAR</button></div></article>`;
  }).join('') || '<div class="rt-emptybox">No hay personas.</div>';
}
function editPerson(id) {
  const p = state.people.find(q => q.id === id);
  openModal(p ? 'Editar persona' : 'Nueva persona', `<form id="rt-pf">
    <div class="field"><label>Nombre</label><input type="text" name="name" required value="${esc(p?.name || '')}"></div>
    <div class="field"><label>Grupo</label><select name="group"><option value="">Sin grupo</option>${state.groups.map(g => `<option value="${esc(g.id)}" ${g.id === p?.group ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Modalidad</label><select name="mode">
      <option value="rotativo" ${p?.mode === 'rotativo' || !p ? 'selected' : ''}>Rotación del grupo</option>
      <option value="fijo" ${p?.mode === 'fijo' ? 'selected' : ''}>Horario fijo</option>
      <option value="fuera_rotacion" ${p?.mode === 'fuera_rotacion' ? 'selected' : ''}>Fuera de rotación · sin grupo</option></select></div>
    <div class="field rt-fixed"><label>Horario fijo</label><input type="text" name="fixed" value="${esc(p?.fixed || '')}" placeholder="08:00 - 16:00"></div>
    <div class="field"><label>Función (opcional)</label><input type="text" name="role" value="${esc(p?.role || '')}" placeholder="Ej.: Arranque de máquinas"></div>
    <div class="rt-own">
      <div class="field" style="margin-bottom:6px"><label>Horarios propios (opcional)</label></div>
      <p class="rt-small" style="margin:0 0 10px">Dejalos vacíos para usar el horario general del turno. Sirve para quien entra antes que el resto del grupo.</p>
      <div class="rt-two">${SHIFTS.map((t, i) => `<div class="field"><label>${t} <span class="rt-small">(general ${esc(state.hours[t])})</span></label><input type="text" name="own${i}" value="${esc(p?.hours?.[t] || '')}" placeholder="${esc(state.hours[t])}"></div>`).join('')}</div>
      <div class="rt-two" style="align-items:end"><div class="field"><label>Entra antes (horas)</label><input type="number" name="early" min="0" max="12" step="0.5" placeholder="2"></div><div class="field"><button type="button" class="btn btn-outline btn-sm" id="rt-early-apply">APLICAR A LOS 3 TURNOS</button></div></div>
    </div>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR PERSONA</button></div></form>`);
  const f = M('#rt-pf'), fix = f.querySelector('.rt-fixed');
  const own = f.querySelector('.rt-own');
  const sync = () => { fix.style.display = f.elements.mode.value === 'fijo' ? '' : 'none'; own.style.display = f.elements.mode.value === 'rotativo' ? '' : 'none'; };
  f.elements.mode.onchange = sync; sync();
  M('#rt-early-apply').onclick = () => {
    const h = parseFloat(f.elements.early.value);
    if (!(h > 0)) { toast('Ingresá cuántas horas antes entra', true); return; }
    SHIFTS.forEach((t, i) => { f.elements['own' + i].value = shiftStart(state.hours[t], h); });
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const m = f.elements.mode.value;
    const o = { id: p?.id || 'p' + Date.now(), name: f.elements.name.value.trim(), group: m === 'fuera_rotacion' ? '' : f.elements.group.value, mode: m, fixed: m === 'fijo' ? f.elements.fixed.value.trim() : '', role: f.elements.role.value.trim(), hours: {} };
    if (m === 'rotativo') SHIFTS.forEach((t, i) => { const v = f.elements['own' + i].value.trim(); if (v && v !== state.hours[t]) o.hours[t] = v; });
    if (p) Object.assign(p, o); else state.people.push(o);
    closeModal(); await save(); renderAll();
  };
}
async function deletePerson(id) {
  const p = state.people.find(q => q.id === id);
  if (!p || !confirm(`¿Eliminar a ${p.name}?`)) return;
  state.people = state.people.filter(q => q.id !== id);
  state.exceptions = state.exceptions.filter(e => e.person !== id);
  state.compAdj = state.compAdj.filter(a => a.person !== id);
  await save(); renderAll();
}

/* ══ GRUPOS ══ */
function renderGroups() {
  $('#rt-group-list').innerHTML = state.groups.map(g => {
    const ms = state.people.filter(p => p.group === g.id);
    return `<article><div class="rt-ct"><div><h3>${esc(g.name)}</h3><p>${g.fixedShift ? 'Turno fijo · ' + esc(g.fixedShift) : 'Inicio · ' + esc(state.rotation[g.start])}</p></div><span class="rt-pill">${ms.length} integrante${ms.length === 1 ? '' : 's'}</span></div>
      <div class="rt-meta">Secuencia: Mañana → Noche → Tarde</div>
      <div class="rt-members">${ms.map(p => `<span>${esc(p.name)}</span>`).join('') || '<span>Sin integrantes</span>'}</div>
      <div class="rt-actions"><button class="rt-btn" data-act="edit-group" data-id="${esc(g.id)}">EDITAR GRUPO</button><button class="rt-btn rt-danger" data-act="del-group" data-id="${esc(g.id)}">ELIMINAR</button></div></article>`;
  }).join('') || '<div class="rt-emptybox">No hay grupos.</div>';
}
function editGroup(id) {
  const g = state.groups.find(q => q.id === id);
  openModal(g ? 'Editar grupo' : 'Nuevo grupo', `<form id="rt-gf">
    <div class="field"><label>Nombre</label><input type="text" name="name" required value="${esc(g?.name || '')}"></div>
    <div class="field"><label>Modalidad</label><select name="kind"><option value="rot" ${g?.fixedShift ? '' : 'selected'}>Rotativo</option><option value="fix" ${g?.fixedShift ? 'selected' : ''}>Turno fijo</option></select></div>
    <div class="field rt-rot"><label>Inicio de la rotación</label><select name="start">${SHIFTS.map((t, i) => `<option value="${i}" ${g?.start === i ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="field rt-fix" style="display:none"><label>Turno fijo</label><select name="shift">${['Mañana', 'Tarde', 'Noche'].map(t => `<option ${t === g?.fixedShift ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="field"><label>Integrantes</label><div class="rt-checks">${state.people.map(p => `<label class="rt-check"><input type="checkbox" name="m" value="${esc(p.id)}" ${g && p.group === g.id ? 'checked' : ''}>${esc(p.name)}</label>`).join('') || 'No hay personas.'}</div></div>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR GRUPO</button></div></form>`);
  const f = M('#rt-gf');
  const sync = () => { const z = f.elements.kind.value === 'fix'; f.querySelector('.rt-rot').style.display = z ? 'none' : ''; f.querySelector('.rt-fix').style.display = z ? '' : 'none'; };
  f.elements.kind.onchange = sync; sync();
  f.onsubmit = async e => {
    e.preventDefault();
    const fix = f.elements.kind.value === 'fix';
    const o = { id: g?.id || 'g' + Date.now(), name: f.elements.name.value.trim(), start: +f.elements.start.value, fixedShift: fix ? f.elements.shift.value : '' };
    if (g) Object.assign(g, o); else state.groups.push(o);
    const sel = [...f.querySelectorAll('[name="m"]:checked')].map(i => i.value);
    state.people.forEach(p => {
      if (sel.includes(p.id)) p.group = o.id;
      else if (p.group === o.id) { p.group = ''; if (p.mode === 'rotativo') p.mode = 'fuera_rotacion'; }
    });
    closeModal(); await save(); renderAll();
  };
}
async function deleteGroup(id) {
  const g = state.groups.find(q => q.id === id);
  if (!g || !confirm(`¿Eliminar ${g.name}?`)) return;
  state.groups = state.groups.filter(q => q.id !== id);
  state.people.forEach(p => { if (p.group === id) { p.group = ''; p.mode = 'fuera_rotacion'; } });
  await save(); renderAll();
}

/* ══ EXCEPCIONES ══ */
function renderEx() {
  const list = [...state.exceptions].sort((a, b) => b.start.localeCompare(a.start));
  $('#rt-ex-list').innerHTML = list.map(e => {
    const p = state.people.find(q => q.id === e.person);
    const v = e.type === 'cambio_grupo' ? (state.groups.find(g => g.id === e.value)?.name || e.value) : (e.type === 'cambio_turno' || e.type === 'trabajo_franco') ? e.value : e.type === 'otro' ? e.note : '';
    return `<div class="rt-ex"><b>${esc(p?.name || '—')}</b><span class="rt-ex-type">${esc(EX_NAMES[e.type] || e.type)}</span><span class="rt-ex-date">${e.start}${e.end !== e.start ? ' → ' + e.end : ''}</span><span>${esc(v)} ${esc(e.type === 'otro' ? '' : e.note || '')}</span><div class="rt-actions" style="margin:0"><button class="rt-btn" data-act="edit-ex" data-id="${esc(e.id)}">EDITAR</button><button class="rt-btn rt-danger" data-act="del-ex" data-id="${esc(e.id)}">ELIMINAR</button></div></div>`;
  }).join('') || '<div class="rt-emptybox">No hay excepciones.</div>';
}
function editEx(id, preType) {
  const e = id ? state.exceptions.find(q => q.id === id) : null;
  if (!state.people.length) { toast('Primero cargá al menos una persona', true); return; }
  openModal(e ? 'Editar excepción' : 'Nueva excepción', `<form id="rt-ef">
    <div class="field"><label>Persona</label><select name="person">${state.people.map(p => `<option value="${esc(p.id)}" ${p.id === e?.person ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Tipo</label><select name="type">${Object.entries(EX_NAMES).map(([k, v]) => `<option value="${k}" ${k === (e?.type || preType) ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="rt-two"><div class="field"><label>Desde</label><input type="date" name="start" required value="${e?.start || ''}"></div><div class="field"><label>Hasta</label><input type="date" name="end" required value="${e?.end || ''}"></div></div>
    <div class="field rt-val" style="display:none"><label id="rt-vl">Turno</label><select name="value"></select></div>
    <div class="field rt-other" style="display:none"><label>Detalle de “Otro”</label><input type="text" name="otherText" value="${e?.type === 'otro' ? esc(e.note || '') : ''}" placeholder="Escribí el motivo o estado"></div>
    <div class="field"><label>Observación</label><textarea name="note" rows="3">${e?.type !== 'otro' ? esc(e?.note || '') : ''}</textarea></div>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR</button></div></form>`);
  const f = M('#rt-ef'), val = f.querySelector('.rt-val'), other = f.querySelector('.rt-other');
  const sync = () => {
    const t = f.elements.type.value, grp = t === 'cambio_grupo', turn = t === 'cambio_turno' || t === 'trabajo_franco';
    val.style.display = (grp || turn) ? '' : 'none'; other.style.display = t === 'otro' ? '' : 'none';
    M('#rt-vl').textContent = grp ? 'Grupo' : 'Turno';
    f.elements.value.innerHTML = grp
      ? state.groups.map(g => `<option value="${esc(g.id)}" ${g.id === e?.value ? 'selected' : ''}>${esc(g.name)}</option>`).join('')
      : SHIFTS.map(s => `<option ${s === e?.value ? 'selected' : ''}>${s}</option>`).join('');
  };
  f.elements.type.onchange = sync; sync();
  f.onsubmit = async ev => {
    ev.preventDefault();
    if (f.elements.end.value < f.elements.start.value) { toast('La fecha Hasta no puede ser anterior a Desde', true); return; }
    const t = f.elements.type.value;
    const o = { id: e?.id || 'e' + Date.now(), person: f.elements.person.value, type: t, start: f.elements.start.value, end: f.elements.end.value,
      value: val.style.display === 'none' ? '' : f.elements.value.value, note: t === 'otro' ? f.elements.otherText.value.trim() : f.elements.note.value.trim() };
    const snap = JSON.stringify(state.exceptions);
    if (e) Object.assign(e, o); else state.exceptions.push(o);
    if (!okSaldo(t, o.person, snap)) return;
    closeModal(); await save(); renderAll();
  };
}
// Si el compensatorio deja el saldo en negativo, pedir confirmación (si no, se revierte el cambio)
function okSaldo(type, pid, snap) {
  if (type !== 'compensatorio') return true;
  const s = compBalance(pid).saldo;
  if (s >= 0) return true;
  const nom = state.people.find(q => q.id === pid)?.name || 'La persona';
  if (confirm(`${nom} no tiene compensatorios a favor suficientes (saldo quedaría en ${fmtDays(s)}). ¿Marcarlo igual?`)) return true;
  state.exceptions = JSON.parse(snap);
  return false;
}
async function deleteEx(id) {
  if (!confirm('¿Eliminar esta excepción?')) return;
  state.exceptions = state.exceptions.filter(e => e.id !== id);
  await save(); renderAll();
}

/* ══ EDITAR UN DÍA ══ */
function dayEdit(pid, date) {
  const p = state.people.find(q => q.id === pid); if (!p) return;
  const ex = state.exceptions.find(q => q.person === pid && q.start === date && q.end === date && q.type !== 'cambio_grupo');
  openModal(`${p.name} · ${date}`, `<form id="rt-df">
    <div class="rt-preview"><span>Asignación actual</span><strong>${esc(assignment(p, pd(date))[1])}</strong></div>
    <div class="field"><label>Estado del día</label><select name="type"><option value="none">Usar asignación automática</option>${Object.entries(EX_NAMES).filter(([k]) => k !== 'cambio_grupo').map(([k, v]) => `<option value="${k}" ${k === ex?.type ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field rt-turn" style="display:none"><label>Turno</label><select name="value">${SHIFTS.map(t => `<option ${t === ex?.value ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="field rt-other" style="display:none"><label>Detalle de “Otro”</label><input type="text" name="otherText" value="${ex?.type === 'otro' ? esc(ex.note || '') : ''}" placeholder="Escribí el motivo o estado"></div>
    <div class="field"><label>Observación</label><input type="text" name="note" value="${ex?.type !== 'otro' ? esc(ex?.note || '') : ''}"></div>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR</button></div></form>`);
  const f = M('#rt-df');
  const sync = () => { f.querySelector('.rt-turn').style.display = (f.elements.type.value === 'cambio_turno' || f.elements.type.value === 'trabajo_franco') ? '' : 'none'; f.querySelector('.rt-other').style.display = f.elements.type.value === 'otro' ? '' : 'none'; };
  f.elements.type.onchange = sync; sync();
  f.onsubmit = async ev => {
    ev.preventDefault();
    const t = f.elements.type.value;
    const snap = JSON.stringify(state.exceptions);
    state.exceptions = state.exceptions.filter(q => !(q.person === pid && q.start === date && q.end === date && q.type !== 'cambio_grupo'));
    if (t !== 'none') state.exceptions.push({ id: 'e' + Date.now(), person: pid, type: t, start: date, end: date, value: (t === 'cambio_turno' || t === 'trabajo_franco') ? f.elements.value.value : '', note: t === 'otro' ? f.elements.otherText.value.trim() : f.elements.note.value.trim() });
    if (!okSaldo(t, pid, snap)) return;
    closeModal(); await save(); renderAll();
  };
}

/* ══ VISTA COMPENSATORIOS ══ */
function renderComp() {
  const sel = $('#rt-cf'); if (!sel) return;
  const fv = sel.value;
  sel.innerHTML = '<option value="">Todas las personas</option>' + state.people.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.value = fv;
  $('#rt-comp-bal').innerHTML = state.people.map(p => {
    const b = compBalance(p.id);
    return `<article class="rt-balcard ${b.saldo < 0 ? 'neg' : b.saldo > 0 ? 'pos' : ''}"><div class="rt-bal-n">${esc(p.name)}</div><div class="rt-bal-v">${fmtDays(b.saldo)}</div><div class="rt-bal-l">saldo a favor</div>
      <div class="rt-bal-row"><span class="up">Trabajados <b>${fmtDays(b.earned)}</b></span><span class="down">Tomados <b>${fmtDays(b.taken)}</b></span></div>${b.adj ? `<div class="rt-bal-s">Ajuste ${b.adj > 0 ? '+' : '−'}${fmtDays(Math.abs(b.adj))}</div>` : ''}</article>`;
  }).join('') || '<div class="rt-emptybox">No hay personas.</div>';
  const tf = $('#rt-ct').value;
  const kindOf = x => x.kind === 'adj' ? 'adj' : x.days > 0 ? 'work' : 'take';
  const list = compMoves().filter(x => (!sel.value || x.person === sel.value) && (!tf || kindOf(x) === tf)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#rt-comp-list').innerHTML = list.map(x => {
    const p = state.people.find(q => q.id === x.person);
    const n = Math.abs(x.days), sign = x.days >= 0 ? '+' : '−';
    const act = x.kind === 'adj' ? ['edit-adj', 'del-adj'] : ['edit-ex', 'del-ex'];
    return `<div class="rt-ex"><b>${esc(p?.name || '—')}</b><span class="rt-ex-type"><i class="rt-tag ${kindOf(x)}">${kindOf(x) === 'work' ? 'TRABAJADO' : kindOf(x) === 'take' ? 'TOMADO' : 'AJUSTE'}</i></span><span class="rt-ex-date">${esc(x.date || '—')}${x.end && x.end !== x.date ? ' → ' + x.end : ''}</span><span><b class="rt-mv ${x.days >= 0 ? 'up' : 'down'}">${sign}${fmtDays(n)}</b> ${esc(x.note)}</span><div class="rt-actions" style="margin:0"><button class="rt-btn" data-act="${act[0]}" data-id="${esc(x.id)}">EDITAR</button><button class="rt-btn rt-danger" data-act="${act[1]}" data-id="${esc(x.id)}">ELIMINAR</button></div></div>`;
  }).join('') || '<div class="rt-emptybox">Todavía no hay movimientos de compensatorios.</div>';
}
function editAdj(id) {
  const a = id ? state.compAdj.find(q => q.id === id) : null;
  if (!state.people.length) { toast('Primero cargá al menos una persona', true); return; }
  openModal(a ? 'Editar ajuste' : 'Ajuste / saldo inicial', `<form id="rt-af">
    <div class="field"><label>Persona</label><select name="person">${state.people.map(p => `<option value="${esc(p.id)}" ${p.id === a?.person ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="rt-two"><div class="field"><label>Días (positivo suma, negativo resta)</label><input type="number" name="days" step="0.5" required value="${a ? a.days : ''}" placeholder="Ej.: 3"></div><div class="field"><label>Fecha</label><input type="date" name="date" required value="${a?.date || dk(new Date())}"></div></div>
    <div class="field"><label>Motivo</label><input type="text" name="note" value="${esc(a?.note || '')}" placeholder="Ej.: Saldo inicial / corrección"></div>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR</button></div></form>`);
  const f = M('#rt-af');
  f.onsubmit = async ev => {
    ev.preventDefault();
    const days = parseFloat(f.elements.days.value);
    if (!Number.isFinite(days) || days === 0) { toast('Ingresá una cantidad de días distinta de cero', true); return; }
    const o = { id: a?.id || 'a' + Date.now(), person: f.elements.person.value, days, date: f.elements.date.value, note: f.elements.note.value.trim() };
    if (a) Object.assign(a, o); else state.compAdj.push(o);
    closeModal(); await save(); renderAll();
  };
}
async function deleteAdj(id) {
  if (!confirm('¿Eliminar este ajuste?')) return;
  state.compAdj = state.compAdj.filter(a => a.id !== id);
  await save(); renderAll();
}

/* ══ CONFIGURACIÓN ══ */
function renderSet() {
  const r = state.rotation;
  $('#rt-set-card').innerHTML = `<div class="rt-set-grid">
    <div><div class="card-title">Secuencia de rotación</div><div class="rt-seq">${r.map((x, i) => `<span>${i + 1}. ${esc(x)}</span>`).join('')}</div>
    <p class="rt-small" style="margin-top:12px">Cada semana el grupo avanza al siguiente turno de la secuencia. La semana de noche empieza el domingo y el sábado no hay turno noche (descanso). Los domingos no vienen el turno tarde ni los horarios fijos.</p></div>
    <form id="rt-sf"><div class="field"><label>Inicio del ciclo (un lunes)</label><input type="date" name="cycle" value="${esc(state.cycleStart)}"></div>
    <div class="rt-two">${r.map((x, i) => `<div class="field"><label>${esc(x)}</label><input type="text" name="h${i}" value="${esc(state.hours[x])}"></div>`).join('')}</div>
    <button class="btn btn-green" type="submit">GUARDAR CONFIGURACIÓN</button></form></div>`;
  $('#rt-sf').onsubmit = async e => {
    e.preventDefault();
    const f = $('#rt-sf');
    state.cycleStart = f.elements.cycle.value || state.cycleStart;
    r.forEach((x, i) => { state.hours[x] = f.elements['h' + i].value.trim(); });
    await save('✓ Configuración guardada'); renderAll();
  };
}

/* ══ CARGA INICIAL: los 3 equipos de Parte Diario ══ */
async function seedTeams() {
  if (!confirm('Se van a cargar los 3 grupos de mantenimiento con sus integrantes. ¿Continuar?')) return;
  state = normalize({
    groups: [
      { id: 'g1', name: 'Grupo 1', start: 0, fixedShift: '' },
      { id: 'g2', name: 'Grupo 2', start: 1, fixedShift: '' },
      { id: 'g3', name: 'Grupo 3', start: 2, fixedShift: '' }
    ],
    people: [
      ['Cappelletti', 'g1'], ['Ledesma', 'g1'], ['Piedra', 'g2'], ['Liway', 'g2'], ['Vidal', 'g3'], ['Girard', 'g3']
    ].map(([name, group]) => ({ id: 'p_' + name.toLowerCase(), name, group, mode: 'rotativo', fixed: '' }))
  });
  await save('✓ Grupos cargados'); renderAll();
}

function renderAll() {
  if (!root) return;
  renderCal(); renderPeople(); renderGroups(); renderEx(); renderComp(); renderSet();
  $('#rt-badge').textContent = canEdit ? 'EDICIÓN' : 'SOLO LECTURA';
}

/* ══ LOGIN (igual que Calidad: rol + usuario + contraseña) ══ */
const byId = id => document.getElementById(id);

function doLogin() {
  const username = byId('login-user').value.trim();
  const password = byId('login-pass').value.trim();
  const rolSeleccionado = byId('login-role').value;
  if (!rolSeleccionado)       { toast('Seleccioná un rol', true); return; }
  if (!username || !password) { toast('Ingresá usuario y contraseña', true); return; }
  const u = buscarUsuario(username);
  if (!u || u.password !== password) { toast('Usuario o contraseña incorrectos', true); return; }
  if (u.role !== rolSeleccionado)    { toast(`Este usuario es "${u.role}"`, true); return; }

  user = { nombre: u.nombre, role: u.role };
  canEdit = u.role === 'admin';
  byId('screen-login').style.display = 'none';
  byId('screen-main').style.cssText = 'display:flex;flex-direction:column;min-height:100vh;width:100%';
  applyMode(); renderAll(); subscribe();
}

function doLogout() {
  if (unsub) { unsub(); unsub = null; }
  closeModal();
  user = null; canEdit = false; loaded = false; docExists = false;
  state = emptyState(); cur = startOfMonth(new Date());
  applyMode(); renderAll();
  byId('screen-main').style.display = 'none';
  byId('screen-login').style.display = 'flex';
  byId('login-user').value = ''; byId('login-pass').value = ''; byId('login-role').value = '';
}

/* ══ MODO (edición / solo lectura) ══ */
function applyMode() {
  byId('hb-tag').textContent = canEdit ? 'ADMIN' : 'VISUALIZADOR';
  byId('hb-tag').className = 'role-tag ' + (canEdit ? 'edit' : 'vis');
  byId('hb-user').textContent = user ? user.nombre : '';
  $('#rt-viewbar').style.display = canEdit ? '' : 'none';
  $('#rt-hint').textContent = canEdit
    ? 'Hacé clic en una celda para modificar ese día. Los cambios los ven todos al instante.'
    : 'Solo lectura. La rotación la administra Administración.';
  $('#rt-add-person').style.display = $('#rt-add-group').style.display = $('#rt-add-ex').style.display = canEdit ? '' : 'none';
  if (!canEdit) {   // volver al calendario
    const v = $('#rt-view');
    if (v.value !== 'rt-cal') { v.value = 'rt-cal'; v.dispatchEvent(new Event('change')); }
  }
}

/* ══ DATOS EN TIEMPO REAL ══ */
function subscribe() {
  if (unsub) unsub();
  unsub = onSnapshot(ref, snap => {
    docExists = snap.exists();
    state = normalize(snap.exists() ? snap.data() : null);
    loaded = true; renderAll();
  }, err => {
    console.error(err);
    loaded = true;
    toast(err.code === 'permission-denied'
      ? 'Firestore no permite leer la colección "planning" (revisá las reglas)'
      : 'Error al cargar la rotación (' + err.message + ')', true);
    renderAll();
  });
}

/* ══ ARRANQUE ══ */
function init() {
  root = document.getElementById('tab-planning');
  root.innerHTML = panelHTML();

  $('#rt-view').addEventListener('change', e => {
    $$('.rt-sub').forEach(s => { s.hidden = s.id !== e.target.value; });
    const t = e.target.options[e.target.selectedIndex].textContent;
    $('#rt-title').textContent = t.charAt(0) + t.slice(1).toLowerCase();
  });
  $('#rt-prev').onclick = () => { cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1); renderCal(); };
  $('#rt-next').onclick = () => { cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); renderCal(); };
  $('#rt-today').onclick = () => { cur = startOfMonth(new Date()); renderCal(); };
  $('#rt-fg').onchange = renderCal; $('#rt-fp').onchange = renderCal;
  root.addEventListener('click', e => {
    if (e.target.closest('#rt-seed')) { seedTeams(); return; }
    const cell = e.target.closest('td.rt-cell[data-p]');
    if (cell && canEdit) { dayEdit(cell.dataset.p, cell.dataset.d); return; }
    const b = e.target.closest('[data-act]');
    if (!b || !canEdit) return;
    const id = b.dataset.id;
    ({ 'edit-person': () => editPerson(id), 'del-person': () => deletePerson(id), 'edit-group': () => editGroup(id),
       'del-group': () => deleteGroup(id), 'edit-ex': () => editEx(id), 'del-ex': () => deleteEx(id),
       'edit-adj': () => editAdj(id), 'del-adj': () => deleteAdj(id) })[b.dataset.act]?.();
  });
  $('#rt-add-person').onclick = () => editPerson();
  $('#rt-add-group').onclick = () => editGroup();
  $('#rt-add-ex').onclick = () => editEx();
  $('#rt-add-extra').onclick = () => editEx(null, 'trabajo_franco');
  $('#rt-add-take').onclick = () => editEx(null, 'compensatorio');
  $('#rt-add-adj').onclick = () => editAdj();
  $('#rt-cf').onchange = renderComp; $('#rt-ct').onchange = renderComp;

  ['login-user', 'login-pass'].forEach(id => byId(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));
  byId('login-btn').addEventListener('click', doLogin);
  byId('btn-logout').addEventListener('click', doLogout);

  applyMode(); renderAll();
}

init();
