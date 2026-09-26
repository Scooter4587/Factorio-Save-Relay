export const PAGE = String.raw`<!doctype html>
<html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>Factorio Save Relay · Scooter Universe</title>
<link rel="stylesheet" href="/factorio-relay/style.css"><script defer src="/factorio-relay/app.js"></script></head>
<body><div class="shell">
<header class="top"><a class="brand" href="https://scooteruniverse.eu/">SCOOTER<span>UNIVERSE</span></a><span class="tag">PRIVATE PILOT · 2 PLAYERS</span></header>
<main><section class="hero"><div class="eyebrow">FACTORIO / SHARED WORLD</div><h1>Jeden svet.<br><em>Dvaja hostitelia.</em></h1>
<p>Bezpečné odovzdanie save ZIPu medzi dvoma hráčmi. Toto je ručné testovacie ovládanie; Factorio súbor na tvojom PC stránka nemení.</p></section>
<div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
<section id="access" class="access"><div class="auth-choice" role="tablist" aria-label="Prístup k službe">
<button id="show-register" type="button" role="tab" aria-selected="true">Som tu prvýkrát</button>
<button id="show-login" type="button" role="tab" aria-selected="false" class="secondary">Už mám účet</button></div>
<article id="register-panel" class="card auth-panel" role="tabpanel"><div class="step">KROK 1 / TVOJ ÚČET</div><h2>Vytvoriť účet</h2>
<p>Účet vytvoríš raz. Potom sa prihlasuješ menom a heslom; registračný kľúč slúži iba na vstup do súkromného testu.</p>
<form id="register-form"><label>Meno účtu<input id="register-name" minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autocomplete="username" required placeholder="Scooter"></label>
<label>Heslo (aspoň 12 znakov)<input id="register-password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
<label>Registračný kľúč<input id="registration-key" type="password" autocomplete="off" required></label><button type="submit">Vytvoriť účet →</button></form></article>
<article id="login-panel" class="card auth-panel" role="tabpanel" hidden><div class="step">VITAJ SPÄŤ</div><h2>Prihlásiť sa</h2>
<form id="login-form"><label>Meno účtu<input id="login-name" autocomplete="username" required></label>
<label>Heslo<input id="login-password" type="password" autocomplete="current-password" required></label><button type="submit">Prihlásiť sa →</button></form>
<button id="show-reset" type="button" class="text-button">Zabudol som heslo</button> <button id="show-legacy" type="button" class="text-button">Mám pôvodný testovací kľúč</button></article>
<article id="legacy-panel" class="card auth-panel" hidden><div class="step">PÔVODNÝ TESTOVACÍ ÚČET</div><h2>Prejsť na meno a heslo</h2><p>Ak už máš účet zo starej verzie, prihlás sa jeho pôvodným prístupovým kľúčom. Potom si nastavíš meno a heslo bez straty sveta.</p>
<form id="legacy-form"><label>Pôvodný prístupový kľúč<input id="legacy-token" type="password" autocomplete="off" required></label><button type="submit">Pokračovať →</button></form><button id="legacy-back" type="button" class="text-button">Späť na prihlásenie</button></article>
<article id="reset-panel" class="card auth-panel" hidden><div class="step">OBNOVA PRÍSTUPU</div><h2>Nové heslo</h2>
<p>Použi núdzový kód, ktorý si si uložil pri registrácii. Obnova odhlási všetky tvoje zariadenia.</p>
<form id="reset-form"><label>Meno účtu<input id="reset-name" autocomplete="username" required></label>
<label>Núdzový kód<input id="reset-code" type="password" autocomplete="off" required></label>
<label>Nové heslo (aspoň 12 znakov)<input id="reset-password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
<button type="submit">Obnoviť prístup →</button></form><button id="reset-back" type="button" class="text-button">Späť na prihlásenie</button></article></section>
<section id="recovery" class="card recovery" hidden><div class="step">ULOŽ PRE PRÍPAD NÚDZE</div><h2>Tvoj núdzový kód</h2><p>Bežne sa prihlasuješ menom a heslom. Tento kód potrebuješ iba vtedy, ak heslo zabudneš. Zobrazíme ho len teraz; ulož si ho do správcu hesiel.</p><code id="recovery-token"></code><button id="copy-recovery" type="button" class="secondary">Skopírovať kód</button> <button id="recovery-done" type="button">Kód mám uložený</button></section>
<section id="dashboard" hidden><div class="dashboard-head"><div><div class="step">SÚKROMNÝ PANEL</div><h2 id="welcome">Spoločný svet</h2></div><button id="logout" class="text-button" type="button">Odhlásiť sa</button></div>
<article id="upgrade-panel" class="card recovery" hidden><div class="step">DOKONČI PRECHOD</div><h3>Nastav si meno a heslo</h3><p>Tvoj svet zostáva zachovaný. Po tomto kroku sa budeš prihlasovať menom a heslom.</p>
<form id="upgrade-form"><label>Meno účtu<input id="upgrade-name" minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" required></label>
<label>Heslo (aspoň 12 znakov)<input id="upgrade-password" type="password" minlength="12" maxlength="128" required></label><button type="submit">Nastaviť prihlásenie →</button></form></article>
<section id="setup"><p class="onboarding">Krok 2: prvý hráč vytvorí svet, druhý prijme jeho pozvánku. Potom môžete pripojiť PC aplikáciu.</p><div class="grid"><article class="card"><div class="step">PRVÝ HRÁČ</div><h3>Vytvoriť svet</h3><p>Prvý hráč vytvorí váš jediný spoločný svet.</p><form id="world-form"><label>Názov sveta<input id="world-name" required maxlength="80" placeholder="Náš Factorio svet"></label><button type="submit">Vytvoriť svet →</button></form></article>
<article class="card"><div class="step">DRUHÝ HRÁČ</div><h3>Prijať pozvánku</h3><p>Vlož jednorazový kód od vlastníka sveta.</p><form id="redeem-form"><label>Kód pozvánky<input id="invite-code" required autocomplete="off" placeholder="fsr_invite.…"></label><button class="secondary" type="submit">Pripojiť sa →</button></form></article></div></section>
<section id="world-panel" hidden><div class="grid"><article class="card world-card"><div class="step">ZVOLENÝ SVET</div><h3 id="world-title"></h3><dl><div><dt>Aktuálna verzia</dt><dd id="revision">—</dd></div><div><dt>Hostiteľ</dt><dd id="host">—</dd></div><div><dt>Tvoja rola</dt><dd id="role">—</dd></div></dl><button id="refresh" class="secondary" type="button">Obnoviť stav</button></article>
<article class="card"><div class="step">ODOVZDANIE</div><h3>Aktuálny save</h3><p>Stiahni a over aktuálny ZIP pred ďalším hostovaním. Ukladá sa do priečinka sťahovania, nie priamo do Factorio saves.</p><button id="download" type="button">Stiahnuť aktuálny ZIP ↓</button><p id="download-state" class="small"></p></article></div>
<div class="grid lower"><article class="card"><div class="step">NAHRAŤ NOVÚ VERZIU</div><h3>Odovzdať save</h3><p>Po skončení hry vyber kópiu Factorio save ZIPu. Pred odovzdaním musíš mať v tejto relácii stiahnutú aktuálnu verziu.</p>
<form id="upload-form"><label>Save ZIP<input id="save-file" type="file" accept=".zip,application/zip" required></label><button type="submit">Nahrať a odovzdať ↑</button></form><p class="small">Limit testovacej služby: 90 MB na ZIP; pri kolízii sa aktuálny svet neprepíše.</p></article>
<article class="card"><div class="step">HRÁČI</div><h3>Pozvánka</h3><p>Vlastník môže vytvoriť jednorazový kód platný 24 hodín.</p><button id="create-invite" class="secondary" type="button">Vytvoriť pozvánku</button><div id="invite-result" hidden><p>Kód pošli druhému hráčovi súkromne:</p><code id="invite-output"></code></div></article></div>
<article class="card history"><div class="step">HISTÓRIA</div><h3>Verzie sveta</h3><div id="revisions" class="revision-list">Zatiaľ žiadne verzie.</div></article>
<article class="card app-next"><div class="step">KROK 3 / PC APLIKÁCIA</div><h3>Pripoj svoje PC</h3><p>Po spárovaní hráčov sa do aplikácie prihlásiš týmto účtom a vyberieš lokálny save. Aktuálna testovacia aplikácia ešte nepracuje bezpečne s reálnym Factorio saves priečinkom; verejné stiahnutie pripravíme po dvojpočítačovom teste.</p></article></section></section>
<footer>Factorio Save Relay · súkromný test · existujúci save na PC zostáva nedotknutý</footer></main></div></body></html>`;

