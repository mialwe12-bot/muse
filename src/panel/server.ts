import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {Client} from 'discord.js';
import {DATA_DIR} from '../services/config.js';
import {
  addGuildToBlacklist, addToBlacklist, getBlacklist, getGuildBlacklist, isOwner, removeFromBlacklist, removeGuildFromBlacklist,
} from '../utils/access.js';
import {
  checkAllGuilds, createKey, deactivateGuild, deleteKey, extendLicense, getGuildState, giveLicense, leaveGuild, leaveIfNotAllowed,
  listKeys, listLicenses, revokeLicenses,
} from '../utils/licenses.js';
import {connectSpotify, disconnectSpotify, spotifyAuthUrl, spotifyStatus} from '../services/spotify-user.js';
import {listGuildExtras} from '../utils/guild-extras.js';
import {PANEL_HTML} from './page.js';

/*
 * Web-Panel für den Bot-Besitzer (Lizenzen, Schlüssel, Blacklist, Server,
 * Spotify-Verbindung). Anmeldung über einen Einmal-Link aus /panel in Discord,
 * danach ein Sitzungs-Cookie (7 Tage). Läuft im Bot-Prozess auf PANEL_PORT
 * (Standard: der Pelican-Port SERVER_PORT) hinter Nginx Proxy Manager.
 */

const SESSION_FILE = path.join(DATA_DIR, 'panel-sessions.json');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_TOKEN_MS = 10 * 60 * 1000;
const COOKIE = 'bm_session';

export const panelUrl = () => (process.env.PANEL_URL?.trim() || 'https://music.byte-bot.xyz').replace(/\/$/, '');
const spotifyRedirectUri = () => `${panelUrl()}/spotify/callback`;

type Session = {userId: string; expiresAt: number; spotifyState?: string};

const loginTokens = new Map<string, {userId: string; expiresAt: number}>();
let sessions = new Map<string, Session>();

const loadSessions = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) as Record<string, Session>;
    sessions = new Map(Object.entries(raw).filter(([, session]) => session.expiresAt > Date.now()));
  } catch {
    sessions = new Map();
  }
};

const saveSessions = () => {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions)), {mode: 0o600});
  } catch (error: unknown) {
    console.warn(`Panel-Sitzungen nicht gespeichert: ${String((error as Error).message ?? error)}`);
  }
};

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Einmal-Link für /panel (10 Minuten gültig). */
export const createLoginLink = (userId: string): string => {
  const token = crypto.randomBytes(24).toString('base64url');
  loginTokens.set(hash(token), {userId, expiresAt: Date.now() + LOGIN_TOKEN_MS});
  return `${panelUrl()}/login?token=${token}`;
};

const parseCookies = (header?: string) => Object.fromEntries((header ?? '').split(';').map(part => {
  const index = part.indexOf('=');
  return index === -1 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
}));

const send = (response: http.ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8', headers: Record<string, string> = {}) => {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...headers,
  });
  response.end(body);
};

const json = (response: http.ServerResponse, status: number, data: unknown) => send(response, status, JSON.stringify(data), 'application/json; charset=utf-8');

const redirect = (response: http.ServerResponse, location: string, headers: Record<string, string> = {}) => {
  response.writeHead(302, {Location: location, 'Cache-Control': 'no-store', ...headers});
  response.end();
};

const readBody = async (request: http.IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
  let size = 0;
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > 64 * 1024) {
      reject(new Error('Anfrage zu groß'));
      request.destroy();
      return;
    }

    chunks.push(chunk);
  });
  request.on('end', () => {
    try {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve(text ? JSON.parse(text) as Record<string, unknown> : {});
    } catch {
      reject(new Error('ungültiges JSON'));
    }
  });
  request.on('error', reject);
});

const str = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const int = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const snowflake = (value: unknown) => {
  const id = str(value, 25);
  if (!/^\d{17,20}$/.test(id)) {
    throw new Error('ungültige ID (17–20 Ziffern)');
  }

  return id;
};

const userCache = new Map<string, {name: string; avatar: string | null}>();
const describeUsers = async (client: Client, ids: string[]) => {
  const result: Record<string, {name: string; avatar: string | null}> = {};
  await Promise.all([...new Set(ids)].map(async id => {
    if (!userCache.has(id)) {
      try {
        const user = await client.users.fetch(id);
        userCache.set(id, {name: user.globalName ? `${user.globalName} (@${user.username})` : `@${user.username}`, avatar: user.displayAvatarURL({size: 64})});
      } catch {
        userCache.set(id, {name: 'unbekannt', avatar: null});
      }
    }

    result[id] = userCache.get(id)!;
  }));
  return result;
};

