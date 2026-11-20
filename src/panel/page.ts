/* eslint-disable max-len */
// Oberfläche des Panels: eine Seite, Daten kommen per fetch aus /api/state.
// Alle Inhalte werden per textContent gesetzt (kein innerHTML mit Daten).
export const PANEL_HTML = `<!doctype html>
<html lang="de" data-state="__STATE__" data-discord="__DISCORD__">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ByteMusic Panel</title>
<style>
:root{--bg:#0f1117;--panel:#171a23;--panel2:#1e2230;--line:#2a2f40;--text:#e7e9ef;--muted:#9aa1b5;--accent:#8b5cf6;--accent2:#5865f2;--ok:#3ba55d;--warn:#e3b341;--err:#ed4245;--radius:12px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#b9a4ff}
header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:5}
header .logo{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;font-weight:700;overflow:hidden}
header .logo img{width:100%;height:100%}
header h1{font-size:17px;margin:0;flex:1}
header .me{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:14px}
header .me img{width:28px;height:28px;border-radius:50%}
nav{display:flex;gap:4px;padding:10px 16px;overflow-x:auto;border-bottom:1px solid var(--line);background:var(--panel)}
nav button{background:none;border:0;color:var(--muted);padding:8px 14px;border-radius:8px;cursor:pointer;font:inherit;white-space:nowrap}
nav button.active,nav button:hover{background:var(--panel2);color:var(--text)}
main{max-width:1100px;margin:0 auto;padding:20px 16px 60px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px}
.card .num{font-size:28px;font-weight:700}
.card .lbl{color:var(--muted);font-size:13px}
section{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-bottom:18px}
section h2{margin:0 0 12px;font-size:16px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
tr:last-child td{border-bottom:0}
.wrap{overflow-x:auto}
.who{display:flex;align-items:center;gap:8px}
.who img{width:24px;height:24px;border-radius:50%}
.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:600;background:var(--panel2);color:var(--muted)}
.pill.ok{background:#1f3a29;color:#7ee2a1}.pill.warn{background:#3d331a;color:#f1d27a}.pill.err{background:#45201f;color:#ff9b9d}.pill.info{background:#262b52;color:#aab3ff}
form.row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:12px}
label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}
input,select{background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px;font:inherit;min-width:0}
input:focus{outline:2px solid var(--accent);border-color:transparent}
a.btn{display:inline-block;text-decoration:none}
.btn{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}
.btn.discord{background:#5865f2;display:inline-flex;align-items:center;gap:8px;padding:11px 18px;font-size:15px}
.btn.secondary{background:var(--panel2);color:var(--text);border:1px solid var(--line)}
.btn.danger{background:transparent;color:#ff9b9d;border:1px solid #5a2a2a}
.btn.small{padding:5px 10px;font-size:13px;font-weight:500}
button.btn:disabled{opacity:.5;cursor:default}
.actions{display:flex;gap:6px;flex-wrap:wrap}
.muted{color:var(--muted)}
.empty{color:var(--muted);padding:8px 0}
#toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--line);padding:10px 16px;border-radius:10px;display:none;max-width:90vw;z-index:10}
#toast.err{border-color:var(--err)}#toast.ok{border-color:var(--ok)}
.center{min-height:100vh;display:grid;place-items:center;padding:20px}
.login{max-width:420px;text-align:center}
.login .logo{width:64px;height:64px;margin:0 auto 14px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;font-size:30px}
code{background:var(--panel2);padding:2px 6px;border-radius:6px}
.newkey{background:var(--bg);border:1px dashed var(--accent);border-radius:8px;padding:10px;margin-top:10px}
@media (max-width:640px){th.hide,td.hide{display:none}header h1{font-size:15px}}
</style>
</head>
<body>
<div id="root"></div>
<div id="toast"></div>
<script>
(function(){
const STATE = document.documentElement.dataset.state;
const root = document.getElementById('root');
function h(tag, attrs){
  const el = document.createElement(tag);
  if (attrs) for (const [k,v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (let i = 2; i < arguments.length; i++) {
    const c = arguments[i];
    if (c === undefined || c === null || c === false) continue;
    if (Array.isArray(c)) c.forEach(x => x && el.append(x)); else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
function toast(msg, kind){
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = kind || ''; t.style.display = 'block';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.style.display = 'none'; }, 4500);
}
if (STATE !== 'app') {
  const discord = document.documentElement.dataset.discord === '1';
  const titles = {expired:'Link abgelaufen', denied:'Kein Zugriff', 'oauth-failed':'Anmeldung fehlgeschlagen'};
  const notes = {expired:'Dieser Anmelde-Link ist abgelaufen oder wurde schon benutzt.', denied:'Dieses Discord-Konto darf das Panel nicht benutzen. Nur der Bot-Besitzer hat Zugriff.', 'oauth-failed':'Die Anmeldung über Discord hat nicht geklappt. Bitte noch einmal versuchen.'};
  root.append(h('div', {class:'center'}, h('div', {class:'card login'},
    h('div', {class:'logo', text:'🎵'}),
    h('h2', {text: titles[STATE] || 'ByteMusic Panel'}),
    notes[STATE] ? h('p', {class:'muted', text: notes[STATE]}) : null,
    discord ? h('a', {class:'btn discord', href:'/auth/discord'}, h('svg', {viewBox:'0 0 24 24', width:'20', height:'20', 'aria-hidden':'true'}), ' Mit Discord anmelden') : null,
    h('p', {class:'muted', style: discord ? 'margin-top:16px;font-size:13px' : undefined}, discord ? 'Oder in Discord ' : 'Zum Anmelden in Discord ', h('code', {text:'/panel'}), ' eingeben und den Einmal-Link öffnen (nur für den Bot-Besitzer).')
  )));
  const svg = root.querySelector('a.discord svg');
  if (svg) {
    const ns = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(ns, 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('width', '20'); icon.setAttribute('height', '20'); icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path'); path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M20.32 4.37A19.8 19.8 0 0 0 15.4 2.85a13.6 13.6 0 0 0-.63 1.29 18.4 18.4 0 0 0-5.53 0 13 13 0 0 0-.64-1.29 19.7 19.7 0 0 0-4.92 1.52C.53 9.05-.32 13.62.1 18.13a19.9 19.9 0 0 0 6.03 3.04 14.6 14.6 0 0 0 1.29-2.1 12.9 12.9 0 0 1-2.03-.97l.5-.39a14.2 14.2 0 0 0 12.2 0l.5.39c-.65.38-1.33.71-2.04.97.37.74.8 1.44 1.29 2.1a19.8 19.8 0 0 0 6.04-3.04c.5-5.23-.84-9.76-3.56-13.76ZM8.02 15.36c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.2 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.97 0c-1.19 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.2 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z');
    icon.append(path); svg.replaceWith(icon);
  }
  return;
}
let data = null;
let tab = (location.hash.match(/^#(\\w+)$/) || [])[1] || 'overview';
const fmtDate = iso => iso ? new Date(iso).toLocaleString('de-DE', {dateStyle:'medium', timeStyle:'short'}) : '–';
const fmtDay = iso => iso ? new Date(iso).toLocaleDateString('de-DE', {dateStyle:'medium'}) : '–';
async function api(action, body){
  const r = await fetch('/api/action/' + action, {method:'POST', headers:{'Content-Type':'application/json','X-ByteMusic':'1'}, body: JSON.stringify(body || {})});
  const j = await r.json().catch(() => ({error:'Antwort unlesbar'}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j.result;
}
async function load(){
  const r = await fetch('/api/state', {headers:{'X-ByteMusic':'1'}});
  if (r.status === 401) { location.reload(); return; }
  data = await r.json();
  render();
}
function person(id){
  const p = (data.people || {})[id] || {name:'unbekannt'};
  return h('span', {class:'who'}, p.avatar ? h('img', {src:p.avatar, alt:''}) : null, h('span', null, h('span', {text:p.name}), ' ', h('span', {class:'muted mono', text:id})));
}
function confirmRun(question, action, body, okText){
  if (question && !confirm(question)) return;
  return api(action, body).then(() => { toast(okText || 'Gespeichert', 'ok'); return load(); }).catch(e => toast(e.message, 'err'));
}
function formOf(fields, submitText, onSubmit){
  const inputs = {};
  const f = h('form', {class:'row', onsubmit: e => {
    e.preventDefault();
    const body = {};
    for (const [k, el] of Object.entries(inputs)) body[k] = el.type === 'checkbox' ? el.checked : el.value;
    const btn = f.querySelector('button'); btn.disabled = true;
    Promise.resolve(onSubmit(body)).finally(() => { btn.disabled = false; });
  }});
  for (const fd of fields) {
    const el = h('input', {type: fd.type || 'text', placeholder: fd.placeholder, required: fd.required, min: fd.min, max: fd.max, value: fd.value, style: fd.width ? 'width:' + fd.width : undefined});
    inputs[fd.name] = el;
    f.append(h('label', null, fd.label, el));
  }
  f.append(h('button', {class:'btn', type:'submit', text: submitText}));
  return f;
}
const stateLabel = {owner:['Besitzer da','ok'], licensed:['Lizenz','info'], grace:['Frist läuft','warn'], denied:['nicht erlaubt','err'], blocked:['gesperrt','err'], unknown:['?','']};
function validity(l){
  if (!l.expiresAt) return h('span', {class:'pill ok', text:'unbegrenzt'});
  const left = new Date(l.expiresAt).getTime() - Date.now();
  if (left <= 0) return h('span', {class:'pill err', text:'abgelaufen ' + fmtDay(l.expiresAt)});
  const days = Math.ceil(left / 86400000);
  return h('span', {class:'pill ' + (days <= 3 ? 'warn' : 'ok'), text:'bis ' + fmtDay(l.expiresAt) + ' (' + days + ' T.)'});
}
const views = {
  overview(){
    const active = data.licenses.filter(l => !l.expiresAt || new Date(l.expiresAt) > new Date());
    return [
      h('div', {class:'cards'},
        h('div', {class:'card'}, h('div', {class:'num', text:data.guilds.length}), h('div', {class:'lbl', text:'Server'})),
        h('div', {class:'card'}, h('div', {class:'num', text:active.length}), h('div', {class:'lbl', text:'aktive Lizenzen'})),
        h('div', {class:'card'}, h('div', {class:'num', text:data.keys.length}), h('div', {class:'lbl', text:'offene Schlüssel'})),
        h('div', {class:'card'}, h('div', {class:'num', text:data.blacklist.users.length + data.blacklist.guilds.length}), h('div', {class:'lbl', text:'Sperren'})),
        h('div', {class:'card'}, h('div', {class:'num', text: data.spotify.connected ? '✓' : '–'}), h('div', {class:'lbl', text:'Spotify verbunden'})),
      ),
      views.guilds(),
    ];
  },
  guilds(){
    const rows = data.guilds.slice().sort((a,b) => a.name.localeCompare(b.name)).map(g => {
      const [txt, cls] = stateLabel[g.state] || [g.state, ''];
      return h('tr', null,
        h('td', null, h('span', {class:'who'}, g.icon ? h('img', {src:g.icon, alt:''}) : null, h('span', null, h('span', {text:g.name}), ' ', h('span', {class:'muted mono', text:g.id})))),
        h('td', {class:'hide', text:g.members}),
        h('td', null, h('span', {class:'pill ' + cls, text:txt}), g.licenseId ? h('span', {class:'muted mono', text:' ' + g.licenseId}) : null, g.graceUntil ? h('span', {class:'muted', text:' bis ' + fmtDate(g.graceUntil)}) : null),
        h('td', {class:'hide'}, g.autoplay ? h('span', {class:'pill', text:'Autoplay'}) : null, ' ', g.radio ? h('span', {class:'pill', text:'Radio'}) : null),
        h('td', null, h('div', {class:'actions'},
          g.state === 'licensed' ? h('button', {class:'btn small secondary', text:'Lizenz lösen', onclick: () => confirmRun('Lizenz von „' + g.name + '“ lösen? Ohne Besitzer verlässt der Bot den Server.', 'guild-deactivate', {guildId:g.id}, 'Gelöst')}) : null,
          h('button', {class:'btn small danger', text:'Verlassen', onclick: () => confirmRun('Server „' + g.name + '“ verlassen?', 'guild-leave', {guildId:g.id}, 'Verlassen')}),
          h('button', {class:'btn small danger', text:'Sperren', onclick: () => { const reason = prompt('Grund für die Sperre von „' + g.name + '“ (optional):', ''); if (reason !== null) confirmRun(null, 'blacklist-guild-add', {guildId:g.id, reason}, 'Gesperrt'); }}),
        )));
    });
    return h('section', null, h('h2', {text:'Server (' + data.guilds.length + ')'}),
      rows.length ? h('div', {class:'wrap'}, h('table', null, h('thead', null, h('tr', null, h('th', {text:'Server'}), h('th', {class:'hide', text:'Mitglieder'}), h('th', {text:'Zugang'}), h('th', {class:'hide', text:'Extras'}), h('th', {text:''}))), h('tbody', null, rows))) : h('div', {class:'empty', text:'Der Bot ist auf keinem Server.'}));
  },
  licenses(){
    const rows = data.licenses.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(l => h('tr', null,
      h('td', {class:'mono', text:l.id}),
      h('td', null, person(l.userId)),
      h('td', null, h('span', {text: l.used.length + '/' + l.maxServers}), l.used.length ? h('div', {class:'muted', text: l.used.map(u => u.guildName).join(', ')}) : null),
      h('td', null, validity(l)),
      h('td', {class:'hide'}, h('span', {text: l.note || ''}), l.source === 'key' ? h('span', {class:'pill', text:'Schlüssel'}) : null),
      h('td', null, h('div', {class:'actions'},
        h('button', {class:'btn small secondary', text:'+30 Tage', onclick: () => confirmRun(null, 'license-extend', {id:l.id, days:30}, 'Verlängert')}),
        h('button', {class:'btn small secondary', text:'Ändern…', onclick: () => {
          const s = prompt('Neue Anzahl Server (leer = gleich lassen):', String(l.maxServers)); if (s === null) return;
          const d = prompt('Tage verlängern (leer = nicht verlängern, „u“ = unbegrenzt):', ''); if (d === null) return;
          confirmRun(null, 'license-extend', {id:l.id, servers: s && Number(s) !== l.maxServers ? Number(s) : undefined, days: d && d !== 'u' ? Number(d) : undefined, unlimited: d === 'u'}, 'Geändert');
        }}),
        h('button', {class:'btn small danger', text:'Entziehen', onclick: () => confirmRun('Lizenz ' + l.id + ' entziehen? Server ohne gültige Lizenz verlässt der Bot.', 'license-revoke', {id:l.id}, 'Entzogen')}),
      )),
    ));
    return [
      h('section', null, h('h2', {text:'Lizenz vergeben'}),
        h('p', {class:'muted', text:'Die Person kann damit ihre Server per /license activate freischalten. Tage leer lassen = unbegrenzt.'}),
        formOf([
          {name:'userId', label:'Discord-Nutzer-ID', placeholder:'123456789012345678', required:true, width:'200px'},
          {name:'servers', label:'Server', type:'number', min:1, max:100, value:'1', required:true, width:'90px'},
          {name:'days', label:'Tage', type:'number', min:1, placeholder:'unbegrenzt', width:'110px'},
          {name:'note', label:'Notiz', placeholder:'optional', width:'200px'},
        ], 'Vergeben', b => api('license-give', b).then(l => { toast('Lizenz ' + l.id + ' vergeben', 'ok'); return load(); }).catch(e => toast(e.message, 'err')))),
      h('section', null, h('h2', {text:'Lizenzen (' + data.licenses.length + ')'}),
        rows.length ? h('div', {class:'wrap'}, h('table', null, h('thead', null, h('tr', null, h('th', {text:'ID'}), h('th', {text:'Inhaber'}), h('th', {text:'Server'}), h('th', {text:'Gültig'}), h('th', {class:'hide', text:'Notiz'}), h('th', {text:''}))), h('tbody', null, rows))) : h('div', {class:'empty', text:'Noch keine Lizenzen.'})),
    ];
  },
  keys(){
    const created = h('div');
    const rows = data.keys.map(k => h('tr', null,
      h('td', {class:'mono', text:k.key}),
      h('td', {text:k.maxServers}),
      h('td', {text: k.days ? k.days + ' Tage ab Einlösen' : 'unbegrenzt'}),
      h('td', {class:'hide', text: fmtDate(k.createdAt)}),
      h('td', {class:'hide', text: k.note || ''}),
      h('td', null, h('div', {class:'actions'},
        h('button', {class:'btn small secondary', text:'Kopieren', onclick: () => navigator.clipboard.writeText(k.key).then(() => toast('Kopiert', 'ok'))}),
        h('button', {class:'btn small danger', text:'Löschen', onclick: () => confirmRun('Schlüssel ' + k.key + ' löschen?', 'key-delete', {key:k.key}, 'Gelöscht')}),
      )),
    ));
    return [
      h('section', null, h('h2', {text:'Schlüssel erstellen'}),
        h('p', {class:'muted', text:'Einlösen mit /license redeem. Die Laufzeit beginnt beim Einlösen.'}),
        formOf([
          {name:'servers', label:'Server', type:'number', min:1, max:100, value:'1', required:true, width:'90px'},
          {name:'days', label:'Tage', type:'number', min:1, placeholder:'unbegrenzt', width:'110px'},
          {name:'count', label:'Anzahl', type:'number', min:1, max:25, value:'1', width:'90px'},
          {name:'note', label:'Notiz', placeholder:'optional', width:'200px'},
        ], 'Erstellen', b => api('key-create', b).then(keys => {
          created.replaceChildren(h('div', {class:'newkey'}, h('div', {class:'muted', text:'Neu erstellt:'}), keys.map(k => h('div', {class:'mono', text:k.key}))));
          toast(keys.length + ' Schlüssel erstellt', 'ok'); return load();
        }).catch(e => toast(e.message, 'err'))),
        created),
      h('section', null, h('h2', {text:'Offene Schlüssel (' + data.keys.length + ')'}),
        rows.length ? h('div', {class:'wrap'}, h('table', null, h('thead', null, h('tr', null, h('th', {text:'Schlüssel'}), h('th', {text:'Server'}), h('th', {text:'Laufzeit'}), h('th', {class:'hide', text:'Erstellt'}), h('th', {class:'hide', text:'Notiz'}), h('th', {text:''}))), h('tbody', null, rows))) : h('div', {class:'empty', text:'Keine offenen Schlüssel.'})),
    ];
  },
  blacklist(){
    const users = data.blacklist.users.map(u => h('tr', null,
      h('td', null, person(u.userId)), h('td', {text:u.reason || '–'}), h('td', {class:'hide', text:fmtDate(u.addedAt)}),
      h('td', null, h('button', {class:'btn small secondary', text:'Entsperren', onclick: () => confirmRun(null, 'blacklist-user-remove', {userId:u.userId}, 'Entsperrt')}))));
    const guilds = data.blacklist.guilds.map(g => h('tr', null,
      h('td', null, h('span', {text:g.name}), ' ', h('span', {class:'muted mono', text:g.guildId})), h('td', {text:g.reason || '–'}), h('td', {class:'hide', text:fmtDate(g.addedAt)}),
      h('td', null, h('button', {class:'btn small secondary', text:'Entsperren', onclick: () => confirmRun(null, 'blacklist-guild-remove', {guildId:g.guildId}, 'Entsperrt')}))));
    const table = (rows, head) => rows.length ? h('div', {class:'wrap'}, h('table', null, h('thead', null, h('tr', null, h('th', {text:head}), h('th', {text:'Grund'}), h('th', {class:'hide', text:'Seit'}), h('th', {text:''}))), h('tbody', null, rows))) : h('div', {class:'empty', text:'Niemand gesperrt.'});
    return [
      h('section', null, h('h2', {text:'Gesperrte Nutzer (' + users.length + ')'}),
        h('p', {class:'muted', text:'Gesperrte Nutzer können den Bot nirgends bedienen.'}),
        table(users, 'Nutzer'),
        formOf([{name:'userId', label:'Nutzer-ID', required:true, placeholder:'123456789012345678', width:'200px'}, {name:'reason', label:'Grund', placeholder:'optional', width:'240px'}], 'Sperren',
          b => api('blacklist-user-add', b).then(() => { toast('Gesperrt', 'ok'); return load(); }).catch(e => toast(e.message, 'err')))),
      h('section', null, h('h2', {text:'Gesperrte Server (' + guilds.length + ')'}),
        h('p', {class:'muted', text:'Gesperrte Server verlässt der Bot sofort und tritt ihnen nicht wieder bei.'}),
        table(guilds, 'Server'),
        formOf([{name:'guildId', label:'Server-ID', required:true, placeholder:'123456789012345678', width:'200px'}, {name:'reason', label:'Grund', placeholder:'optional', width:'240px'}], 'Sperren',
          b => api('blacklist-guild-add', b).then(() => { toast('Gesperrt', 'ok'); return load(); }).catch(e => toast(e.message, 'err')))),
    ];
  },
  spotify(){
    const s = data.spotify;
    return h('section', null, h('h2', {text:'Spotify'}),
      s.connected
        ? [h('p', null, '✅ Verbunden mit ', h('strong', {text:s.displayName || 'Spotify'}), h('span', {class:'muted', text:' seit ' + fmtDate(s.connectedAt)})),
          h('p', {class:'muted', text:'Spotify-Playlists werden jetzt komplett über dieses Konto geladen (bis zum Playlist-Limit des Servers, /config set-playlist-limit). Klappt das nicht, nimmt der Bot wie bisher die öffentliche Embed-Seite (max. ~100 Titel).'}),
          h('div', {class:'actions'}, h('a', {class:'btn secondary', href:'/spotify/connect', text:'Neu verbinden'}),
            h('button', {class:'btn danger', text:'Trennen', onclick: () => confirmRun('Spotify-Konto trennen?', 'spotify-disconnect', {}, 'Getrennt')}))]
        : [h('p', {class:'muted', text:'Ohne Spotify-Konto liest der Bot Playlists über die öffentliche Embed-Seite, die nur ~100 Titel zeigt. Mit einem verbundenen Konto werden ganze Playlists geladen.'}),
          h('p', {class:'muted'}, 'Einmalig nötig: im Spotify-Developer-Dashboard bei der App als Redirect-URI eintragen: ', h('code', {text:s.redirectUri})),
          h('a', {class:'btn', href:'/spotify/connect', text:'Mit Spotify verbinden'})]);
  },
};
const tabs = [['overview','Übersicht'],['licenses','Lizenzen'],['keys','Schlüssel'],['blacklist','Blacklist'],['guilds','Server'],['spotify','Spotify']];
function render(){
  const content = views[tab] ? views[tab]() : views.overview();
  root.replaceChildren(
    h('header', null,
      h('div', {class:'logo'}, data.bot.avatar ? h('img', {src:data.bot.avatar, alt:''}) : '🎵'),
      h('h1', {text:(data.bot.name || 'ByteMusic') + ' Panel'}),
      h('div', {class:'me'}, data.me.avatar ? h('img', {src:data.me.avatar, alt:''}) : null, h('span', {class:'hide', text:data.me.name}),
        h('form', {method:'post', action:'/logout'}, h('button', {class:'btn small secondary', type:'submit', text:'Abmelden'})))),
    h('nav', null, tabs.map(([id, label]) => h('button', {class: id === tab ? 'active' : '', text:label, onclick: () => { tab = id; history.replaceState(null, '', '#' + id); render(); }}))),
    h('main', null, content));
}
const m = location.hash.match(/^#spotify(-ok)?:(.*)$/);
if (m) { tab = 'spotify'; history.replaceState(null, '', '#spotify'); setTimeout(() => toast(m[1] ? 'Spotify verbunden: ' + decodeURIComponent(m[2]) : 'Spotify: ' + decodeURIComponent(m[2]), m[1] ? 'ok' : 'err'), 300); }
load().catch(e => toast(e.message, 'err'));
})();
</script>
</body>
</html>`;
