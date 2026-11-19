import fs from 'node:fs/promises';
import path from 'node:path';
import {MediaSource, type QueuedPlaylist, type SongMetadata} from '../services/player-types.js';
import {DATA_DIR} from '../services/config.js';
import pLimit from 'p-limit';

/*
 * Jellyfin-Links (z. B. .../Items/<id>/Download?ApiKey=…) erkennen und die
 * Metadaten (Titel, Interpret, Dauer, Cover) über die Jellyfin-API holen.
 * Alben und Playlists werden zu einzelnen Titeln aufgelöst.
 * Für Server mit hinterlegtem API-Key (/jellyfin add) gehen auch Links ohne
 * Key, z. B. aus der Weboberfläche (…/web/#/details?id=…).
 */

type JellyfinLink = {base: string; itemId: string; apiKey: string; keyParam: string};

type JellyfinItem = {
  Id: string;
  Name?: string;
  Type?: string;
  MediaType?: string;
  RunTimeTicks?: number;
  Artists?: string[];
  AlbumArtist?: string;
  Album?: string;
  AlbumId?: string;
  AlbumPrimaryImageTag?: string;
  SeriesName?: string;
  ProductionYear?: number;
  ImageTags?: Record<string, string>;
};

const ITEM_PATH = /^(.*?)\/(?:Items|Audio|Videos)\/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
const KEY_PARAMS = ['api_key', 'ApiKey', 'apiKey', 'apikey', 'X-Emby-Token'];
const COLLECTION_TYPES = new Set(['MusicAlbum', 'Playlist', 'Folder', 'CollectionFolder', 'BoxSet', 'Season']);
const FIELDS = 'Artists,AlbumArtist,Album,AlbumId,AlbumPrimaryImageTag,RunTimeTicks,MediaType,SeriesName,ProductionYear,ImageTags';
const TIMEOUT_MS = 10_000;

export const parseJellyfinUrl = (raw: string): JellyfinLink | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return null;
  }

  const keyParam = KEY_PARAMS.find(name => url.searchParams.get(name));
  const match = ITEM_PATH.exec(url.pathname);
  if (!keyParam || !match) {
    return null;
  }

  return {base: `${url.origin}${match[1]}`, itemId: match[2].replace(/-/g, '').toLowerCase(), apiKey: url.searchParams.get(keyParam)!, keyParam};
};

export type JellyfinServer = {base: string; apiKey: string; name: string; addedAt: string};

const SERVERS_FILE = path.join(DATA_DIR, 'jellyfin-servers.json');
let servers: Map<string, JellyfinServer> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

const normalizeBase = (base: string) => base.replace(/\/+$/, '').toLowerCase();

const loadServers = async (): Promise<Map<string, JellyfinServer>> => {
  if (servers) {
    return servers;
  }

  try {
    const entries = JSON.parse(await fs.readFile(SERVERS_FILE, 'utf8')) as JellyfinServer[];
    servers = new Map(entries.map(entry => [normalizeBase(entry.base), entry]));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    servers = new Map();
  }

  return servers;
};

const saveServers = async (): Promise<void> => {
  const data = JSON.stringify([...(await loadServers()).values()], null, 2);
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const temporary = `${SERVERS_FILE}.tmp`;
    await fs.writeFile(temporary, data, {mode: 0o600});
    await fs.rename(temporary, SERVERS_FILE);
  });
  await writeQueue;
};

export const listJellyfinServers = async (): Promise<JellyfinServer[]> => [...(await loadServers()).values()];

/** Basis-URL eines Jellyfin-Servers aus einem beliebigen Link (Weboberfläche oder API). */
export const jellyfinBaseOf = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    const prefix = /^(.*?)\/(?:web|Items|Audio|Videos|Playlists)(?:\/|$)/i.exec(url.pathname)?.[1] ?? url.pathname.replace(/\/+$/, '');
    return `${url.origin}${prefix}`;
  } catch {
    return null;
  }
};

/** Prüft den Key und speichert den Server. Gibt den Servernamen zurück. */
export const addJellyfinServer = async (rawUrl: string, apiKey: string): Promise<JellyfinServer> => {
  const base = jellyfinBaseOf(rawUrl);
  if (!base) {
    throw new Error('ungültige Server-Adresse');
  }

  const link: JellyfinLink = {base, itemId: '', apiKey, keyParam: 'ApiKey'};
  const info = await api<{ServerName?: string; ProductName?: string}>(link, '/System/Info', {});
  const entry: JellyfinServer = {base, apiKey, name: info.ServerName ?? new URL(base).host, addedAt: new Date().toISOString()};
  (await loadServers()).set(normalizeBase(base), entry);
  await saveServers();
  return entry;
};

