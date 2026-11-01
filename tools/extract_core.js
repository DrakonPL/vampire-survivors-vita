// Estrae le tabelle di dati di Vampire Survivors (build Phaser 1.5.x) eseguendo i moduli webpack del gioco
// dentro QuickJS (tools/vs_setup.py): nessun dato del gioco sta nel repo. Prima parte: stub nel contesto globale;
// vs_setup.py esegue poi vendors.bundle.js e main.bundle.js (con l'avvio sostituito da globalThis.__req) e
// chiama vs_extract(), che restituisce i file come testo JSON.
// Stub universale: qualunque proprieta', chiamata o new restituisce un altro stub.
function stub(name) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'prototype') return t.prototype;
      if (typeof k === 'symbol') return undefined;
      if (!(k in t)) t[k] = stub(name + '.' + String(k));
      return t[k];
    },
    apply: () => stub(name + '()'),
    construct: () => stub('new ' + name),
  });
}

const sandbox = globalThis;
sandbox.console = { log() {}, warn() {}, error() {}, info() {} };
sandbox.self = sandbox.window = sandbox;
for (const g of ['Phaser', 'document', 'navigator', 'localStorage', 'require', 'process', 'steamworks', 'nw', 'electron'])
  sandbox[g] = stub(g);
Object.assign(sandbox, { setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {}, requestAnimationFrame() {} });
// @electron/remote risale la catena dei prototipi finche' sendSync non da' null.
const ipcRenderer = { sendSync: () => null, send() {}, on() {}, once() {}, invoke: async () => null };
sandbox.require = name => (name === 'electron' ? { ipcRenderer, remote: stub('remote') } : stub('require(' + name + ')'));


function vs_extract() {
const OUT = {}, LOG = [];
const req = sandbox.__req;

// Esegue tutti i moduli (quelli di scena/UI possono fallire: non servono).
const mods = {};
for (const id of Object.keys(req.m)) {
  try {
    mods[id] = req(id);
  } catch (e) {
    if (globalThis.VS_DEBUG) LOG.push(`modulo ${id}: ${String(e).slice(0, 160)}`);
  }
}

// Export letti chiave per chiave: alcuni getter (@electron/remote) lanciano eccezioni.
function entries(o) {
  const r = [];
  let ks = [];
  try { ks = Object.keys(o); } catch (e) {}
  for (const k of ks) {
    try { r.push([k, o[k]]); } catch (e) {}
  }
  return r;
}

// Enum: oggetti *Type con valori uguali alle chiavi (WHIP: 'WHIP').
const enums = {}, enumValues = {};
for (const ex of Object.values(mods)) {
  if (!ex || typeof ex !== 'object') continue;
  for (const [name, v] of entries(ex)) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !name.endsWith('Type')) continue;
    // stringa (WHIP: 'WHIP') o numerico TypeScript (T00_KILLER: 0, 0: 'T00_KILLER')
    const ks = Object.keys(v).filter(k => v[k] === k || (typeof v[k] === 'number' && v[v[k]] === k));
    if (ks.length >= 3) {
      enums[name] = ks;
      if (ks.some(k => typeof v[k] === 'number')) enumValues[name] = Object.fromEntries(ks.map(k => [k, v[k]]));
    }
  }
}
const enumOf = {};
for (const [en, ks] of Object.entries(enums)) for (const k of ks) (enumOf[k] = enumOf[k] || []).push(en);
// Enum numerici: le tabelle usano il valore come chiave ("0", "1"...).
for (const [en, n] of Object.entries(enumValues))
  for (const v of Object.values(n)) (enumOf[String(v)] = enumOf[String(v)] || []).push(en);

// Tabelle: oggetti con chiavi in gran parte di un enum e valori strutturati.
const tables = {};
for (const [id, ex] of Object.entries(mods)) {
  if (!ex || typeof ex !== 'object') continue;
  for (const [name, v] of entries(ex)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const ks = Object.keys(v);
    if (ks.length < 3) continue;
    const hits = {};
    for (const k of ks) for (const en of enumOf[k] || []) hits[en] = (hits[en] || 0) + 1;
    const best = Object.entries(hits).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= ks.length * 0.6 && ks.some(k => v[k] && typeof v[k] === 'object'))
      tables[`${name}_${id}`] = { keyEnum: best[0], count: ks.length, data: v };
  }
}

// Livelli: array con un elemento per minuto ({minute, minimum, frequency, enemies...}).
// La tabella StageType -> livello si riempie a runtime; qui si prendono i moduli dei livelli.
const stages = {};
for (const [id, ex] of Object.entries(mods)) {
  if (!ex || typeof ex !== 'object') continue;
  for (const [, v] of entries(ex)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const ks = Object.keys(v);
    if (!ks.length || !ks.every(k => (enums.StageType || []).includes(k))) continue;
    for (const k of ks)
      if (Array.isArray(v[k]) && v[k].length && v[k][0] && 'minute' in v[k][0]) stages[k] = v[k];
  }
}

