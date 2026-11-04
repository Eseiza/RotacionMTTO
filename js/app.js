/* ══════════════════════════════════════════════════════════
   ROTACIÓN DE MANTENIMIENTO — Romero Panificados
   App individual. Firestore: planning / config
   La edición se habilita por rol en la interfaz; el resto ve en solo lectura.
══════════════════════════════════════════════════════════ */
import { collection, doc, onSnapshot, orderBy, query, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { db, COL, DOC_ID, buscarUsuario } from "./firebase.js";

const ref = doc(db, COL, DOC_ID);

const EX_NAMES = {
  vacaciones: 'Vacaciones', compensatorio: 'Compensatorio (día tomado)', trabajo_franco: 'Trabajó día libre (suma compensatorio)', cambio_turno: 'Cambio de turno',
  cambio_grupo: 'Cambio de grupo', fuera_rotacion: 'Fuera de rotación',
  licencia_medica: 'Ausente por licencia médica', otro: 'Otro'
};
const DEFAULT_SHIFTS = ['Mañana', 'Tarde', 'Noche'];
const SHIFTS = [...DEFAULT_SHIFTS];   // lista viva: se rearma en normalize() con los turnos guardados (se pueden agregar y quitar)
const setShifts = l => { SHIFTS.length = 0; SHIFTS.push(...l); };
const SHORT = { M: 'M', T: 'T', N: 'N', VAC: 'V', COMP: 'C', EXT: '+', CAM: '↔', LIC: 'L', FIJO: 'F', DESC: 'D', 'F/R': '–', OTRO: '•' };   // etiqueta corta para celular
const WEEK = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [0, 'Dom']];   // [getDay(), nombre]
const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];