export const removeJellyfinServer = async (rawUrl: string): Promise<boolean> => {
  const base = jellyfinBaseOf(rawUrl);
  if (!base || !(await loadServers()).delete(normalizeBase(base))) {
    return false;
  }

  await saveServers();
  return true;
};

const ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Item-ID aus einem Weboberflächen-Link (#/details?id=…, #!/details?id=…, #/list?parentId=…). */
const webItemId = (url: URL): string | null => {
  const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(hashQuery);
  for (const name of ['id', 'parentId', 'topParentId']) {
    const value = params.get(name) ?? url.searchParams.get(name);
    if (value && ID.test(value)) {
      return value.replace(/-/g, '').toLowerCase();
    }
  }

  return null;
};

/** Sieht der Link nach Jellyfin aus (mit oder ohne Key)? */
export const looksLikeJellyfin = (raw: string): boolean => {
  if (parseJellyfinUrl(raw)) {
    return true;
  }

  try {
    const url = new URL(raw);
    return /\/web\//i.test(url.pathname + '/') && webItemId(url) !== null;
  } catch {
    return false;
  }
};

/** Link mit Key aus dem Link selbst oder aus /jellyfin add. */
export const resolveJellyfinLink = async (raw: string): Promise<JellyfinLink | null> => {
  const direct = parseJellyfinUrl(raw);
  if (direct) {
    return direct;
  }

  const base = jellyfinBaseOf(raw);
  if (!base) {
    return null;
  }

  const server = (await loadServers()).get(normalizeBase(base));
  if (!server) {
    return null;
  }

  const url = new URL(raw);
  const itemId = webItemId(url) ?? ITEM_PATH.exec(url.pathname)?.[2]?.replace(/-/g, '').toLowerCase();
  return itemId ? {base: server.base, itemId, apiKey: server.apiKey, keyParam: 'ApiKey'} : null;
};

/** Link ohne API-Key für die Anzeige im Chat (Jellyfin-Detailseite). */
export const jellyfinDisplayUrl = (raw: string): string | null => {
  const link = parseJellyfinUrl(raw);
  return link ? `${link.base}/web/#/details?id=${link.itemId}` : null;
};

/** Ersetzt API-Keys in beliebigen URLs, damit sie nicht im Chat landen. */
export const maskSecrets = (raw: string): string => {
  try {
    const url = new URL(raw);
    let changed = false;
    for (const name of [...url.searchParams.keys()]) {
      if (/^(api_?key|x-emby-token|token|access_token|key|sig|signature)$/i.test(name)) {
        url.searchParams.set(name, '***');
        changed = true;
      }
    }

    return changed ? url.href.replace(/%2A/g, '*') : raw;
  } catch {
    return raw;
  }
};

const api = async <T>(link: JellyfinLink, path: string, query: Record<string, string>): Promise<T> => {
  const url = new URL(`${link.base}${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  url.searchParams.set('ApiKey', link.apiKey);
  const response = await fetch(url, {
    headers: {Accept: 'application/json', Authorization: `MediaBrowser Token="${link.apiKey}"`},
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Jellyfin hat den API-Key abgelehnt');
  }

  if (!response.ok) {
    throw new Error(`Jellyfin antwortet mit HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
};

const toSong = (link: JellyfinLink, item: JellyfinItem, playUrl: string, playlist: QueuedPlaylist | null): SongMetadata => {
  const artist = item.Artists?.length ? item.Artists.join(', ')
    : item.AlbumArtist ?? item.SeriesName ?? (item.ProductionYear ? String(item.ProductionYear) : 'Jellyfin');
  let thumbnailUrl: string | null = null;
  if (item.ImageTags?.Primary) {
    thumbnailUrl = `${link.base}/Items/${item.Id}/Images/Primary?maxHeight=300&tag=${item.ImageTags.Primary}`;
  } else if (item.AlbumId && item.AlbumPrimaryImageTag) {
    thumbnailUrl = `${link.base}/Items/${item.AlbumId}/Images/Primary?maxHeight=300&tag=${item.AlbumPrimaryImageTag}`;
  }

  const length = item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : 0;
  return {
    url: playUrl,
    source: MediaSource.HLS,
    isLive: length === 0,
    title: item.Name ?? 'Jellyfin',
    artist,
    length,
    offset: 0,
    playlist,
    thumbnailUrl,
  };
};

const downloadUrl = (link: JellyfinLink, itemId: string) => `${link.base}/Items/${itemId}/Download?${link.keyParam}=${encodeURIComponent(link.apiKey)}`;

/** Ersatz für eine fehlende Jellyfin-Datei: YouTube-Suche nach Interpret und Titel, aufgelöst erst beim Abspielen. */
export const jellyfinToYouTube = (song: SongMetadata): SongMetadata | null => {
  const title = song.title.replace(/\s+/g, ' ').trim();
  if (title.length < 2) {
    return null;
  }

  const artist = song.artist === 'Jellyfin' || /^\d{4}$/.test(song.artist) ? '' : song.artist;
  return {...song, source: MediaSource.Youtube, isLive: false, url: `ytsearch1:${artist ? `${artist} - ` : ''}${title}`};
};

/** Prüft, ob Jellyfin die Datei noch findet (404, wenn sie verschoben oder gelöscht wurde). */
const isReachable = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, {headers: {Range: 'bytes=0-0'}, signal: AbortSignal.timeout(TIMEOUT_MS)});
    await response.body?.cancel();
    return response.status !== 404 && response.status !== 410;
  } catch {
    return true; // Netzwerkprobleme nicht als „fehlt“ werten, beim Abspielen wird ohnehin übersprungen.
  }
};

