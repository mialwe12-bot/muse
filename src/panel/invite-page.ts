/* eslint-disable max-len */
// Öffentliche Einladungsseite (benutzerdefinierter Installations-Link im Developer-Portal).
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

export const invitePage = ({botName, avatar, inviteUrl}: {botName: string; avatar: string | null; inviteUrl: string}) => `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(botName)} hinzufügen</title>
<meta property="og:title" content="${escapeHtml(botName)} – Musik-Bot für Discord">
<meta property="og:description" content="YouTube, Spotify und Jellyfin in deinem Sprachkanal, mit Autoplay, Radio, Liedtexten und DJ-Rolle.">
${avatar ? `<meta property="og:image" content="${escapeHtml(avatar)}">` : ''}
<meta name="theme-color" content="#8b5cf6">
<style>
:root{--bg:#0f1117;--panel:#171a23;--panel2:#1e2230;--line:#2a2f40;--text:#e7e9ef;--muted:#9aa1b5;--accent:#8b5cf6;--accent2:#5865f2}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 50% -10%,#2a1f4d 0%,var(--bg) 60%);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;padding:24px 16px}
.card{width:100%;max-width:560px;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:32px 28px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.35)}
.avatar{width:96px;height:96px;border-radius:50%;margin:0 auto 16px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;font-size:44px;overflow:hidden;border:3px solid var(--panel2)}
.avatar img{width:100%;height:100%}
h1{margin:0 0 6px;font-size:28px}
.sub{color:var(--muted);margin:0 0 24px}
ul{list-style:none;padding:0;margin:0 0 26px;display:grid;grid-template-columns:1fr 1fr;gap:10px;text-align:left}
li{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:14px}
li b{display:block;font-size:14px}
li span{color:var(--muted);font-size:13px}
.btn{display:inline-flex;align-items:center;gap:10px;background:#5865f2;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px;font-size:17px;transition:transform .1s,background .2s}
.btn:hover{background:#4752c4;transform:translateY(-1px)}
.note{margin:22px 0 0;color:var(--muted);font-size:13px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px;text-align:left}
.note code{background:var(--panel2);padding:1px 6px;border-radius:5px;color:var(--text)}
@media (max-width:480px){ul{grid-template-columns:1fr}.card{padding:26px 18px}}
</style>
</head>
<body>
<main class="card">
  <div class="avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : '🎵'}</div>
  <h1>${escapeHtml(botName)}</h1>
  <p class="sub">Musik für deinen Discord-Server</p>
  <ul>
    <li><b>🎶 YouTube, Spotify, Jellyfin</b><span>Links, Playlists oder einfach suchen</span></li>
    <li><b>📻 Autoplay &amp; Radio</b><span>spielt ähnliche Songs weiter</span></li>
    <li><b>📝 Liedtexte</b><span>mit /lyrics zum aktuellen Song</span></li>
    <li><b>🎧 DJ-Rolle &amp; Abstimmung</b><span>wer steuern darf, legst du fest</span></li>
  </ul>
  <a class="btn" href="${escapeHtml(inviteUrl)}">
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.85a13.6 13.6 0 0 0-.63 1.29 18.4 18.4 0 0 0-5.53 0 13 13 0 0 0-.64-1.29 19.7 19.7 0 0 0-4.92 1.52C.53 9.05-.32 13.62.1 18.13a19.9 19.9 0 0 0 6.03 3.04 14.6 14.6 0 0 0 1.29-2.1 12.9 12.9 0 0 1-2.03-.97l.5-.39a14.2 14.2 0 0 0 12.2 0l.5.39c-.65.38-1.33.71-2.04.97.37.74.8 1.44 1.29 2.1a19.8 19.8 0 0 0 6.04-3.04c.5-5.23-.84-9.76-3.56-13.76ZM8.02 15.36c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.2 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.97 0c-1.19 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.2 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z"/></svg>
    Zu Discord hinzufügen
  </a>
  <p class="note">🔑 ${escapeHtml(botName)} braucht auf deinem Server eine Lizenz. Nach dem Hinzufügen hast du 15 Minuten Zeit, sie mit <code>/license redeem</code> (Schlüssel) oder <code>/license activate</code> freizuschalten, sonst verlässt der Bot den Server wieder.</p>
</main>
</body>
</html>`;
