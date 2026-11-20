import fs from 'node:fs/promises';
import path from 'node:path';
import {DATA_DIR} from './config.js';

/*
 * Spotify mit dem Konto des Bot-Besitzers (OAuth, einmalig im Panel verbinden).
 * Mit einem reinen App-Token liefert Spotify keine Playlist-Inhalte mehr; mit
 * diesem Nutzer-Token lassen sich ganze Playlists laden (nicht nur die ~100
 * Titel der Embed-Seite). Der Refresh-Token liegt in data/spotify-user.json.
 */

const FILE = path.join(DATA_DIR, 'spotify-user.json');
const SCOPES = 'playlist-read-private playlist-read-collaborative';

type Stored = {refreshToken: string; accessToken?: string; expiresAt?: number; displayName?: string; connectedAt: string};

let stored: Stored | null | undefined;

const clientId = () => process.env.SPOTIFY_CLIENT_ID?.trim() ?? '';
const clientSecret = () => process.env.SPOTIFY_CLIENT_SECRET?.trim() ?? '';

const load = async (): Promise<Stored | null> => {
  if (stored !== undefined) {
    return stored;
  }

  try {
    stored = JSON.parse(await fs.readFile(FILE, 'utf8')) as Stored;
  } catch {
    stored = null;
  }

  return stored;
};

const save = async (value: Stored | null) => {
  stored = value;
  if (value) {
    await fs.writeFile(FILE, JSON.stringify(value, null, 2), {mode: 0o600});
  } else {
    await fs.rm(FILE, {force: true});
  }
};

export const spotifyAuthUrl = (redirectUri: string, state: string): string => `https://accounts.spotify.com/authorize?${new URLSearchParams({
  client_id: clientId(),
  response_type: 'code',
  redirect_uri: redirectUri,
  scope: SCOPES,
  state,
}).toString()}`;

const tokenRequest = async (body: Record<string, string>) => {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')}`,
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json() as {access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string};
  if (!response.ok || !data.access_token) {
    throw new Error(`Spotify-Anmeldung fehlgeschlagen: ${data.error_description ?? data.error ?? response.status}`);
  }

  return data;
};

export const connectSpotify = async (code: string, redirectUri: string): Promise<string> => {
  const data = await tokenRequest({grant_type: 'authorization_code', code, redirect_uri: redirectUri});
  const value: Stored = {
    refreshToken: data.refresh_token!,
    accessToken: data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 3600) * 1000),
    connectedAt: new Date().toISOString(),
  };
  stored = value;
  try {
    const me = await spotifyGet<{display_name?: string; id: string}>('/me');
    value.displayName = me.display_name ?? me.id;
  } catch {}

  await save(value);
  return value.displayName ?? 'Spotify';
};

export const disconnectSpotify = async () => save(null);

export const spotifyStatus = async (): Promise<{connected: boolean; displayName?: string; connectedAt?: string}> => {
  const value = await load();
  return value ? {connected: true, displayName: value.displayName, connectedAt: value.connectedAt} : {connected: false};
};

const accessToken = async (): Promise<string | null> => {
  const value = await load();
  if (!value) {
    return null;
  }

  if (value.accessToken && value.expiresAt && value.expiresAt - 60_000 > Date.now()) {
    return value.accessToken;
  }

  const data = await tokenRequest({grant_type: 'refresh_token', refresh_token: value.refreshToken});
  value.accessToken = data.access_token;
  value.expiresAt = Date.now() + ((data.expires_in ?? 3600) * 1000);
  if (data.refresh_token) {
    value.refreshToken = data.refresh_token;
  }

  await save(value);
  return value.accessToken!;
};

export class SpotifyUserError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export const spotifyGet = async <T>(pathOrUrl: string): Promise<T> => {
  const token = await accessToken();
  if (!token) {
    throw new SpotifyUserError('Spotify ist nicht verbunden', 0);
  }

  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `https://api.spotify.com/v1${pathOrUrl}`;
  const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15_000)});
  if (!response.ok) {
    throw new SpotifyUserError(`Spotify antwortet mit ${response.status}`, response.status);
  }

  return await response.json() as T;
};

type PlaylistTrackItem = {
  item?: {type?: string; name?: string; artists?: Array<{name: string}>} | null;
  track?: {type?: string; name?: string; artists?: Array<{name: string}>} | null;
};

/** Alle Titel einer Playlist über das Nutzer-Konto, oder null wenn nicht verbunden. */
export const getPlaylistWithUser = async (id: string, max = 2000): Promise<{name: string; tracks: Array<{name: string; artist: string}>} | null> => {
  if (!await load()) {
    return null;
  }

  const meta = await spotifyGet<{name?: string}>(`/playlists/${id}?fields=name`);
  const tracks: Array<{name: string; artist: string}> = [];
  let next: string | null = `/playlists/${id}/items?limit=50&offset=0`;
  while (next && tracks.length < max) {
    // eslint-disable-next-line no-await-in-loop
    const page: {items: PlaylistTrackItem[]; next: string | null} = await spotifyGet(next);
    for (const entry of page.items) {
      const track = entry.item ?? entry.track;
      if (track?.name && (track.type ?? 'track') === 'track' && track.artists?.length) {
        tracks.push({name: track.name, artist: track.artists[0].name});
      }
    }

    next = page.next;
  }

  return {name: meta.name ?? 'Spotify-Playlist', tracks};
};