OUT['stages.json'] = (JSON.stringify(stages, (k, v) => (typeof v === 'function' ? undefined : v)));
LOG.push(`livelli: ${Object.keys(stages).length} (${Object.keys(stages).join(', ')})`);
const noFn = (k, v) => (typeof v === 'function' ? undefined : v);
OUT['enums.json'] = (JSON.stringify({ names: enums, values: enumValues }, null, 1));
// Un file per tipo di contenuto; piu' tabelle dello stesso enum (es. nemici) si uniscono,
// tranne le armi: la tabella piu' grande e' quella base, l'altra i limit break.
const FILE = {
  CharacterType: 'characters', ItemType: 'items', PowerUpType: 'powerups', ArcanaType: 'arcana',
  EnemyType: 'enemies', AchievementType: 'achievements', SecretType: 'secrets', BGMType: 'music', PropType: 'props',
};
const byEnum = {};
for (const t of Object.values(tables)) (byEnum[t.keyEnum] = byEnum[t.keyEnum] || []).push(t);
for (const [en, ts] of Object.entries(byEnum)) {
  ts.sort((a, b) => b.count - a.count);
  // I potenziamenti del negozio hanno chiavi in comune con le armi (POWER, AREA...).
  const first = t => { const v = Object.values(t.data)[0]; return Array.isArray(v) ? v[0] : v; };
  const pu = ts.findIndex(t => first(t) && first(t).isPowerUp);
  if (pu >= 0) OUT['powerups.json'] = (JSON.stringify(ts.splice(pu, 1)[0].data, noFn));
  if (en === 'WeaponType') {
    OUT['weapons.json'] = (JSON.stringify(ts[0].data, noFn));
    if (ts[1]) OUT['weapons_limitbreak.json'] = (JSON.stringify(ts[1].data, noFn));
  } else if (FILE[en]) {
    OUT[FILE[en] + '.json'] = (JSON.stringify(Object.assign({}, ...ts.map(t => t.data)), noFn));
  }
}
LOG.push(`moduli ${Object.keys(req.m).length}, eseguiti ${Object.keys(mods).length}, enum ${Object.keys(enums).length}`);
for (const [k, t] of Object.entries(tables)) LOG.push(`  ${k}: ${t.count} voci per ${t.keyEnum}`);

// Crediti (UI_creditsEndingScene 0x8b19, UI_creditsScene 0x7e6c): il testo e' un array passato a setText dentro create().
// Si chiama create() con un finto this che registra quell'array; Lang.getLang lascia la chiave fra \u0001 e \u0002
// (si traduce a runtime). Gli export che il gioco riempie a runtime (SAFEAREA, Lang, default...) diventano stub.
{
  const any = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any), apply: () => any, construct: () => any });
  const GM = mods[String(0x5f07)];
  const Lang = { getLang: k => '\u0001' + k + '\u0002', scaleToMaxFast() {}, FONTFAMILY: '' };
  for (const ex of Object.values(mods)) { try { if (ex && typeof ex === 'object' && ex.default === undefined) ex.default = any; } catch (e) {} }
  if (GM) Object.assign(GM, { Lang, default: { Lang, Core: any, Sound: any }, SAFEAREA: { centerX: 0, centerY: 0, width: 512, height: 580, left: 0, right: 512, top: 0 },
    MASTER_SCALE: 1, DEFAULT_HEIGHT: 580, GET_RATIO: () => 1, Core: any, Sound: any });
  const ns = mods[String(0x16c14)];
  if (ns && typeof ns.NineSlice !== 'function') ns.NineSlice = any;
  const grab = id => {
    const ex = mods[String(id)];
    if (!ex || !ex.default || !ex.default.prototype) return null;
    let got = null;
    const rec = new Proxy(function () {}, { get: (t, k) => (k === 'setText' ? a => { if (Array.isArray(a)) got = a; return rec; } : k === Symbol.toPrimitive ? () => 0 : rec), apply: () => rec });
    const self = Object.create(ex.default.prototype);
    self.add = new Proxy({}, { get: (t, k) => (k === 'text' ? () => rec : any) });
    for (const k of ['physics', 'time', 'tweens', 'renderer', 'game', 'input', 'children', 'cameras', 'sys', 'scene', 'events']) self[k] = any;
    try { ex.default.prototype.create.call(self); } catch (e) { if (globalThis.VS_DEBUG) LOG.push(`crediti ${id}: ${e}`); }
    return got;
  };
  const credits = { ending: grab(0x8b19), menu: grab(0x7e6c) };
  OUT['credits.json'] = (JSON.stringify(credits));
  LOG.push(`crediti: fine ${credits.ending ? credits.ending.length : 0} righe, menu ${credits.menu ? credits.menu.length : 0}`);
}

return JSON.stringify({ files: OUT, log: LOG });
}