const esc = x => String(x ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const dk = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pd = s => { const [y, m, d] = String(s || '').split('-').map(Number); return new Date(y, m - 1, d); };
const validDateKey = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && dk(pd(s)) === s;
const addDaysKey = (key, amount) => { const d = pd(key); d.setDate(d.getDate() + amount); return dk(d); };
const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;
// Quita un tramo de un registro sin perder los días anteriores o posteriores.
function subtractRange(records, personId, from, to, prefix = 'r') {
  const out = [];
  records.forEach(item => {
    const start = item.start, end = item.end || item.start;
    if (item.person !== personId || !rangesOverlap(start, end, from, to)) { out.push(item); return; }
    if (start < from) out.push({ ...item, end: addDaysKey(from, -1) });
    if (end > to) out.push({ ...item, id: `${prefix}${Date.now()}${out.length}`, start: addDaysKey(to, 1), end });
  });
  return out;
}
function removeSchedulesInRange(personId, from, to) {
  state.schedule = subtractRange(state.schedule, personId, from, to, 's');
}
function removeExceptionsOnDate(personId, date) {
  state.exceptions = subtractRange(state.exceptions.filter(e => e.type !== 'cambio_grupo'), personId, date, date, 'e')
    .concat(state.exceptions.filter(e => e.type === 'cambio_grupo'));
}
function stripWorkFreeSchedules(data) {
  let schedules = [...(data.schedule || [])];
  (data.exceptions || []).filter(e => e.type === 'trabajo_franco').forEach(e => {
    schedules = subtractRange(schedules, e.person, e.start, e.end || e.start, 's');
  });
  return schedules;
}
const daysOf = (y, m) => { const a = []; for (let d = new Date(y, m, 1); d.getMonth() === m; d.setDate(d.getDate() + 1)) a.push(new Date(d)); return a; };
const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

/* ══ HORAS ══ */
const toMin = s => { const m = /^\s*(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const fmtMin = n => { n = ((Math.round(n) % 1440) + 1440) % 1440; return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
// Corre una hora X horas hacia atrás (positivo = antes, negativo = después). Entrada y salida se corren igual → la duración no cambia.
const shiftTime = (t, early) => { const m = toMin(t); return m == null ? (t || '') : fmtMin(m - early * 60); };
const hoursLabel = (a, b, early = 0) => (a && b) ? `${shiftTime(a, early)} - ${shiftTime(b, early)}` : '';
const durHours = (a, b) => { const x = toMin(a), y = toMin(b); return (x == null || y == null) ? 0 : (((y - x) % 1440) + 1440) % 1440 / 60; };
// Sugerencia de turno según la hora de entrada (el usuario siempre puede cambiarlo)
const pickShift = n => SHIFTS.includes(n) ? n : SHIFTS[0];
const guessShift = t => { const m = toMin(t); if (m == null) return pickShift('Mañana'); const h = m / 60; return pickShift((h >= 4 && h < 12) ? 'Mañana' : (h >= 12 && h < 20) ? 'Tarde' : 'Noche'); };
const shiftCls = t => t === 'Mañana' ? 'mañana' : t === 'Tarde' ? 'tarde' : t === 'Noche' ? 'noche' : 'turno-x';
const shiftCode = t => t === 'Mañana' ? 'M' : t === 'Tarde' ? 'T' : t === 'Noche' ? 'N' : String(t || '?').slice(0, 2).toUpperCase();
const SHIFT_COLOR = { Mañana: '#f5b324', Tarde: '#ff6b57', Noche: '#60a5fa' };
const offFor = (p, t) => +(p?.offsets?.[t]) || 0;   // horas que se corre en ese turno (+ antes, − después)
const hasOff = p => SHIFTS.some(t => offFor(p, t));
const offTxt = h => !h ? '' : h > 0 ? `Entra ${fmtDays(h)} h antes` : `Entra ${fmtDays(-h)} h después`;
const daysTxt = p => WEEK.filter(([n]) => (p.days || []).includes(n)).map(([, l]) => l).join(' · ') || '—';
function prevText(a, b, off) {
  if (!a || !b) return '';
  const base = `${hoursLabel(a, b)} · ${fmtDays(durHours(a, b))} h`;
  return off ? `${base} → con corrimiento: ${hoursLabel(a, b, off)}` : base;
}

let root, canEdit = false, loaded = false, docExists = false, user = null, unsub = null, historyUnsub = null, migrationInFlight = false;
let state = emptyState();
let lastCommittedState = null;
let cur = startOfMonth(new Date());

function emptyState() {
  return {
    rotation: ['Mañana', 'Noche', 'Tarde'], history: [],
    cycleStart: '2026-09-28', weekStart: null, weekEnd: null, shifts: [...DEFAULT_SHIFTS], shiftDays: {}, groups: [], people: [], schedule: [], exceptions: [], compAdj: []
  };
}
// El horario fijo viejo era un texto "08:00 - 16:00"; ahora es {shift, in, out}
function migrateFixed(p) {
  const f = p.fixed;
  if (f && typeof f === 'object') return { shift: f.shift || '', in: f.in || '', out: f.out || '' };
  const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(f || '');
  if (!m) return { shift: '', in: '', out: '' };
  const i = fmtMin(+m[1] * 60 + +m[2]), o = fmtMin(+m[3] * 60 + +m[4]);
  return { shift: guessShift(i), in: i, out: o };
}
function cleanShiftHours(sh) {
  const o = {};
  SHIFTS.forEach(t => { const x = sh?.[t], days = [...new Set((Array.isArray(x?.days) ? x.days : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))]; if (x?.in && x?.out && days.length) o[t] = { days, in: x.in, out: x.out }; });
  return o;
}
// Días en que arranca / termina cada turno (0=Dom … 6=Sáb). Los turnos sin valores propios usan la semana base.
function cleanShiftDays(sd) {
  const o = {}, ok = n => Number.isInteger(n) && n >= 0 && n <= 6;
  SHIFTS.forEach(t => { const x = sd?.[t]; if (x && ok(x.start) && ok(x.end)) o[t] = { start: x.start, end: x.end }; });
  return o;
}
function normalize(s) {
  const base = emptyState();
  const data = s && typeof s === 'object' ? s : {};
  const storedShifts = [...new Set((Array.isArray(data.shifts) ? data.shifts : [])
    .map(value => String(value).trim()).filter(Boolean))];
  setShifts(storedShifts.length ? storedShifts : DEFAULT_SHIFTS);

  const oldRotation = Array.isArray(data.rotation) ? data.rotation : base.rotation;
  const validRotation = oldRotation.filter(turn => SHIFTS.includes(turn));
  const rotation = validRotation.length ? validRotation : [...base.rotation];
  const groups = (Array.isArray(data.groups) ? data.groups : []).map(group => ({
    id: group.id,
    name: String(group.name || ''),
    fixedShift: SHIFTS.includes(group.fixedShift) ? group.fixedShift : '',
    shiftHours: cleanShiftHours(group.shiftHours),
    startShift: [group.startShift, oldRotation[group.start]].find(turn => SHIFTS.includes(turn)) || rotation[0]
  }));
  const people = (Array.isArray(data.people) ? data.people : []).map(person => {
    const days = [...new Set((Array.isArray(person.days) ? person.days : [])
      .map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
    const fixed = migrateFixed(person);
    return {
      id: person.id,
      name: String(person.name || ''),
      group: person.group || '',
      mode: ['rotativo', 'fijo', 'fuera_rotacion'].includes(person.mode) ? person.mode : 'rotativo',
      role: person.role || '',
      fixed: SHIFTS.includes(fixed.shift) ? fixed : { shift: '', in: fixed.in, out: fixed.out },
      days: days.length ? days : [...DEFAULT_DAYS],
      offsets: Object.fromEntries(SHIFTS.map(turn => [turn,
        Math.max(-12, Math.min(12, Number(person.offsets?.[turn] ?? person.offset) || 0))]))
    };
  });
  const exceptions = (Array.isArray(data.exceptions) ? data.exceptions : [])
    .map(exception => exception.type === 'trabajo_franco' ? { ...exception, value: '' } : exception);
  const schedule = stripWorkFreeSchedules({
    schedule: Array.isArray(data.schedule) ? data.schedule : [],
    exceptions
  });

  return {
    rotation,
    cycleStart: validDateKey(data.cycleStart) ? data.cycleStart : base.cycleStart,
    weekStart: Number.isInteger(data.weekStart) && data.weekStart >= 0 && data.weekStart <= 6 ? data.weekStart : null,
    weekEnd: Number.isInteger(data.weekEnd) && data.weekEnd >= 0 && data.weekEnd <= 6 ? data.weekEnd : null,
    shifts: [...SHIFTS],
    shiftDays: cleanShiftDays(data.shiftDays),
    groups,
    people,
    schedule,
    exceptions,
    compAdj: Array.isArray(data.compAdj) ? data.compAdj : []
  };
}

/* ══ TOAST (el de Parte Diario) ══ */
let tt;
function toast(msg, err = false) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = `toast ${err ? 'err' : ''} show`;
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ══ REGLAS DE ROTACIÓN ══
   Automático: el turno que le toca a cada grupo cada semana (según el orden de rotación) y los compensatorios.
   Manual: la hora de entrada, la de salida y el turno de cada día (state.schedule).                         */
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
const worksOn = (p, d) => (p.days || []).includes(d.getDay());
// Día de la semana (0=Dom … 6=Sáb) en que arranca la semana de rotación; si no se eligió, el de la fecha de inicio del ciclo
const weekStartDay = () => Number.isInteger(state.weekStart) ? state.weekStart : pd(state.cycleStart).getDay();
// Día en que termina; si no se eligió, el anterior al de inicio (semana de 7 días)
const weekEndDay = () => Number.isInteger(state.weekEnd) ? state.weekEnd : (weekStartDay() + 6) % 7;
// ¿El día cae dentro de la semana de rotación (entre el día de inicio y el de fin)? Los que quedan afuera son descanso para el personal rotativo
const inRotWeek = d => ((d.getDay() - weekStartDay() + 7) % 7) < ((weekEndDay() - weekStartDay() + 7) % 7) + 1;
// Primer día de la semana 0: la fecha de inicio del ciclo, corrida hacia atrás hasta el día de inicio elegido
const rotAnchor = () => { const a = pd(state.cycleStart); a.setDate(a.getDate() - ((a.getDay() - weekStartDay() + 7) % 7)); return a; };
// Días en que arranca y termina la semana de cada turno (si el turno no tiene valores propios, usa la semana base)
const shiftWin = t => { const x = state.shiftDays?.[t]; return x ? { s: x.start, e: x.end } : { s: weekStartDay(), e: weekEndDay() }; };
const dayName = n => (WEEK.find(([k]) => k === n) || [0, '—'])[1];
// Turno cuya ventana (desde su día de inicio hasta su día de fin) incluye ese día para el grupo, o null si el día queda afuera (descanso).
// La rotación avanza de a bloques de 7 días anclados en la semana base; dentro de cada bloque, el turno rige entre SU día de inicio y SU día de fin.
function turnWindowAt(g, d) {
  const n = state.rotation.length; if (!g.fixedShift && !n) return null;
  const A = utcDay(rotAnchor()), D = utcDay(d), gs = weekStartDay();
  const w0 = Math.floor((D - A) / 604800000);
  const i0 = Math.max(0, state.rotation.indexOf(g.startShift));
  for (const w of [w0, w0 + 1, w0 - 1]) {   // también el bloque siguiente/anterior: un turno puede arrancar antes (o terminar después) que la semana base
    const t = g.fixedShift || state.rotation[(((w + i0) % n) + n) % n];
    const { s, e } = shiftWin(t);
    let off = (s - gs + 7) % 7; if (off > 3) off -= 7;   // su día de inicio más cercano al arranque del bloque
    const a = A + (w * 7 + off) * 86400000, len = ((e - s + 7) % 7) + 1;
    if (D >= a && D < a + len * 86400000) return t;
  }
  return null;
}
// Turno que le toca por la rotación automática (o null si no tiene o ese día queda fuera de la ventana del turno)
function rotShift(p, d) {
  if (p.mode === 'fuera_rotacion') return null;
  if (p.mode === 'fijo') return p.fixed?.shift || null;
  const g = state.groups.find(q => q.id === groupAt(p, d));
  return g ? turnWindowAt(g, d) : null;
}
// ¿El día cae dentro de la ventana de algún turno del grupo? Los que quedan afuera son descanso para el personal rotativo
function inWindow(p, d) {
  if (p.mode === 'fijo') return true;
  const g = state.groups.find(q => q.id === groupAt(p, d));
  return g ? !!turnWindowAt(g, d) : inRotWeek(d);
}
// Horario cargado a mano que aplica a ese día. Un rango solo vale en los días que la persona viene;
// un horario de un solo día vale siempre. Si hay varios, gana el más específico (rango más corto) y el más nuevo.
function schedAt(p, d) {
  const k = dk(d);
  const c = state.schedule.filter(s => s.person === p.id && k >= s.start && k <= s.end && (s.start === s.end || worksOn(p, d)));
  if (!c.length) return null;
  const span = s => utcDay(pd(s.end)) - utcDay(pd(s.start));
  c.sort((a, b) => span(a) - span(b) || String(b.id).localeCompare(String(a.id)));
  return c[0];
}
// Horario cargado para el turno del grupo (días de la semana + entrada y salida), si lo hay
function groupSched(p, d, t) {
  const g = state.groups.find(q => q.id === groupAt(p, d));
  const x = g?.shiftHours?.[t];
  return (x && x.in && x.out && x.days?.length) ? x : null;
}
// Horas que se corre la persona (positivo = entra antes). Cada horario puede ignorar el corrimiento.
const offsetOf = (p, s) => (!s || s.noOffset) ? 0 : offFor(p, s.shift);

// → [código, texto, clase css, ¿horario corrido?, ¿sin horario cargado?]
function assignment(p, d) {
  const e = exAt(p, d), s = schedAt(p, d);
  const off = offsetOf(p, s);
  const hrs = s ? hoursLabel(s.in, s.out, off) : '';
  const moved = !!hrs && off !== 0;
  if (e) {
    if (e.type === 'vacaciones') return ['VAC', 'Vacaciones', 'vac'];
    if (e.type === 'compensatorio') return ['COMP', 'Compensatorio', 'comp'];
    if (e.type === 'trabajo_franco') return ['EXT', 'Trabajó día libre', 'extra'];
    if (e.type === 'cambio_turno') return ['CAM', hrs || `Cambio · ${e.value}`, 'change', moved];
    if (e.type === 'fuera_rotacion') return ['F/R', 'Fuera de rotación', 'out'];
    if (e.type === 'licencia_medica') return ['LIC', 'Licencia médica', 'lic'];
    if (e.type === 'otro') return ['OTRO', e.note || 'Otro', 'other'];
  }
  if (p.mode === 'fuera_rotacion') return ['F/R', 'Fuera de rotación', 'out'];
  if (s) return [shiftCode(s.shift), hrs || s.shift, shiftCls(s.shift), moved];          // horario cargado a mano
  if (p.mode !== 'fijo' && !inWindow(p, d)) return ['DESC', 'Descanso', 'rest'];          // fuera de los días del turno (entre su día de fin y el de inicio)
  if (p.mode !== 'fijo') {                                                                 // horario del grupo para su turno de la semana
    const t = rotShift(p, d), gs = t && groupSched(p, d, t);
    if (gs) {
      if (!worksOn(p, d) || !gs.days.includes(d.getDay())) return ['DESC', 'Descanso', 'rest'];
      const o = offFor(p, t);
      return [shiftCode(t), hoursLabel(gs.in, gs.out, o), shiftCls(t), o !== 0];
    }
  }
  if (!worksOn(p, d)) return ['DESC', 'Descanso', 'rest'];                                // día de la semana que no viene
  if (p.mode === 'fijo') {
    const f = p.fixed || {}, fo = offFor(p, f.shift), h = hoursLabel(f.in, f.out, fo);
    return ['FIJO', h || f.shift || 'Horario fijo', 'fixed', !!h && fo !== 0, !h];
  }
  const t = rotShift(p, d);
  if (!t) return ['F/R', 'Fuera de rotación', 'out'];
  return [shiftCode(t), t, shiftCls(t), false, true];                                      // turno automático, falta cargar la hora
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
function stableJSON(value) { return JSON.stringify(value ?? null); }
function personHistorySnapshot(source, personId) {
  const person = (source.people || []).find(p => p.id === personId) || null;
  const schedules = (source.schedule || []).filter(item => item.person === personId)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.id).localeCompare(String(b.id)));
  return person ? { person: { name: person.name, mode: person.mode, group: person.group, fixed: person.fixed, days: person.days, offsets: person.offsets }, schedules } : null;
}
function buildHistoryEntries(previous, current) {
  if (!previous) return [];
  const entries = [];
  const rotationBefore = { rotation: previous.rotation, cycleStart: previous.cycleStart, weekStart: previous.weekStart, weekEnd: previous.weekEnd, shifts: previous.shifts, shiftDays: previous.shiftDays, groups: (previous.groups || []).map(g => ({ id: g.id, name: g.name, startShift: g.startShift, fixedShift: g.fixedShift })) };
  const rotationAfter = { rotation: current.rotation, cycleStart: current.cycleStart, weekStart: current.weekStart, weekEnd: current.weekEnd, shifts: current.shifts, shiftDays: current.shiftDays, groups: (current.groups || []).map(g => ({ id: g.id, name: g.name, startShift: g.startShift, fixedShift: g.fixedShift })) };
  if (stableJSON(rotationBefore) !== stableJSON(rotationAfter)) {
    entries.push({ id: `h-${Date.now()}-rotation`, type: 'rotation', title: 'Modificación de rotación', before: rotationBefore, after: rotationAfter });
  }
  const groupIds = new Set([...(previous.groups || []).map(g => g.id), ...(current.groups || []).map(g => g.id)]);
  groupIds.forEach(groupId => {
    const pick = source => { const g = (source.groups || []).find(x => x.id === groupId); return g ? { name: g.name, fixedShift: g.fixedShift, startShift: g.startShift, shiftHours: g.shiftHours || {} } : null; };
    const before = pick(previous), after = pick(current);
    if (before && after && stableJSON(before) !== stableJSON(after)) {
      entries.push({ id: `h-${Date.now()}-${groupId}`, type: 'group_schedule', groupId, groupName: after.name || before.name || 'Grupo', title: `Modificación de horario · ${after.name || before.name || 'Grupo'}`, before, after });
    }
  });
  const ids = new Set([...(previous.people || []).map(p => p.id), ...(current.people || []).map(p => p.id)]);
  ids.forEach(personId => {
    const before = personHistorySnapshot(previous, personId);
    const after = personHistorySnapshot(current, personId);
    if (before && after && stableJSON(before) !== stableJSON(after)) {
      const person = (current.people || []).find(p => p.id === personId) || (previous.people || []).find(p => p.id === personId);
      entries.push({ id: `h-${Date.now()}-${personId}`, type: 'person_schedule', personId, personName: person?.name || 'Persona', title: `Modificación de horario · ${person?.name || 'Persona'}`, before, after });
    }
  });
  return entries.map(entry => ({ ...entry, changedAt: new Date().toISOString(), changedBy: user?.nombre || 'Administrador' }));
}
async function save(okMsg = '✓ Rotación guardada') {
  const previous = lastCommittedState ? JSON.parse(JSON.stringify(lastCommittedState)) : null;
  const priorHistory = [...(state.history || [])];
  const newHistory = buildHistoryEntries(previous, state);
  if (newHistory.length) state.history = [...(state.history || []), ...newHistory];
  const payload = JSON.parse(JSON.stringify(state));
  delete payload.history; // el historial vive en una subcolección para no acercarse al límite de 1 MiB del documento principal.
  try {
    const batch = writeBatch(db);
    batch.set(ref, payload);
    const historyCollection = collection(db, COL, DOC_ID, 'history');
    newHistory.forEach(entry => batch.set(doc(historyCollection, entry.id), entry));
    await batch.commit();
    lastCommittedState = payload;
    toast(okMsg);
    return true;
  } catch (error) {
    console.error(error);
    // No dejamos cambios locales sin guardar aparentando estar confirmados.
    state = normalize(lastCommittedState || emptyState());
    state.history = priorHistory;
    toast(error.code === 'permission-denied'
      ? 'Firebase rechazó el guardado: revisá los permisos de la colección planning'
      : 'No se pudo guardar. Revisá la conexión e intentá nuevamente.', true);
    return false;
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
        <option value="rt-sched">HORARIOS</option>
        <option value="rt-groups">GRUPOS</option>
        <option value="rt-ex">EXCEPCIONES</option>
        <option value="rt-comp">COMPENSATORIOS</option>
        <option value="rt-set">CONFIGURACIÓN</option>
        <option value="rt-history">HISTORIAL</option>
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
      <span id="rt-leg-shifts" style="display:contents"></span>
      <span><i class="rt-dot" style="background:#fff;width:3px;border-radius:0"></i>Arranque de fábrica (el primero en entrar del grupo)</span>
      <span><i class="rt-dot" style="background:#e8798a"></i>Vacaciones</span>
      <span><i class="rt-dot" style="background:#d96a8c"></i>Licencia</span>
      <span><i class="rt-dot" style="background:#63b167"></i>Fijo / Cambio</span>
      <span><i class="rt-dot" style="background:#b794f4"></i>Compensatorio (tomado)</span>
      <span><i class="rt-dot" style="background:#4fd1c5"></i>Trabajó día libre (+comp.)</span>
      <span><i class="rt-dot" style="background:#6b6f76"></i>Fuera de rotación</span>
      <span><i class="rt-dot" style="background:#4a4d52"></i>Descanso</span>
      <span><i class="rt-dot" style="background:transparent;border:1px dashed #9aa0a6"></i>Turno automático (sin horario cargado)</span>
    </div>
    <div class="rt-tablewrap"><table id="rt-table" class="rt-table"></table></div>
    <p class="rt-hint" id="rt-hint"></p>
  </div>

  <div id="rt-people" class="rt-sub" hidden>
    <div class="section-header"><div class="section-title">PERSONAS</div><button class="btn btn-sm" id="rt-add-person" type="button">+ NUEVA PERSONA</button></div>
    <div id="rt-people-list" class="rt-cards"></div>
  </div>

  <div id="rt-sched" class="rt-sub" hidden>
    <div class="section-header"><div class="section-title">HORARIOS</div><div class="rt-comp-btns"><button class="btn btn-sm" id="rt-add-gsched" type="button">+ HORARIO DE GRUPOS</button><button class="btn btn-sm btn-outline" id="rt-add-sched" type="button">+ HORARIO INDIVIDUAL</button></div></div>
    <p class="rt-small" style="margin:0 0 12px"><b>Horario de grupos:</b> definís una vez, para cada turno (mañana, tarde, noche), los días que se asiste y la entrada y salida; la rotación automática lo aplica semana a semana. <b>Horario individual:</b> entrada, salida y turno para una persona, un día o un rango; pisa al del grupo.</p>
    <div class="rt-toolbar"><strong>Turnos</strong><button class="btn btn-sm btn-outline" id="rt-add-shift" type="button">+ AGREGAR TURNO</button></div>
    <p class="rt-small" style="margin:0 0 12px">Cada turno tiene su propio día en que arranca y su propio día en que termina. Tocá el botón de un turno para cambiarlos; los turnos que agregues también lo tienen.</p>
    <div id="rt-shift-list" class="rt-cards" style="margin-bottom:24px"></div>
    <div class="rt-toolbar"><strong>Horarios de grupos</strong></div>
    <div id="rt-gsched-list" class="rt-cards" style="margin-bottom:24px"></div>
    <div class="rt-toolbar"><strong>Horarios individuales</strong><div class="rt-filters"><label class="context-picker"><span>Persona</span><select class="context-view-select" id="rt-sp"></select></label></div></div>
    <div id="rt-sched-list"></div>
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

  <div id="rt-history" class="rt-sub" hidden>
    <div class="section-header"><div class="section-title">HISTORIAL DE CAMBIOS</div></div>
    <p class="rt-small">Cada modificación de la rotación o del horario de una persona conserva la versión anterior y la nueva, con fecha y usuario.</p>
    <div id="rt-history-list" class="rt-cards"></div>
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
  const order = id => { const i = state.groups.findIndex(g => g.id === id); return i < 0 ? 9999 : i; };
  return state.people.map((p, i) => {
    const gid = groupAt(p, mid), g = state.groups.find(x => x.id === gid);
    return { p, gid: gid || '', gname: g?.name || '', i };
  }).sort((a, b) => order(a.gid) - order(b.gid) || a.i - b.i);   // agrupa las filas por grupo (sin repetir encabezados)
}
function renderCal() {
  const lbl = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(cur);
  $('#rt-month').textContent = lbl.charAt(0).toUpperCase() + lbl.slice(1);
  const table = $('#rt-table');

  if (!loaded) { fillFilters([]); table.innerHTML = '<tbody><tr><td class="rt-empty">Cargando rotación…</td></tr></tbody>'; return; }
  if (!state.people.length) {
    fillFilters([]);
    table.innerHTML = `<tbody><tr><td class="rt-empty">${canEdit
      ? 'Todavía no hay personas cargadas.<br><br><button class="btn btn-sm" id="rt-goto-people" type="button">+ CARGAR PERSONAS</button>'
      : 'Todavía no hay una rotación cargada. Lo carga Administración.'}</td></tr></tbody>`;
    return;
  }
  const rows = monthRows();
  fillFilters(rows);
  const gf = $('#rt-fg').value, pf = $('#rt-fp').value, today = dk(new Date());
  const ds = daysOf(cur.getFullYear(), cur.getMonth());
  const list = rows.filter(r => (!pf || r.p.id === pf) && (!gf || r.gid === gf));

  // Arranque de fábrica: en cada grupo y día, el que entra primero (la raya blanca va solo en su celda).
  // Si dos o más entran a la misma hora no hay uno que arranque primero, así que no se marca ninguno.
  const starter = new Map();
  const byGroup = new Map(); rows.forEach(r => { if (!byGroup.has(r.gid)) byGroup.set(r.gid, []); byGroup.get(r.gid).push(r.p); });
  byGroup.forEach((members, gid) => {
    ds.forEach(d => {
      const ins = [];
      members.forEach(q => { const a = assignment(q, d), m = toMin(a[1]); if (m != null) ins.push({ id: q.id, m: (a[2] === 'noche' && m < 720) ? m + 1440 : m }); });
      if (!ins.length) return;
      ins.sort((x, y) => x.m - y.m);
      if (ins.length === 1 || ins[0].m < ins[1].m) starter.set(`${gid}|${dk(d)}`, ins[0].id);
    });
  });
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
      h += `<td class="rt-cell ${esc(a[2])} ${starter.get(`${gid}|${dk(d)}`) === p.id ? 'rt-custom' : ''} ${a[4] ? 'rt-auto' : ''} ${isWeekend(d) ? 'rt-we' : ''} ${canEdit ? 'rt-edit' : ''}" ${canEdit ? `data-p="${esc(p.id)}" data-d="${dk(d)}"` : ''} title="${esc(a[1] + (a[4] ? ' · sin horario cargado' : ''))}"><span class="rt-l">${esc(a[1])}</span><span class="rt-s">${esc(SHORT[a[0]] || a[0])}</span></td>`;
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
    const g = state.groups.find(q => q.id === p.group), f = p.fixed || {};
    const base = p.mode === 'fijo' ? `Turno fijo: ${f.shift || '—'}${f.in && f.out ? ' · ' + hoursLabel(f.in, f.out, offFor(p, f.shift)) : ''}`
      : p.mode === 'fuera_rotacion' ? 'Sin grupo / fuera de rotación' : state.rotation.join(' → ');
    return `<article><div class="rt-ct"><div><h3>${esc(p.name)}</h3><p>${p.mode === 'fijo' ? 'Horario fijo' : p.mode === 'fuera_rotacion' ? 'Fuera de rotación · sin grupo' : 'Rotación del grupo'}</p></div><span class="rt-pill">${esc(g?.name || 'Sin grupo')}</span></div>
      <div class="rt-meta">${esc(base)}${p.mode !== 'fuera_rotacion' ? `<br>Viene: ${esc(daysTxt(p))}` : ''}${hasOff(p) && p.mode !== 'fuera_rotacion' ? SHIFTS.filter(t => offFor(p, t)).map(t => `<br>${esc(t)}: ${esc(offTxt(offFor(p, t)).toLowerCase())}`).join('') + ' <span class="rt-small">(mismas horas, horario corrido)</span>' : ''}${p.role ? `<br>Función: ${esc(p.role)}` : ''}<br>Compensatorios a favor: <b>${fmtDays(compBalance(p.id).saldo)}</b></div>
      <div class="rt-actions"><button class="rt-btn" data-act="edit-person" data-id="${esc(p.id)}">EDITAR</button><button class="rt-btn rt-danger" data-act="del-person" data-id="${esc(p.id)}">ELIMINAR</button></div></article>`;
  }).join('') || '<div class="rt-emptybox">No hay personas.</div>';
}
function editPerson(id) {
  const p = state.people.find(q => q.id === id);
  const f0 = p?.fixed || {}, days0 = p?.days || DEFAULT_DAYS;
  openModal(p ? 'Editar persona' : 'Nueva persona', `<form id="rt-pf">
    <div class="field"><label>Nombre</label><input type="text" name="name" required value="${esc(p?.name || '')}"></div>
    <div class="field"><label>Grupo</label><select name="group"><option value="">Sin grupo</option>${state.groups.map(g => `<option value="${esc(g.id)}" ${g.id === p?.group ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Modalidad</label><select name="mode">
      <option value="rotativo" ${p?.mode === 'rotativo' || !p ? 'selected' : ''}>Rotación del grupo</option>
      <option value="fijo" ${p?.mode === 'fijo' ? 'selected' : ''}>Horario fijo</option>
      <option value="fuera_rotacion" ${p?.mode === 'fuera_rotacion' ? 'selected' : ''}>Fuera de rotación · sin grupo</option></select></div>
    <div class="rt-fixed">
      <div class="rt-two"><div class="field"><label>Turno fijo</label><select name="fshift">${SHIFTS.map(t => `<option value="${esc(t)}" ${t === f0.shift ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div><div class="field"></div></div>
      <div class="rt-two"><div class="field"><label>Entrada</label><input type="time" name="fin" value="${esc(f0.in || '')}"></div><div class="field"><label>Salida</label><input type="time" name="fout" value="${esc(f0.out || '')}"></div></div>
    </div>
    <div class="field"><label>Función (opcional)</label><input type="text" name="role" value="${esc(p?.role || '')}" placeholder="Ej.: Arranque de máquinas"></div>
    <div class="rt-own">
      <div class="field"><label>Días de la semana que viene</label><div class="rt-checks rt-days">${WEEK.map(([n, l]) => `<label class="rt-check"><input type="checkbox" name="day" value="${n}" ${days0.includes(n) ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
      <p class="rt-small" style="margin:-4px 0 14px">Los demás días figuran como descanso. Un horario cargado para un solo día se respeta igual.</p>
      <div class="field" style="margin-bottom:6px"><label>Corrimiento de horario por turno</label></div>
      ${SHIFTS.map((t, k) => { const o = offFor(p, t); return `<div class="rt-offrow"><span>${esc(t)}</span><select name="odir${k}"><option value="0" ${!o ? 'selected' : ''}>Sin corrimiento</option><option value="1" ${o > 0 ? 'selected' : ''}>Entra antes</option><option value="-1" ${o < 0 ? 'selected' : ''}>Entra después</option></select><input type="number" name="ohrs${k}" min="0" max="12" step="0.5" placeholder="Horas" value="${o ? Math.abs(o) : ''}"></div>`; }).join('')}
      <p class="rt-small" style="margin:-4px 0 4px">Se corren la entrada y la salida juntas: hace las mismas horas, solo que más temprano o más tarde (ej. 06:00 - 14:00 con 2 h antes → 04:00 - 12:00). Cada turno (mañana, tarde, noche) tiene su propio corrimiento y se aplica a todos los horarios cargados con ese turno.</p>
    </div>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR PERSONA</button></div></form>`);
  const f = M('#rt-pf'), fix = f.querySelector('.rt-fixed'), own = f.querySelector('.rt-own');
  const sync = () => { const m = f.elements.mode.value; fix.style.display = m === 'fijo' ? '' : 'none'; own.style.display = m === 'fuera_rotacion' ? 'none' : ''; };
  f.elements.mode.onchange = sync; sync();
  f.onsubmit = async e => {
    e.preventDefault();
    const m = f.elements.mode.value;
    const name = f.elements.name.value.trim();
    if (!name) { toast('Ingresá el nombre de la persona', true); return; }
    const days = [...f.querySelectorAll('[name="day"]:checked')].map(i => +i.value);
    if (m !== 'fuera_rotacion' && !days.length) { toast('Elegí al menos un día de la semana', true); return; }
    const offsets = Object.fromEntries(SHIFTS.map((t, k) => [t, m === 'fuera_rotacion' ? 0 : ((+f.elements['odir' + k].value) * (parseFloat(f.elements['ohrs' + k].value) || 0) || 0)]));
    const o = {
      id: p?.id || 'p' + Date.now(), name, group: m === 'fuera_rotacion' ? '' : f.elements.group.value, mode: m,
      role: f.elements.role.value.trim(), days: days.length ? days : [...DEFAULT_DAYS],
      fixed: m === 'fijo' ? { shift: f.elements.fshift.value, in: f.elements.fin.value, out: f.elements.fout.value } : { shift: '', in: '', out: '' },
      offsets
    };
    if (p) Object.assign(p, o); else state.people.push(o);
    closeModal(); await save(); renderAll();
  };
}
async function deletePerson(id) {
  const p = state.people.find(q => q.id === id);
  if (!p || !confirm(`¿Eliminar a ${p.name}?`)) return;
  state.people = state.people.filter(q => q.id !== id);
  state.exceptions = state.exceptions.filter(e => e.person !== id);
  state.schedule = state.schedule.filter(s => s.person !== id);
  state.compAdj = state.compAdj.filter(a => a.person !== id);
  await save(); renderAll();
}

/* ══ GRUPOS ══
   Los grupos los crea el administrador (no hay ninguno cargado en el código). */
function renderGroups() {
  $('#rt-group-list').innerHTML = state.groups.map(g => {
    const ms = state.people.filter(p => p.group === g.id);
    return `<article><div class="rt-ct"><div><h3>${esc(g.name)}</h3><p>${g.fixedShift ? 'Turno fijo · ' + esc(g.fixedShift) : 'Arranca en · ' + esc(g.startShift)}</p></div><span class="rt-pill">${ms.length} integrante${ms.length === 1 ? '' : 's'}</span></div>
      <div class="rt-meta">Secuencia: ${esc(state.rotation.join(' → '))}</div>
      <div class="rt-members">${ms.map(p => `<span>${esc(p.name)}</span>`).join('') || '<span>Sin integrantes</span>'}</div>
      <div class="rt-actions"><button class="rt-btn" data-act="edit-group" data-id="${esc(g.id)}">EDITAR GRUPO</button><button class="rt-btn rt-danger" data-act="del-group" data-id="${esc(g.id)}">ELIMINAR</button></div></article>`;
  }).join('') || '<div class="rt-emptybox">No hay grupos. Creá el primero con “+ NUEVO GRUPO”.</div>';
}
function editGroup(id) {
  const g = state.groups.find(q => q.id === id);
  openModal(g ? 'Editar grupo' : 'Nuevo grupo', `<form id="rt-gf">
    <div class="field"><label>Nombre</label><input type="text" name="name" required value="${esc(g?.name || '')}"></div>
    <div class="field"><label>Modalidad</label><select name="kind"><option value="rot" ${g?.fixedShift ? '' : 'selected'}>Rotativo</option><option value="fix" ${g?.fixedShift ? 'selected' : ''}>Turno fijo</option></select></div>
    <div class="field rt-rot"><label>Turno con el que arranca (al inicio del ciclo)</label><select name="start">${SHIFTS.map(t => `<option value="${esc(t)}" ${t === g?.startShift ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <div class="field rt-fix" style="display:none"><label>Turno fijo</label><select name="shift">${SHIFTS.map(t => `<option value="${esc(t)}" ${t === g?.fixedShift ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <div class="field"><label>Integrantes</label><div class="rt-checks">${state.people.map(p => `<label class="rt-check"><input type="checkbox" name="m" value="${esc(p.id)}" ${g && p.group === g.id ? 'checked' : ''}>${esc(p.name)}</label>`).join('') || 'No hay personas.'}</div></div>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR GRUPO</button></div></form>`);
  const f = M('#rt-gf');
  const sync = () => { const z = f.elements.kind.value === 'fix'; f.querySelector('.rt-rot').style.display = z ? 'none' : ''; f.querySelector('.rt-fix').style.display = z ? '' : 'none'; };
  f.elements.kind.onchange = sync; sync();
  f.onsubmit = async e => {
    e.preventDefault();
    const fix = f.elements.kind.value === 'fix';
    const name = f.elements.name.value.trim();
    if (!name) { toast('Ingresá el nombre del grupo', true); return; }
    if (state.groups.some(item => item.id !== g?.id && item.name.toLowerCase() === name.toLowerCase())) { toast('Ya existe un grupo con ese nombre', true); return; }
    const o = { id: g?.id || 'g' + Date.now(), name, startShift: f.elements.start.value, fixedShift: fix ? f.elements.shift.value : '' };
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
  state.people.forEach(p => { if (p.group === id) { p.group = ''; if (p.mode === 'rotativo') p.mode = 'fuera_rotacion'; } });
  state.exceptions = state.exceptions.filter(e => !(e.type === 'cambio_grupo' && e.value === id));
  await save(); renderAll();
}

/* ══ EXCEPCIONES ══ */
function renderEx() {
  const list = [...state.exceptions].sort((a, b) => b.start.localeCompare(a.start));
  $('#rt-ex-list').innerHTML = list.map(e => {
    const p = state.people.find(q => q.id === e.person);
    const v = e.type === 'cambio_grupo' ? (state.groups.find(g => g.id === e.value)?.name || e.value) : e.type === 'cambio_turno' ? e.value : e.type === 'otro' ? e.note : '';
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
    const t = f.elements.type.value, grp = t === 'cambio_grupo', turn = t === 'cambio_turno';
    val.style.display = (grp || turn) ? '' : 'none'; other.style.display = t === 'otro' ? '' : 'none';
    M('#rt-vl').textContent = grp ? 'Grupo' : 'Turno';
    f.elements.value.innerHTML = grp
      ? state.groups.map(g => `<option value="${esc(g.id)}" ${g.id === e?.value ? 'selected' : ''}>${esc(g.name)}</option>`).join('')
      : SHIFTS.map(s => `<option value="${esc(s)}" ${s === e?.value ? 'selected' : ''}>${esc(s)}</option>`).join('');
  };
  f.elements.type.onchange = sync; sync();
  f.onsubmit = async ev => {
    ev.preventDefault();
    if (f.elements.end.value < f.elements.start.value) { toast('La fecha Hasta no puede ser anterior a Desde', true); return; }
    const t = f.elements.type.value;
    if ((t === 'cambio_grupo' || t === 'cambio_turno') && !f.elements.value.value) { toast(t === 'cambio_grupo' ? 'Seleccioná el grupo de destino' : 'Seleccioná el turno', true); return; }
    const o = { id: e?.id || 'e' + Date.now(), person: f.elements.person.value, type: t, start: f.elements.start.value, end: f.elements.end.value,
      value: t === 'cambio_grupo' || t === 'cambio_turno' ? f.elements.value.value : '', note: t === 'otro' ? f.elements.otherText.value.trim() : f.elements.note.value.trim() };
    const snap = JSON.stringify(state.exceptions), schSnap = JSON.stringify(state.schedule);
    if (e) Object.assign(e, o); else state.exceptions.push(o);
    // Un día libre trabajado es una marca de compensación, nunca una asignación de turno u horario.
    if (t === 'trabajo_franco') removeSchedulesInRange(o.person, o.start, o.end);
    if (!okSaldo(t, o.person, snap)) { state.schedule = JSON.parse(schSnap); return; }
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
const TIME_TYPES = ['sched', 'cambio_turno'];   // solo estos estados permiten editar turno y horario
function dayEdit(pid, date) {
  const p = state.people.find(q => q.id === pid); if (!p) return;
  const d = pd(date);
  const ex = state.exceptions.find(q => q.person === pid && date >= q.start && date <= (q.end || q.start) && q.type !== 'cambio_grupo');
  const s = schedAt(p, d);
  const shift0 = (ex?.value && SHIFTS.includes(ex.value)) ? ex.value : s?.shift || rotShift(p, d) || SHIFTS[0];
  const gs0 = !s ? groupSched(p, d, shift0) : null;
  openModal(`${p.name} · ${date}`, `<form id="rt-df">
    <div class="rt-preview"><span>Asignación actual</span><strong>${esc(assignment(p, d)[1])}</strong></div>
    <div class="field"><label>Estado del día</label><select name="type">
      <option value="sched" ${!ex ? 'selected' : ''}>Horario / turno</option>
      <option value="none">Volver a la rotación automática</option>
      ${Object.entries(EX_NAMES).filter(([k]) => k !== 'cambio_grupo').map(([k, v]) => `<option value="${k}" ${k === ex?.type ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="rt-sched">
      <div class="field"><label>Turno</label><select name="shift">${SHIFTS.map(t => `<option value="${esc(t)}" ${t === shift0 ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div class="rt-two"><div class="field"><label>Entrada</label><input type="time" name="tin" value="${esc(s?.in || gs0?.in || '')}"></div><div class="field"><label>Salida</label><input type="time" name="tout" value="${esc(s?.out || gs0?.out || '')}"></div></div>
      ${hasOff(p) ? `<label class="rt-check" style="margin-bottom:8px"><input type="checkbox" name="noOff" ${s?.noOffset ? 'checked' : ''}>No aplicar el corrimiento de ${esc(p.name)} a este horario</label>` : ''}
      <p class="rt-small" id="rt-dprev" style="margin:0 0 14px"></p>
    </div>
    <div class="field rt-other" style="display:none"><label>Detalle de “Otro”</label><input type="text" name="otherText" value="${ex?.type === 'otro' ? esc(ex.note || '') : ''}" placeholder="Escribí el motivo o estado"></div>
    <div class="field"><label>Observación</label><input type="text" name="note" value="${ex?.type !== 'otro' ? esc(ex?.note || '') : ''}"></div>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR</button></div></form>`);
  const f = M('#rt-df');
  let touched = !!(s || ex?.value);   // si ya tenía turno, no se lo pisamos al cambiar la hora
  const prev = () => { const off = f.elements.noOff?.checked ? 0 : offFor(p, f.elements.shift.value); M('#rt-dprev').textContent = prevText(f.elements.tin.value, f.elements.tout.value, off); };
  const sync = () => {
    const t = f.elements.type.value;
    f.querySelector('.rt-sched').style.display = TIME_TYPES.includes(t) ? '' : 'none';
    f.querySelector('.rt-other').style.display = t === 'otro' ? '' : 'none';
    prev();
  };
  f.elements.type.onchange = sync;
  f.elements.shift.onchange = () => { touched = true; prev(); };
  f.elements.tin.onchange = () => { if (!touched && f.elements.tin.value) f.elements.shift.value = guessShift(f.elements.tin.value); prev(); };
  f.elements.tout.onchange = prev;
  if (f.elements.noOff) f.elements.noOff.onchange = prev;
  sync();
  f.onsubmit = async ev => {
    ev.preventDefault();
    const t = f.elements.type.value, tin = f.elements.tin.value, tout = f.elements.tout.value, shift = f.elements.shift.value;
    if (TIME_TYPES.includes(t)) {
      if (t === 'sched' && (!tin || !tout)) { toast('Cargá la hora de entrada y la de salida', true); return; }
      if ((tin || tout) && (!tin || !tout || tin === tout)) { toast('Revisá la hora de entrada y la de salida', true); return; }
    }
    const snap = JSON.stringify(state.exceptions), schSnap = JSON.stringify(state.schedule);
    removeExceptionsOnDate(pid, date);
    // Al cambiar el estado de un día, quitamos solo ese día de cualquier rango horario,
    // conservando los demás días del rango. Así un día libre jamás queda con horario.
    removeSchedulesInRange(pid, date, date);
    if (TIME_TYPES.includes(t) && tin && tout) state.schedule.push({ id: 's' + Date.now(), person: pid, start: date, end: date, shift, in: tin, out: tout, noOffset: !!f.elements.noOff?.checked });
    if (t !== 'none' && t !== 'sched') state.exceptions.push({ id: 'e' + Date.now(), person: pid, type: t, start: date, end: date, value: t === 'cambio_turno' ? shift : '', note: t === 'otro' ? f.elements.otherText.value.trim() : f.elements.note.value.trim() });
    if (!okSaldo(t, pid, snap)) { state.schedule = JSON.parse(schSnap); return; }
    closeModal(); await save(); renderAll();
  };
}

/* ══ TURNOS (día en que arranca y día en que termina cada uno) ══ */
const shiftLen = t => { const { s, e } = shiftWin(t); return ((e - s + 7) % 7) + 1; };
function renderShifts() {
  const el = $('#rt-shift-list'); if (!el) return;
  el.innerHTML = SHIFTS.map(t => {
    const { s, e } = shiftWin(t), n = shiftLen(t), own = !!state.shiftDays?.[t];
    return `<article class="rt-shiftcard ${shiftCls(t)}"><div class="rt-ct"><div><h3>${esc(t)}</h3><p>${own ? 'Días propios' : 'Usa la semana base'} · ${n} día${n === 1 ? '' : 's'}</p></div></div>
      <button type="button" class="btn btn-sm rt-daybtn" data-act="edit-shift-days" data-id="${esc(t)}">ARRANCA ${esc(dayName(s).toUpperCase())} · TERMINA ${esc(dayName(e).toUpperCase())}</button>
      <div class="rt-actions"><button class="rt-btn" data-act="edit-shift-days" data-id="${esc(t)}">EDITAR DÍAS</button><button class="rt-btn rt-danger" data-act="del-shift" data-id="${esc(t)}" ${SHIFTS.length <= 1 ? 'disabled' : ''}>ELIMINAR TURNO</button></div></article>`;
  }).join('');
}
function renderLegendShifts() {
  const el = $('#rt-leg-shifts'); if (!el) return;
  el.innerHTML = SHIFTS.map(t => `<span><i class="rt-dot" style="background:${SHIFT_COLOR[t] || '#7fd1a0'}"></i>${esc(t)}</span>`).join('');
}
const syncShifts = () => { state.shifts = [...SHIFTS]; };
// t = nombre del turno a editar; sin t = turno nuevo
function editShift(t) {
  const isNew = !t, { s, e } = isNew ? { s: weekStartDay(), e: weekEndDay() } : shiftWin(t), own = !isNew && !!state.shiftDays?.[t];
  const opt = v => WEEK.map(([n, l]) => `<option value="${n}" ${n === v ? 'selected' : ''}>${l}</option>`).join('');
  openModal(isNew ? 'Agregar turno' : `Días del turno ${t}`, `<form id="rt-shf">
    ${isNew ? '<div class="field"><label>Nombre del turno</label><input type="text" name="name" maxlength="20" required placeholder="Ej.: Intermedio"></div>' : ''}
    <div class="rt-two"><div class="field"><label>Día en que arranca</label><select name="s">${opt(s)}</select></div>
    <div class="field"><label>Día en que termina</label><select name="e">${opt(e)}</select></div></div>
    <p class="rt-small" id="rt-shp" style="margin:0 0 6px"></p>
    <p class="rt-small" style="margin:0 0 14px">Dentro de la semana de rotación del grupo, este turno rige desde el día que arranca hasta el día que termina; los demás días quedan como descanso. Ej.: noche de domingo a viernes → Arranca <b>Dom</b>, Termina <b>Vie</b>.</p>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button>${own ? '<button type="button" class="btn btn-outline" id="rt-shreset">USAR SEMANA BASE</button>' : ''}<button class="btn btn-green" type="submit">GUARDAR</button></div></form>`);
  const f = M('#rt-shf');
  const prev = () => { const a = +f.elements.s.value, b = +f.elements.e.value, n = ((b - a + 7) % 7) + 1; M('#rt-shp').textContent = `${dayName(a)} → ${dayName(b)} · ${n} día${n === 1 ? '' : 's'} por semana`; };
  f.elements.s.onchange = prev; f.elements.e.onchange = prev; prev();
  M('#rt-shreset')?.addEventListener('click', async () => { delete state.shiftDays[t]; closeModal(); await save('✓ Turno con la semana base'); renderAll(); });
  f.onsubmit = async ev => {
    ev.preventDefault();
    let name = t;
    if (isNew) {
      name = f.elements.name.value.trim();
      if (!name) { toast('Escribí el nombre del turno', true); return; }
      if (SHIFTS.some(x => x.toLowerCase() === name.toLowerCase())) { toast('Ya existe un turno con ese nombre', true); return; }
      if (/[.\/\[\]*~`]/.test(name)) { toast('El nombre no puede tener . / [ ] * ~', true); return; }
      SHIFTS.push(name); syncShifts(); selectedConfigShift = name;
    }
    state.shiftDays = { ...state.shiftDays, [name]: { start: +f.elements.s.value, end: +f.elements.e.value } };
    closeModal(); await save(isNew ? '✓ Turno agregado' : '✓ Días del turno guardados'); renderAll();
  };
}
async function deleteShift(t) {
  if (SHIFTS.length <= 1) { toast('Tiene que quedar al menos un turno', true); return; }
  if (!confirm(`¿Eliminar el turno ${t}? Se quita de la rotación y de los horarios de grupos. Los horarios individuales ya cargados no se borran.`)) return;
  setShifts(SHIFTS.filter(x => x !== t)); syncShifts(); if (selectedConfigShift === t) selectedConfigShift = SHIFTS[0];
  delete state.shiftDays[t];
  state.rotation = state.rotation.filter(x => x !== t); if (!state.rotation.length) state.rotation = [SHIFTS[0]];
  rotDraft = rotDraft.filter(x => x !== t); if (!rotDraft.length) rotDraft = [...state.rotation];
  state.groups.forEach(g => { delete g.shiftHours?.[t]; if (g.fixedShift === t) g.fixedShift = ''; if (g.startShift === t) g.startShift = state.rotation[0]; });
  const fallbackShift = SHIFTS[0];
  state.people.forEach(p => { if (p.fixed?.shift === t) p.fixed.shift = fallbackShift; if (p.offsets) delete p.offsets[t]; });
  state.schedule.forEach(s => { if (s.shift === t) s.shift = fallbackShift; });
  state.exceptions.forEach(e => { if (e.type === 'cambio_turno' && e.value === t) e.value = fallbackShift; });
  await save('✓ Turno eliminado'); renderAll();
}

/* ══ HORARIOS (carga manual: entrada, salida y turno) ══ */
function renderGSched() {
  $('#rt-gsched-list').innerHTML = state.groups.map(g => {
    const sh = g.shiftHours || {};
    const rows = SHIFTS.map(t => {
      const x = sh[t], { s: ws, e: we } = shiftWin(t);
      return `<div class="rt-gshiftrow ${shiftCls(t)}"><div class="rt-gshiftrow-head"><b>${esc(t)}</b><button type="button" class="rt-btn rt-daybtn-sm" data-act="edit-shift-days" data-id="${esc(t)}">ARRANCA ${esc(dayName(ws).toUpperCase())} · TERMINA ${esc(dayName(we).toUpperCase())}</button></div>
        <div class="rt-gshiftrow-body"><span>${x ? `${esc(WEEK.filter(([n]) => x.days.includes(n)).map(([, l]) => l).join(' · '))} · ${esc(hoursLabel(x.in, x.out))}` : '<span class="rt-small">sin cargar</span>'}</span><button type="button" class="rt-btn" data-act="edit-gsched" data-id="${esc(g.id)}" data-shift="${esc(t)}">EDITAR</button></div></div>`;
    }).join('');
    return `<article><div class="rt-ct"><div><h3>${esc(g.name)}</h3><p>${g.fixedShift ? 'Turno fijo · ' + esc(g.fixedShift) : 'Arranca en · ' + esc(g.startShift)}</p></div></div>
      <div class="rt-meta">${rows}</div>
      <div class="rt-actions"><button class="rt-btn" data-act="edit-gsched" data-id="${esc(g.id)}">EDITAR TODOS</button><button class="rt-btn rt-danger" data-act="del-gsched" data-id="${esc(g.id)}">BORRAR HORARIOS</button></div></article>`;
  }).join('') || '<div class="rt-emptybox">No hay grupos. Creá los grupos en la vista GRUPOS.</div>';
}
function renderSched() {
  renderGSched();
  const sel = $('#rt-sp'); if (!sel) return;
  const fv = sel.value;
  sel.innerHTML = '<option value="">Todas las personas</option>' + state.people.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.value = fv;
  const list = state.schedule.filter(s => !sel.value || s.person === sel.value)
    .sort((a, b) => b.start.localeCompare(a.start) || String(b.id).localeCompare(String(a.id)));
  $('#rt-sched-list').innerHTML = list.map(s => {
    const p = state.people.find(q => q.id === s.person), off = p ? offsetOf(p, s) : 0;
    return `<div class="rt-ex"><b>${esc(p?.name || '—')}</b><span class="rt-ex-type">${esc(s.shift)}</span><span class="rt-ex-date">${s.start}${s.end !== s.start ? ' → ' + s.end : ''}</span><span>${esc(hoursLabel(s.in, s.out))}${off ? ` <span class="rt-small">→ ${esc(hoursLabel(s.in, s.out, off))} (${esc(offTxt(off).toLowerCase())})</span>` : ''}</span><div class="rt-actions" style="margin:0"><button class="rt-btn" data-act="edit-sched" data-id="${esc(s.id)}">EDITAR</button><button class="rt-btn rt-danger" data-act="del-sched" data-id="${esc(s.id)}">ELIMINAR</button></div></div>`;
  }).join('') || '<div class="rt-emptybox">Todavía no hay horarios cargados.</div>';
}
function editSched(id) {
  const s = id ? state.schedule.find(q => q.id === id) : null;
  if (!state.people.length) { toast('Primero cargá al menos una persona', true); return; }
  const who = s
    ? `<div class="field"><label>Persona</label><select name="person">${state.people.map(p => `<option value="${esc(p.id)}" ${p.id === s.person ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`
    : `<div class="field"><label>Personas</label>
        <select id="rt-sg"><option value="">Marcar todo un grupo…</option>${state.groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select>
        <div class="rt-checks" style="margin-top:8px">${state.people.map(p => `<label class="rt-check"><input type="checkbox" name="who" value="${esc(p.id)}">${esc(p.name)}</label>`).join('')}</div></div>`;
  openModal(s ? 'Editar horario' : 'Cargar horario', `<form id="rt-hf">${who}
    <div class="rt-two"><div class="field"><label>Desde</label><input type="date" name="start" required value="${s?.start || dk(new Date())}"></div><div class="field"><label>Hasta</label><input type="date" name="end" required value="${s?.end || dk(new Date())}"></div></div>
    <div class="field"><label>Turno</label><select name="shift">${SHIFTS.map(t => `<option value="${esc(t)}" ${t === (s?.shift || SHIFTS[0]) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <div class="rt-two"><div class="field"><label>Entrada</label><input type="time" name="tin" required value="${esc(s?.in || '')}"></div><div class="field"><label>Salida</label><input type="time" name="tout" required value="${esc(s?.out || '')}"></div></div>
    <label class="rt-check" style="margin-bottom:8px"><input type="checkbox" name="noOff" ${s?.noOffset ? 'checked' : ''}>No aplicar el corrimiento personal del turno (si la persona tiene uno)</label>
    <p class="rt-small" id="rt-hprev" style="margin:0 0 6px"></p>
    <p class="rt-small" style="margin:0 0 14px">En un rango, el horario se aplica solo a los días de la semana que cada persona viene; los demás quedan en descanso. Si cargás un solo día, se aplica siempre.</p>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR HORARIO</button></div></form>`);
  const f = M('#rt-hf');
  let touched = !!s;
  const prev = () => { M('#rt-hprev').textContent = prevText(f.elements.tin.value, f.elements.tout.value, 0); };
  f.elements.shift.onchange = () => { touched = true; };
  f.elements.tin.onchange = () => { if (!touched && f.elements.tin.value) f.elements.shift.value = guessShift(f.elements.tin.value); prev(); };
  f.elements.tout.onchange = prev; prev();
  f.elements.start.onchange = () => { if (f.elements.end.value < f.elements.start.value) f.elements.end.value = f.elements.start.value; };
  M('#rt-sg')?.addEventListener('change', e => {
    const g = e.target.value; if (!g) return;
    f.querySelectorAll('[name="who"]').forEach(c => { if (state.people.find(p => p.id === c.value)?.group === g) c.checked = true; });
    e.target.value = '';
  });
  f.onsubmit = async ev => {
    ev.preventDefault();
    const ids = s ? [f.elements.person.value] : [...f.querySelectorAll('[name="who"]:checked')].map(i => i.value);
    const a = f.elements.start.value, b = f.elements.end.value, tin = f.elements.tin.value, tout = f.elements.tout.value;
    if (!ids.length) { toast('Elegí al menos una persona', true); return; }
    if (!a || !b || b < a) { toast('Revisá las fechas: “Hasta” no puede ser anterior a “Desde”', true); return; }
    if (!tin || !tout || tin === tout) { toast('Cargá la hora de entrada y la de salida', true); return; }
    const base = { start: a, end: b, shift: f.elements.shift.value, in: tin, out: tout, noOffset: !!f.elements.noOff.checked };
    if (s) state.schedule = state.schedule.filter(q => q.id !== s.id);
    ids.forEach((pid, i) => {
      // Reemplaza solapamientos sin borrar los tramos que quedan fuera del nuevo rango.
      removeSchedulesInRange(pid, a, b);
      let segments = [{ start: a, end: b }];
      // Nunca guardar un horario en fechas marcadas como día libre trabajado.
      state.exceptions.filter(x => x.person === pid && x.type === 'trabajo_franco' && rangesOverlap(x.start, x.end || x.start, a, b)).forEach(x => {
        const cutStart = x.start, cutEnd = x.end || x.start, next = [];
        segments.forEach(seg => {
          if (!rangesOverlap(seg.start, seg.end, cutStart, cutEnd)) { next.push(seg); return; }
          if (seg.start < cutStart) next.push({ start: seg.start, end: addDaysKey(cutStart, -1) });
          if (seg.end > cutEnd) next.push({ start: addDaysKey(cutEnd, 1), end: seg.end });
        });
        segments = next;
      });
      segments.forEach((segment, j) => state.schedule.push({ id: `s${Date.now()}${i}${j}`, person: pid, ...base, ...segment }));
    });
    closeModal(); await save('✓ Horario guardado'); renderAll();
  };
}
function editGroupSched(gid, only = null) {   // only = nombre de un turno: se edita ese turno solo
  if (!state.groups.length) { toast('Primero creá los grupos en la vista GRUPOS', true); return; }
  const g0 = state.groups.find(q => q.id === gid) || state.groups[0];
  const shown = SHIFTS.map((t, k) => ({ t, k })).filter(x => !only || x.t === only);
  openModal(only ? `Horario · ${only}` : 'Horario de grupos', `<form id="rt-gh">
    <div class="field"><label>Grupo</label><select name="grp">${state.groups.map(g => `<option value="${esc(g.id)}" ${g.id === g0.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}${state.groups.length > 1 ? '<option value="*">Todos los grupos</option>' : ''}</select></div>
    ${shown.map(({ t, k }) => `<div class="rt-gshift ${shiftCls(t)}"><div class="rt-gtitle">${esc(t.toUpperCase())}</div>
      <label>Días de la semana que asiste</label>
      <div class="rt-checks rt-days">${WEEK.map(([n, l]) => `<label class="rt-check"><input type="checkbox" name="gd${k}" value="${n}">${l}</label>`).join('')}</div>
      <div class="rt-two" style="margin-top:10px"><div class="field"><label>Entrada</label><input type="time" name="gin${k}"></div><div class="field"><label>Salida</label><input type="time" name="gout${k}"></div></div></div>`).join('')}
    <p class="rt-small" style="margin:0 0 14px">Dejá vacías la entrada y la salida de un turno si no querés cargarlo. Los días que no tilden quedan como descanso. El corrimiento de cada persona se suma solo.</p>
    <div class="rt-form-actions"><button type="button" class="btn btn-outline" data-rt-close>CANCELAR</button><button class="btn btn-green" type="submit">GUARDAR HORARIOS</button></div></form>`);
  const f = M('#rt-gh');
  const fill = id => {
    const sh = (state.groups.find(q => q.id === id) || state.groups[0]).shiftHours || {};
    shown.forEach(({ t, k }) => {
      const x = sh[t] || {};
      f.querySelectorAll(`[name="gd${k}"]`).forEach(c => { c.checked = (x.days || (x.in ? [] : DEFAULT_DAYS)).includes(+c.value); });
      f.elements['gin' + k].value = x.in || ''; f.elements['gout' + k].value = x.out || '';
    });
  };
  fill(g0.id);
  f.elements.grp.onchange = () => fill(f.elements.grp.value === '*' ? state.groups[0].id : f.elements.grp.value);
  f.onsubmit = async ev => {
    ev.preventDefault();
    const res = {};
    for (const { k } of shown) {
      const tin = f.elements['gin' + k].value, tout = f.elements['gout' + k].value;
      const days = [...f.querySelectorAll(`[name="gd${k}"]:checked`)].map(c => +c.value);
      if (!tin && !tout) continue;
      if (!tin || !tout || tin === tout) { toast(`${SHIFTS[k]}: revisá la entrada y la salida`, true); return; }
      if (!days.length) { toast(`${SHIFTS[k]}: elegí al menos un día de la semana`, true); return; }
      res[SHIFTS[k]] = { days, in: tin, out: tout };
    }
    const sel = f.elements.grp.value;
    (sel === '*' ? state.groups : state.groups.filter(g => g.id === sel)).forEach(g => {
      if (!only) { g.shiftHours = JSON.parse(JSON.stringify(res)); return; }
      g.shiftHours = { ...(g.shiftHours || {}) };   // edición de un solo turno: no toca los otros
      if (res[only]) g.shiftHours[only] = JSON.parse(JSON.stringify(res[only])); else delete g.shiftHours[only];
    });
    closeModal(); await save('✓ Horarios de grupos guardados'); renderAll();
  };
}
async function clearGroupSched(id) {
  const g = state.groups.find(q => q.id === id);
  if (!g || !confirm(`¿Borrar los horarios de ${g.name}?`)) return;
  g.shiftHours = {}; await save(); renderAll();
}
async function deleteSched(id) {
  if (!confirm('¿Eliminar este horario?')) return;
  state.schedule = state.schedule.filter(s => s.id !== id);
  await save(); renderAll();
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
let rotDraft = [], rotDirty = false;   // el orden se edita en borrador y se guarda con el botón
function paintRot() {
  const el = $('#rt-rot-edit'); if (!el) return;
  el.innerHTML = rotDraft.map((t, i) => `<div class="rt-rotrow"><span class="rt-rotn">${i + 1}.</span>
      <div class="field" style="margin:0"><select data-rot="${i}">${SHIFTS.map(s => `<option value="${esc(s)}" ${s === t ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <button type="button" class="rt-btn" data-act="rot-up" data-id="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
      <button type="button" class="rt-btn" data-act="rot-down" data-id="${i}" ${i === rotDraft.length - 1 ? 'disabled' : ''} aria-label="Bajar">▼</button>
      <button type="button" class="rt-btn rt-danger" data-act="rot-del" data-id="${i}" ${rotDraft.length <= 1 ? 'disabled' : ''} aria-label="Quitar">✕</button></div>`).join('')
    + '<button type="button" class="rt-btn" data-act="rot-add">+ AGREGAR AL ORDEN</button>';
}
function rotMove(i, dir) {
  const j = i + dir; if (j < 0 || j >= rotDraft.length) return;
  [rotDraft[i], rotDraft[j]] = [rotDraft[j], rotDraft[i]]; rotDirty = true; paintRot();
}
let selectedConfigShift = '';
function renderSet() {
  if (!rotDirty) rotDraft = [...state.rotation];
  const opt = v => WEEK.map(([n, l]) => `<option value="${n}" ${n === v ? 'selected' : ''}>${l}</option>`).join('');
  const turns = SHIFTS.map(t => {
    const { s, e } = shiftWin(t), n = shiftLen(t), own = !!state.shiftDays?.[t];
    return `<div class="rt-config-shift ${shiftCls(t)}"><div class="rt-config-turn-title"><h3>${esc(t)}</h3><span class="rt-pill">${own ? 'DÍAS PROPIOS' : 'SEMANA BASE'} · ${n} DÍA${n === 1 ? '' : 'S'}</span></div>
      <button type="button" class="btn btn-sm rt-daybtn" data-act="edit-shift-days" data-id="${esc(t)}">ARRANCA ${esc(dayName(s).toUpperCase())} · TERMINA ${esc(dayName(e).toUpperCase())}</button>
      <div class="rt-actions"><button type="button" class="rt-btn" data-act="edit-shift-days" data-id="${esc(t)}">EDITAR DÍAS</button><button type="button" class="rt-btn rt-danger" data-act="del-shift" data-id="${esc(t)}" ${SHIFTS.length <= 1 ? 'disabled' : ''}>ELIMINAR TURNO</button></div></div>`;
  }).join('');
  $('#rt-set-card').innerHTML = `<div class="rt-set-grid rt-set-grid-new">
    <div class="rt-set-order"><div class="card-title">Orden de rotación</div><div id="rt-rot-edit" class="rt-rotedit"></div>
      <p class="rt-small" style="margin-top:12px">Cada semana el grupo pasa al siguiente turno de esta lista. Cada grupo comienza con el turno asignado en GRUPOS.</p>
      <form id="rt-sf" class="rt-config-cycle" style="margin-top:18px"><div class="card-title">Ciclo de rotación</div>
        <p class="rt-small">La fecha y la semana base son comunes a toda la rotación. La usan los turnos que no tienen días propios.</p>
        <div class="field"><label>Inicio del ciclo</label><input type="date" name="cycle" value="${esc(state.cycleStart)}"></div>
        <div class="rt-two"><div class="field"><label>Semana base · arranca</label><select name="wstart">${opt(weekStartDay())}</select></div>
        <div class="field"><label>Semana base · termina</label><select name="wend">${opt(weekEndDay())}</select></div></div>
        <div class="rt-form-actions"><button class="btn btn-green" type="submit">GUARDAR ORDEN Y CICLO</button></div></form></div>
    <section class="rt-config-turns"><div class="rt-config-head"><div><div class="card-title">Turnos</div><p class="rt-small">Cada turno tiene su propio botón con el día en que arranca y el día en que termina. Tocalo para cambiarlos.</p></div>
      <button type="button" class="btn btn-sm btn-outline" id="rt-config-add">+ AGREGAR TURNO</button></div>${turns}</section></div>`;
  paintRot();
  $('#rt-rot-edit').addEventListener('change', e => { const i = e.target.dataset.rot; if (i == null) return; rotDraft[+i] = e.target.value; rotDirty = true; });
  $('#rt-config-add').onclick = () => editShift();
  const f = $('#rt-sf');
  f.elements.wstart.onchange = e => { f.elements.wend.value = (+e.target.value + 6) % 7; };
  f.onsubmit = async e => {
    e.preventDefault();
    state.cycleStart = f.elements.cycle.value || state.cycleStart;
    state.weekStart = +f.elements.wstart.value; state.weekEnd = +f.elements.wend.value;
    state.rotation = [...rotDraft]; rotDirty = false;
    await save('✓ Configuración guardada'); renderAll();
  };
}
function renderHistory() {
  const el = $('#rt-history-list'); if (!el) return;
  const entries = [...(state.history || [])].sort((a, b) => String(b.changedAt || '').localeCompare(String(a.changedAt || '')));
  if (!entries.length) { el.innerHTML = '<div class="rt-emptybox">Todavía no hay modificaciones registradas.</div>'; return; }
  const fmt = value => { try { return new Date(value).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return value || '—'; } };
  const summary = (obj, type) => {
    if (!obj) return 'Sin registro';
    if (type === 'rotation') return `Orden: ${(obj.rotation || []).join(' → ')} · Inicio: ${obj.cycleStart || '—'} · Semana base: ${dayName(obj.weekStart ?? weekStartDay())} a ${dayName(obj.weekEnd ?? weekEndDay())} · Grupos: ${(obj.groups || []).map(g => `${g.name}: ${g.fixedShift || g.startShift || '—'}`).join(' / ') || '—'}`;
    const person = obj.person || {};
    const fixed = person.fixed?.in && person.fixed?.out ? `${person.fixed.in}–${person.fixed.out} (${person.fixed.shift || 'sin turno'})` : 'Sin horario fijo';
    const schedules = (obj.schedules || []).map(x => `${x.start}${x.end && x.end !== x.start ? ` a ${x.end}` : ''}: ${x.in}–${x.out} (${x.shift})`).join(' · ');
    if (type === 'group_schedule') return `${obj.name || 'Grupo'} · Turno: ${obj.fixedShift || obj.startShift || 'rotativo'} · ${Object.entries(obj.shiftHours || {}).map(([t, h]) => `${t}: ${h.in || '—'}–${h.out || '—'} (${(h.days || []).map(dayName).join(', ')})`).join(' · ') || 'Sin horarios configurados'}`;
    return `${fixed}${person.days ? ` · Días: ${daysTxt(person)}` : ''}${schedules ? ` · Horarios: ${schedules}` : ' · Sin horarios individuales'}`;
  };
  el.innerHTML = entries.map(item => `<article class="rt-card"><div class="rt-ct"><div><h3>${esc(item.title || 'Cambio registrado')}</h3><p>${esc(fmt(item.changedAt))} · ${esc(item.changedBy || 'Usuario')}</p></div><span class="rt-pill">${item.type === 'rotation' ? 'ROTACIÓN' : item.type === 'group_schedule' ? 'GRUPO' : 'PERSONA'}</span></div><div class="rt-meta"><b>Antes</b><br>${esc(summary(item.before, item.type))}<br><br><b>Después</b><br>${esc(summary(item.after, item.type))}</div></article>`).join('');
}

function renderAll() {
  if (!root) return;
  renderCal(); renderLegendShifts(); renderPeople(); renderShifts(); renderSched(); renderGroups(); renderEx(); renderComp(); renderSet(); renderHistory();
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
  if (historyUnsub) { historyUnsub(); historyUnsub = null; }
  closeModal();
  user = null; canEdit = false; loaded = false; docExists = false; rotDirty = false; setShifts(DEFAULT_SHIFTS);
  lastCommittedState = null;
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
    ? 'Hacé clic en una celda para cargar o modificar el horario de ese día. Los cambios los ven todos al instante.'
    : 'Solo lectura. La rotación la administra Administración.';
  $('#rt-add-person').style.display = $('#rt-add-group').style.display = $('#rt-add-ex').style.display = $('#rt-add-sched').style.display = $('#rt-add-gsched').style.display = $('#rt-add-shift').style.display = canEdit ? '' : 'none';
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
    const raw = snap.exists() ? snap.data() : null;
    const retainedHistory = state.history || [];
    state = normalize(raw);
    state.history = retainedHistory;
    lastCommittedState = JSON.parse(JSON.stringify(state));
    loaded = true;
    renderAll();

    // Migra automáticamente datos antiguos que aún guardaban un horario en un día libre trabajado.
    // La comparación se limita a los registros afectados para evitar escrituras repetidas.
    const scheduleChanged = JSON.stringify(raw?.schedule || []) !== JSON.stringify(state.schedule);
    const exceptionsChanged = JSON.stringify(raw?.exceptions || []) !== JSON.stringify(state.exceptions);
    if (snap.exists() && canEdit && !migrationInFlight && (scheduleChanged || exceptionsChanged)) {
      migrationInFlight = true;
      const migrationPayload = JSON.parse(JSON.stringify(state));
      delete migrationPayload.history;
      setDoc(ref, migrationPayload)
        .catch(error => {
          console.error('No se pudo migrar la configuración anterior:', error);
          toast('Se corrigió la vista, pero no se pudo actualizar el dato anterior en Firebase', true);
        })
        .finally(() => { migrationInFlight = false; });
    }
  }, err => {
    console.error(err);
    loaded = true;
    toast(err.code === 'permission-denied'
      ? 'Firestore no permite leer la colección "planning" (revisá las reglas)'
      : 'Error al cargar la rotación (' + err.message + ')', true);
    renderAll();
  });
  const historyQuery = query(collection(db, COL, DOC_ID, 'history'), orderBy('changedAt', 'desc'));
  historyUnsub = onSnapshot(historyQuery, snap => {
    state.history = snap.docs.map(item => item.data());
    if (loaded) renderHistory();
  }, error => { console.error('No se pudo cargar el historial:', error); });
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
    if (e.target.closest('#rt-goto-people')) { const v = $('#rt-view'); v.value = 'rt-people'; v.dispatchEvent(new Event('change')); editPerson(); return; }
    const cell = e.target.closest('td.rt-cell[data-p]');
    if (cell && canEdit) { dayEdit(cell.dataset.p, cell.dataset.d); return; }
    const b = e.target.closest('[data-act]');
    if (!b || !canEdit) return;
    const id = b.dataset.id;
    ({ 'edit-person': () => editPerson(id), 'del-person': () => deletePerson(id), 'edit-group': () => editGroup(id),
       'del-group': () => deleteGroup(id), 'edit-ex': () => editEx(id), 'del-ex': () => deleteEx(id),
       'edit-adj': () => editAdj(id), 'del-adj': () => deleteAdj(id),
       'edit-gsched': () => editGroupSched(id, b.dataset.shift || null), 'del-gsched': () => clearGroupSched(id),
       'edit-sched': () => editSched(id), 'del-sched': () => deleteSched(id),
       'rot-up': () => rotMove(+id, -1), 'rot-down': () => rotMove(+id, 1),
       'rot-del': () => { rotDraft.splice(+id, 1); rotDirty = true; paintRot(); },
       'rot-add': () => { rotDraft.push(SHIFTS.find(t => !rotDraft.includes(t)) || SHIFTS[0]); rotDirty = true; paintRot(); },
       'edit-shift-days': () => editShift(id), 'del-shift': () => deleteShift(id) })[b.dataset.act]?.();
  });
  $('#rt-add-person').onclick = () => editPerson();
  $('#rt-add-sched').onclick = () => editSched();
  $('#rt-add-gsched').onclick = () => editGroupSched();
  $('#rt-add-shift').onclick = () => editShift();
  $('#rt-sp').onchange = renderSched;
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