/** Titel in Playlist-Reihenfolge; reachable = false, wenn Jellyfin die Datei nicht mehr findet. */
export type JellyfinResult = Array<{song: SongMetadata; reachable: boolean}>;

export const getJellyfinSongs = async (raw: string, playlistLimit: number): Promise<JellyfinResult> => {
  const link = await resolveJellyfinLink(raw);
  if (!link) {
    throw new Error('für diesen Jellyfin-Server ist kein API-Key hinterlegt. Der Bot-Besitzer kann ihn mit `/jellyfin add` hinzufügen, oder du nimmst einen Link mit `ApiKey=`');
  }

  // /Items?ids= funktioniert mit API-Keys auch ohne Nutzer-ID.
  const {Items: items} = await api<{Items: JellyfinItem[]}>(link, '/Items', {ids: link.itemId, Fields: FIELDS});
  const item = items?.[0];
  if (!item) {
    throw new Error('diesen Eintrag gibt es auf dem Jellyfin-Server nicht');
  }

  const displayBase = `${link.base}/web/#/details?id=${item.Id}`;
  if (!COLLECTION_TYPES.has(item.Type ?? '') && item.Type !== 'MusicArtist' && item.Type !== 'Series') {
    // Eigener Link mit Key bleibt erhalten, Weblinks werden zur Download-URL.
    const playUrl = parseJellyfinUrl(raw) ? raw : downloadUrl(link, item.Id);
    const song = toSong(link, item, playUrl, null);
    return [{song, reachable: await isReachable(playUrl)}];
  }

  const playlist = {title: item.Name ?? 'Jellyfin', source: displayBase};
  const byParent = async () => api<{Items: JellyfinItem[]}>(link, '/Items', {
    ParentId: item.Id, Recursive: 'true', Fields: FIELDS, Limit: String(playlistLimit),
    IncludeItemTypes: 'Audio,Episode,Movie,MusicVideo,Video',
    ...(item.Type === 'Playlist' ? {} : {SortBy: 'Album,ParentIndexNumber,IndexNumber,SortName'}),
  });
  let children: JellyfinItem[] | undefined;
  if (item.Type === 'Playlist') {
    // Reihenfolge der Playlist: neuere Versionen wollen dafür eine Nutzer-ID mit Zugriff
    // auf die Playlist, also die Nutzer durchprobieren; sonst über ParentId (alphabetisch).
    const users = await api<Array<{Id: string}>>(link, '/Users', {}).catch(() => [] as Array<{Id: string}>);
    for (const userId of [undefined, ...users.slice(0, 10).map(user => user.Id)]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        ({Items: children} = await api<{Items: JellyfinItem[]}>(link, `/Playlists/${item.Id}/Items`, {
          Fields: FIELDS, Limit: String(playlistLimit), ...(userId ? {userId} : {}),
        }));
        if (children?.length) {
          break;
        }
      } catch {
        children = undefined;
      }
    }
  } else if (item.Type === 'MusicArtist') {
    ({Items: children} = await api<{Items: JellyfinItem[]}>(link, '/Items', {
      ArtistIds: item.Id, Recursive: 'true', IncludeItemTypes: 'Audio', Fields: FIELDS, Limit: String(playlistLimit),
      SortBy: 'Album,ParentIndexNumber,IndexNumber,SortName',
    }));
  }

  if (!children?.length) {
    ({Items: children} = await byParent());
  }

  const songs = (children ?? [])
    .filter(child => child.MediaType === 'Audio' || child.MediaType === 'Video')
    .slice(0, playlistLimit)
    .map(child => toSong(link, child, downloadUrl(link, child.Id), playlist));

  // Titel, deren Datei Jellyfin nicht mehr findet, gar nicht erst einreihen.
  const limit = pLimit(8);
  const reachable = await Promise.all(songs.map(async song => limit(async () => isReachable(song.url))));
  return songs.map((song, index) => ({song, reachable: reachable[index]}));
};