const buildState = async (client: Client, userId: string) => {
  const [licenses, keys, users, guildBlacklist, spotify, extras] = await Promise.all([
    listLicenses(), listKeys(), getBlacklist(), getGuildBlacklist(), spotifyStatus(), listGuildExtras(),
  ]);
  const guilds = await Promise.all(client.guilds.cache.map(async guild => {
    const state = await getGuildState(guild).catch(() => ({kind: 'unknown' as const}));
    return {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({size: 64}),
      members: guild.memberCount,
      state: state.kind,
      licenseId: state.kind === 'licensed' ? state.activation.licenseId : undefined,
      graceUntil: state.kind === 'grace' ? state.until.toISOString() : undefined,
      radio: Boolean(extras[guild.id]?.radioChannelId),
      autoplay: Boolean(extras[guild.id]?.autoplay),
    };
  }));
  const people = await describeUsers(client, [userId, ...licenses.map(license => license.userId), ...users.map(entry => entry.userId)]);
  return {
    me: {id: userId, ...people[userId]},
    bot: {name: client.user?.username ?? 'ByteMusic', avatar: client.user?.displayAvatarURL({size: 64}) ?? null},
    guilds,
    licenses,
    keys,
    blacklist: {users, guilds: guildBlacklist},
    people,
    spotify: {...spotify, redirectUri: spotifyRedirectUri()},
  };
};

type Handler = (body: Record<string, unknown>, client: Client) => Promise<unknown>;

const actions: Record<string, Handler> = {
  async 'license-give'(body, client) {
    const userId = snowflake(body.userId);
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
      throw new Error('diesen Discord-Nutzer gibt es nicht');
    }

    if (user.bot) {
      throw new Error('Bots können keine Lizenz bekommen');
    }

    const servers = int(body.servers);
    if (!servers || servers > 100) {
      throw new Error('Anzahl Server: 1–100');
    }

    return giveLicense(userId, servers, int(body.days), str(body.note));
  },
  async 'license-extend'(body, client) {
    const result = await extendLicense(str(body.id, 20), {days: int(body.days), servers: int(body.servers), unlimited: body.unlimited === true});
    if (!result) {
      throw new Error('diese Lizenz gibt es nicht');
    }

    if (result.dropped.length > 0) {
      await checkAllGuilds(client);
    }

    return result;
  },
  async 'license-revoke'(body, client) {
    const revoked = await revokeLicenses({licenseId: str(body.id, 20)});
    if (revoked.length === 0) {
      throw new Error('diese Lizenz gibt es nicht');
    }

    await checkAllGuilds(client);
    return revoked;
  },
  async 'key-create'(body) {
    const servers = int(body.servers);
    if (!servers || servers > 100) {
      throw new Error('Anzahl Server: 1–100');
    }

    const count = Math.min(int(body.count) ?? 1, 25);
    const created = [];
    for (let i = 0; i < count; i++) {
      // eslint-disable-next-line no-await-in-loop
      created.push(await createKey(servers, int(body.days), str(body.note)));
    }

    return created;
  },
  async 'key-delete'(body) {
    if (!await deleteKey(str(body.key, 40))) {
      throw new Error('diesen Schlüssel gibt es nicht (mehr)');
    }

    return true;
  },
  async 'blacklist-user-add'(body) {
    const userId = snowflake(body.userId);
    if (isOwner(userId)) {
      throw new Error('den Bot-Besitzer kann man nicht sperren');
    }

    if (!await addToBlacklist(userId, str(body.reason))) {
      throw new Error('ist schon gesperrt');
    }

    return true;
  },
  async 'blacklist-user-remove'(body) {
    if (!await removeFromBlacklist(snowflake(body.userId))) {
      throw new Error('war nicht gesperrt');
    }

    return true;
  },
  async 'blacklist-guild-add'(body, client) {
    const guildId = snowflake(body.guildId);
    const guild = client.guilds.cache.get(guildId);
    if (!await addGuildToBlacklist(guildId, guild?.name ?? 'unbekannter Server', str(body.reason))) {
      throw new Error('ist schon gesperrt');
    }

    if (guild) {
      await leaveIfNotAllowed(guild);
    }

    return true;
  },
  async 'blacklist-guild-remove'(body) {
    if (!await removeGuildFromBlacklist(snowflake(body.guildId))) {
      throw new Error('war nicht gesperrt');
    }

    return true;
  },
  async 'guild-deactivate'(body, client) {
    const guildId = snowflake(body.guildId);
    if (!await deactivateGuild(guildId)) {
      throw new Error('dieser Server war nicht per Lizenz aktiviert');
    }

    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      await leaveIfNotAllowed(guild, true);
    }

    return true;
  },
  async 'guild-leave'(body, client) {
    const guild = client.guilds.cache.get(snowflake(body.guildId));
    if (!guild) {
      throw new Error('auf diesem Server bin ich nicht');
    }

    await leaveGuild(guild, 'im Panel entfernt');
    return true;
  },
  async 'spotify-disconnect'() {
    await disconnectSpotify();
    return true;
  },
};