export const STYLE = String.raw`:root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#f3f0e8;background:#121b23;font-synthesis:none}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 72% 9%,#34494c 0,#17232b 31%,#111920 70%);min-height:100vh}button,input{font:inherit}button{cursor:pointer;border:0;border-radius:8px;padding:13px 18px;background:#d4ff54;color:#14201c;font-weight:750;transition:transform .15s,opacity .15s}button:hover{transform:translateY(-2px)}button:disabled{opacity:.45;cursor:wait;transform:none}.secondary{background:#25363c;color:#e9f3e0;border:1px solid #4c6262}.text-button{background:transparent;color:#c9e990;padding:8px}.shell{max-width:1160px;margin:auto;padding:0 28px}.top{height:80px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #3b4c50}.brand{text-decoration:none;color:#fff;font-weight:900;letter-spacing:.09em}.brand span{color:#d4ff54}.tag,.step,.eyebrow{font-size:11px;font-weight:800;letter-spacing:.19em;color:#d4ff54}.tag{border:1px solid #658062;border-radius:99px;padding:9px 12px}.hero{padding:76px 0 52px;max-width:710px}.hero h1{font-size:clamp(44px,6.5vw,83px);line-height:1.02;letter-spacing:-.055em;margin:20px 0}.hero p{font-size:18px;line-height:1.6;color:#becdca;max-width:590px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card{background:#1e2c33;border:1px solid #405258;border-radius:15px;padding:28px;box-shadow:0 16px 35px #0911162e}.card h2,.card h3{font-size:25px;margin:15px 0 10px;letter-spacing:-.03em}.card p{color:#b4c4c0;line-height:1.55}.card form{display:flex;flex-direction:column;gap:14px;margin-top:25px}.card label{display:flex;flex-direction:column;gap:7px;color:#dce7e0;font-size:13px;font-weight:650}.card input{width:100%;background:#132028;color:#fff;border:1px solid #506369;border-radius:7px;padding:12px 13px;outline:none}.card input:focus{border-color:#d4ff54}.card input[type=file]{cursor:pointer}.notice{padding:14px 18px;margin:0 0 20px;border:1px solid #d4ff54;border-radius:8px;background:#293a2c;color:#f5ffe0}.notice.error{border-color:#ef8b76;background:#3c2928}.recovery{margin:18px 0;border-color:#d4ff54}.recovery code,.card code{display:block;overflow-wrap:anywhere;padding:13px;background:#0e191f;border:1px solid #536b68;border-radius:7px;color:#d4ff54;margin:15px 0}.dashboard-head{display:flex;justify-content:space-between;align-items:end;margin-bottom:20px}.dashboard-head h2{font-size:36px;margin:8px 0}.world-card dl{margin:24px 0}.world-card dl div{display:flex;justify-content:space-between;border-top:1px solid #405258;padding:12px 0;gap:12px}.world-card dt{color:#a9bab7}.world-card dd{margin:0;text-align:right;font-weight:750}.lower{margin-top:18px}.small{font-size:13px}.history{margin-top:18px}.revision-row{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #405258;padding:14px 0;align-items:center}.revision-row span{color:#b5c4c0}.revision-row button{padding:8px 11px;white-space:nowrap}.access{max-width:560px}.auth-choice{display:flex;gap:10px;margin-bottom:14px}.auth-choice button{flex:1}.auth-panel{min-height:330px}.auth-panel .text-button{margin-top:15px}.onboarding{color:#dce7e0;margin:0 0 18px}.app-next{margin-top:18px;border-color:#637b57}footer{padding:40px 0;color:#899f9e;font-size:12px}[hidden]{display:none!important}@media(max-width:700px){.shell{padding:0 18px}.top{height:68px}.tag{font-size:9px;letter-spacing:.08em}.hero{padding:48px 0 32px}.grid{grid-template-columns:1fr}.card{padding:22px}.dashboard-head h2{font-size:29px}}`;