export const startPanel = (client: Client): void => {
  const port = Number(process.env.PANEL_PORT ?? process.env.SERVER_PORT ?? '0');
  if (!port || process.env.PANEL_DISABLED === 'true') {
    console.log('Panel: kein PANEL_PORT/SERVER_PORT, Panel aus.');
    return;
  }

  loadSessions();
  const allowHttp = process.env.PANEL_ALLOW_HTTP === 'true';

  const sessionOf = (request: http.IncomingMessage): [string, Session] | undefined => {
    const sid = parseCookies(request.headers.cookie)[COOKIE];
    const session = sid ? sessions.get(hash(sid)) : undefined;
    if (!session || session.expiresAt < Date.now() || !isOwner(session.userId)) {
      return undefined;
    }

    return [hash(sid), session];
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      // Nur über HTTPS (Nginx Proxy Manager), nicht direkt über den offenen Port.
      if (!allowHttp && request.headers['x-forwarded-proto'] !== 'https') {
        send(response, 403, 'Bitte über https aufrufen.', 'text/plain; charset=utf-8');
        return;
      }

      const url = new URL(request.url ?? '/', panelUrl());
      const current = sessionOf(request);

      if (request.method === 'GET' && url.pathname === '/login') {
        const token = url.searchParams.get('token') ?? '';
        const entry = loginTokens.get(hash(token));
        loginTokens.delete(hash(token));
        if (!entry || entry.expiresAt < Date.now() || !isOwner(entry.userId)) {
          send(response, 401, PANEL_HTML.replace('__STATE__', 'expired'));
          return;
        }

        const sid = crypto.randomBytes(32).toString('base64url');
        sessions.set(hash(sid), {userId: entry.userId, expiresAt: Date.now() + SESSION_MS});
        saveSessions();
        redirect(response, '/', {'Set-Cookie': `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`});
        return;
      }

      if (request.method === 'GET' && url.pathname === '/') {
        send(response, 200, PANEL_HTML.replace('__STATE__', current ? 'app' : 'login'));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/favicon.ico') {
        send(response, 204, '', 'image/x-icon');
        return;
      }

      if (!current) {
        if (url.pathname.startsWith('/api/')) {
          json(response, 401, {error: 'nicht angemeldet'});
        } else {
          redirect(response, '/');
        }

        return;
      }

      const [sessionKey, session] = current;

      if (request.method === 'GET' && url.pathname === '/spotify/connect') {
        if (!process.env.SPOTIFY_CLIENT_ID?.trim() || !process.env.SPOTIFY_CLIENT_SECRET?.trim()) {
          send(response, 500, 'Spotify-Zugangsdaten fehlen.', 'text/plain; charset=utf-8');
          return;
        }

        session.spotifyState = crypto.randomBytes(16).toString('hex');
        saveSessions();
        redirect(response, spotifyAuthUrl(spotifyRedirectUri(), session.spotifyState));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/spotify/callback') {
        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        const expected = session.spotifyState;
        session.spotifyState = undefined;
        saveSessions();
        if (!code || !state || state !== expected) {
          redirect(response, `/#spotify:${encodeURIComponent(url.searchParams.get('error') ?? 'abgebrochen')}`);
          return;
        }

        try {
          const name = await connectSpotify(code, spotifyRedirectUri());
          redirect(response, `/#spotify-ok:${encodeURIComponent(name)}`);
        } catch (error: unknown) {
          redirect(response, `/#spotify:${encodeURIComponent((error as Error).message)}`);
        }

        return;
      }

      if (request.method === 'POST' && url.pathname === '/logout') {
        sessions.delete(sessionKey);
        saveSessions();
        redirect(response, '/', {'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`});
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/state') {
        json(response, 200, await buildState(client, session.userId));
        return;
      }

      const action = url.pathname.startsWith('/api/action/') ? url.pathname.slice('/api/action/'.length) : '';
      if (request.method === 'POST' && Object.prototype.hasOwnProperty.call(actions, action)) {
        // Eigener Header: andere Seiten können ihn ohne CORS nicht mitschicken.
        if (request.headers['x-bytemusic'] !== '1') {
          json(response, 403, {error: 'ungültige Anfrage'});
          return;
        }

        try {
          const result = await actions[action](await readBody(request), client);
          console.log(`Panel: ${action} von ${session.userId}`);
          json(response, 200, {ok: true, result});
        } catch (error: unknown) {
          json(response, 400, {error: (error as Error).message ?? 'Fehler'});
        }

        return;
      }

      json(response, 404, {error: 'nicht gefunden'});
    })().catch((error: unknown) => {
      console.error('Panel-Fehler:', error);
      if (!response.headersSent) {
        json(response, 500, {error: 'interner Fehler'});
      }
    });
  });

  server.on('error', error => {
    console.error(`Panel konnte nicht starten: ${error.message}`);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Panel läuft auf Port ${port} (${panelUrl()}).`);
  });

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of loginTokens) {
      if (entry.expiresAt < now) {
        loginTokens.delete(key);
      }
    }

    let changed = false;
    for (const [key, entry] of sessions) {
      if (entry.expiresAt < now) {
        sessions.delete(key);
        changed = true;
      }
    }

    if (changed) {
      saveSessions();
    }
  }, 60 * 60 * 1000).unref();
};