export const SCRIPT = String.raw`'use strict';
const base = '/factorio-relay/v1';
const $ = (id) => document.getElementById(id);
let identity = null;
let world = null;
let downloadedRevision = -1;
let busy = false;

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
}
function status(error) {
  const messages = { unauthorized:'Prihlásenie vypršalo. Prihlás sa znova.',invalid_credentials:'Meno účtu alebo heslo nie je správne.',invalid_recovery:'Meno účtu alebo núdzový kód nie je správny.',invalid_login_name:'Meno účtu môže mať 3–32 znakov: písmená bez diakritiky, čísla, bodku, podčiarkovník alebo pomlčku.',invalid_password:'Heslo musí mať aspoň 12 znakov.',account_exists:'Toto meno účtu už niekto používa.',account_upgrade_unavailable:'Účet už má prihlásenie alebo je toto meno obsadené.',registration_denied:'Registračný kľúč nie je správny.',registration_disabled:'Registrácia je momentálne vypnutá.',too_many_attempts:'Príliš veľa pokusov. Skús to o 15 minút.',pilot_full:'Dvaja hráči sú už zaregistrovaní.',pilot_world_limit:'Svet už existuje. Vyžiadaj si pozvánku.',lease_unavailable:'Svet práve vlastní druhý hostiteľ alebo sa zmenila verzia. Obnov stav.',upload_conflict:'Save sa zmenil počas nahrávania. Tvoja kópia sa neprepísala cez aktuálny svet.',invalid_zip:'Súbor nie je podporovaný alebo úplný ZIP.' };
  return messages[error.code] || error.message || 'Požiadavka zlyhala.';
}
async function api(path, options = {}) {
  const response = await fetch(base + path, { credentials:'same-origin', cache:'no-store', ...options });
  if (!response.ok) {
    let data = {};
    try { data = await response.json(); } catch (_) {}
    const err = new Error(status(data.error || {}));
    err.code = data.error && data.error.code;
    throw err;
  }
  return response;
}
async function data(path, body, method = 'POST', headers = {}) {
  return (await api(path, { method, headers: { 'content-type':'application/json', ...headers }, body:JSON.stringify(body) })).json();
}
function working(value) {
  busy = value;
  document.querySelectorAll('button').forEach(button => { if (button.id !== 'logout') button.disabled = value || (button.id === 'download' && (!world || world.currentRevision === 0)); });
}
async function action(task) {
  if (busy) return;
  working(true);
  try { await task(); } catch (error) { notice(error.message, true); }
  finally { working(false); }
}
function signedIn(value) {
  identity = value;
  $('access').hidden = !!value;
  $('dashboard').hidden = !value;
  $('recovery').hidden = true;
  $('upgrade-panel').hidden = !value || !!value.accountConfigured;
  if (value) $('welcome').textContent = 'Ahoj, ' + value.displayName;
}
function authPanel(name) {
  $('register-panel').hidden = name !== 'register';
  $('login-panel').hidden = name !== 'login';
  $('reset-panel').hidden = name !== 'reset';
  $('legacy-panel').hidden = name !== 'legacy';
  $('show-register').setAttribute('aria-selected', String(name === 'register'));
  $('show-login').setAttribute('aria-selected', String(name !== 'register'));
  $('show-register').classList.toggle('secondary', name !== 'register');
  $('show-login').classList.toggle('secondary', name === 'register');
}
async function refresh() {
  const worlds = (await (await api('/worlds')).json()).worlds;
  world = worlds[0] || null;
  $('setup').hidden = !!world;
  $('world-panel').hidden = !world;
  if (!world) return;
  world = (await (await api('/worlds/' + world.id)).json()).world;
  $('world-title').textContent = world.name;
  $('revision').textContent = world.currentRevision === 0 ? 'Bez save ZIPu' : '#' + world.currentRevision;
  $('role').textContent = world.role === 'owner' ? 'Vlastník' : 'Hráč';
  $('host').textContent = world.hostDeviceId ? (world.hostDeviceId === identity.deviceId ? 'Ty' : 'Druhý hráč') : 'Voľný';
  $('download').disabled = world.currentRevision === 0;
  $('create-invite').hidden = world.role !== 'owner';
  $('download-state').textContent = downloadedRevision === world.currentRevision && world.currentRevision > 0 ? 'Aktuálna verzia bola overená a stiahnutá v tejto relácii.' : '';
  const revisions = (await (await api('/worlds/' + world.id + '/revisions')).json()).revisions;
  const list = $('revisions'); list.replaceChildren();
  if (!revisions.length) { list.textContent = 'Zatiaľ žiadne verzie.'; return; }
  revisions.forEach(rev => {
    const row = document.createElement('div'); row.className = 'revision-row';
    const label = document.createElement('span');
    label.textContent = '#' + rev.revision + ' · ' + rev.status + ' · ' + (rev.fileSize / 1048576).toFixed(1) + ' MB';
    row.append(label);
    if (rev.status === 'current' || rev.status === 'archived' || rev.status === 'conflict') {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Stiahnuť';
      button.addEventListener('click', () => action(() => download(rev.revision)));
      row.append(button);
    }
    list.append(row);
  });
}
async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}
async function download(revision) {
  if (!world) return;
  const path = '/worlds/' + world.id + (revision ? '/revisions/' + revision : '') + '/download';
  const response = await api(path);
  const bytes = await response.arrayBuffer();
  const expected = response.headers.get('x-save-sha256');
  if (!expected || await digest(bytes) !== expected.toLowerCase()) throw new Error('Stiahnutý ZIP neprešiel kontrolou SHA-256. Súbor sa neuložil.');
  const number = Number(response.headers.get('x-save-revision'));
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Chýba číslo verzie save súboru.');
  const url = URL.createObjectURL(new Blob([bytes], {type:'application/zip'}));
  const link = document.createElement('a'); link.href = url; link.download = 'factorio-relay-revision-' + number + '.zip';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  if (number === world.currentRevision) downloadedRevision = number;
  $('download-state').textContent = 'ZIP #' + number + ' overený a odovzdaný prehliadaču na stiahnutie.';
  notice('ZIP #' + number + ' bol overený. Teraz testuj iba s kópiou save; jediný pôvodný súbor nechaj nedotknutý.');
}
async function upload() {
  if (!world) return;
  const file = $('save-file').files[0];
  if (!file || !file.name.toLowerCase().endsWith('.zip')) throw new Error('Vyber Factorio save ZIP.');
  if (file.size < 22 || file.size > 90000000) throw new Error('ZIP musí mať 22 bajtov až 90 MB.');
  await refresh();
  if (world.hostDeviceId) throw new Error('Svet momentálne drží hostiteľ. Skús to po jeho odovzdaní.');
  if (world.currentRevision > 0 && downloadedRevision !== world.currentRevision) {
    throw new Error('Najprv stiahni a over aktuálnu verziu #' + world.currentRevision + ' v tejto relácii.');
  }
  const baseRevision = world.currentRevision;
  const sha256 = await digest(await file.arrayBuffer());
  let token = null; let timer = null; let renewalError = null;
  try {
    const claim = await data('/worlds/' + world.id + '/lock/acquire', {expectedRevision:baseRevision});
    token = claim.lease.token;
    timer = setInterval(async () => {
      try { await data('/worlds/' + world.id + '/lock/renew', {lockToken:token}); }
      catch (error) { renewalError = error; clearInterval(timer); }
    }, 60000);
    notice('Nahrávam ZIP. Stránku nezatváraj.');
    const begun = await data('/worlds/' + world.id + '/uploads/begin', {baseRevision,lockToken:token,sha256,fileSize:file.size});
    const content = begun.upload.contentPath;
    if (!content.startsWith('/v1/worlds/' + world.id + '/uploads/')) throw new Error('Služba vrátila neplatnú adresu nahrávania.');
    await api(content.slice(3), {method:'PUT',headers:{'content-type':'application/zip','x-relay-lock':token},body:file});
    if (renewalError) throw renewalError;
    const result = await data('/worlds/' + world.id + '/uploads/finalize', {uploadId:begun.upload.id,lockToken:token});
    downloadedRevision = -1;
    $('save-file').value = '';
    notice('Save ZIP bol overený a odovzdaný ako verzia #' + result.revision.revision + '. Druhý hráč ho teraz môže stiahnuť.');
  } finally {
    if (timer) clearInterval(timer);
    if (token) { try { await data('/worlds/' + world.id + '/lock/release', {lockToken:token}); } catch (_) {} }
    await refresh();
  }
}
async function boot() {
  try { const result = await (await api('/me')).json(); signedIn(result.identity); await refresh(); }
  catch (_) { signedIn(null); }
}
$('show-register').addEventListener('click', () => authPanel('register'));
$('show-login').addEventListener('click', () => authPanel('login'));
$('show-reset').addEventListener('click', () => authPanel('reset'));
$('reset-back').addEventListener('click', () => authPanel('login'));
$('show-legacy').addEventListener('click', () => authPanel('legacy'));
$('legacy-back').addEventListener('click', () => authPanel('login'));
$('legacy-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const result = await data('/browser/session', {token:$('legacy-token').value.trim()});
  $('legacy-token').value = ''; signedIn(result.identity); await refresh();
  notice(result.identity.accountConfigured ? 'Prihlásenie úspešné.' : 'Nastav si meno a heslo. Svet zostane zachovaný.');
}); });
$('login-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const result = await data('/browser/session', {username:$('login-name').value.trim(),password:$('login-password').value});
  $('login-password').value = '';
  signedIn(result.identity); await refresh(); notice('Prihlásenie úspešné.');
}); });
$('register-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const username = $('register-name').value.trim();
  const response = await api('/devices/register', {method:'POST',headers:{'content-type':'application/json','x-relay-registration-key':$('registration-key').value.trim()},body:JSON.stringify({username,displayName:username,deviceName:'Webový prehliadač',password:$('register-password').value})});
  const result = await response.json(); $('registration-key').value = ''; $('register-password').value = '';
  signedIn({userId:result.user.id,displayName:result.user.displayName,deviceId:result.device.id,deviceName:result.device.deviceName,accountConfigured:1});
  $('recovery-token').textContent = result.recoveryCode; $('recovery').hidden = false; await refresh();
  notice('Účet je vytvorený. Ulož si núdzový kód; na bežné prihlásenie stačí meno a heslo.');
}); });
$('upgrade-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const result = await data('/accounts/upgrade', {username:$('upgrade-name').value.trim(),password:$('upgrade-password').value});
  $('upgrade-password').value = ''; signedIn({...identity,accountConfigured:1});
  $('recovery-token').textContent = result.recoveryCode; $('recovery').hidden = false;
  notice('Prihlásenie je nastavené. Ulož si núdzový kód.');
}); });
$('reset-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
  const result = await data('/accounts/recover', {username:$('reset-name').value.trim(),recoveryCode:$('reset-code').value.trim(),newPassword:$('reset-password').value});
  $('reset-code').value = ''; $('reset-password').value = '';
  $('recovery-token').textContent = result.recoveryCode; $('recovery').hidden = false;
  authPanel('login'); notice('Heslo bolo zmenené. Ulož si nový núdzový kód a prihlás sa.');
}); });
$('copy-recovery').addEventListener('click', () => action(async () => {
  await navigator.clipboard.writeText($('recovery-token').textContent);
  notice('Núdzový kód je skopírovaný. Ulož si ho na bezpečné miesto.');
}));
$('recovery-done').addEventListener('click', () => { $('recovery-token').textContent = ''; $('recovery').hidden = true; });
$('logout').addEventListener('click', () => action(async () => { await api('/browser/session',{method:'DELETE'}); downloadedRevision=-1; world=null; signedIn(null); authPanel('login'); $('register-name').value=''; notice('Odhlásenie hotové.'); }));
$('world-form').addEventListener('submit', event => { event.preventDefault(); action(async () => { await data('/worlds',{name:$('world-name').value.trim()}); await refresh(); notice('Svet bol vytvorený.'); }); });
$('redeem-form').addEventListener('submit', event => { event.preventDefault(); action(async () => { await data('/invites/redeem',{code:$('invite-code').value.trim()}); $('invite-code').value=''; await refresh(); notice('Si pripojený k svetu.'); }); });
$('create-invite').addEventListener('click', () => action(async () => { const result = await data('/worlds/' + world.id + '/invites',{}); $('invite-output').textContent=result.invite.code; $('invite-result').hidden=false; notice('Pozvánka je platná 24 hodín a dá sa použiť iba raz.'); }));
$('refresh').addEventListener('click', () => action(async () => { await refresh(); notice('Stav sveta je aktuálny.'); }));
$('download').addEventListener('click', () => action(() => download()));
$('upload-form').addEventListener('submit', event => { event.preventDefault(); action(upload); });
boot();`;
