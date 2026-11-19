import {MediaSource, type QueuedPlaylist, type SongMetadata} from '../services/player-types.js';

/*
 * Jellyfin-Links (z. B. .../Items/<id>/Download?ApiKey=…) erkennen und die
 * Metadaten (Titel, Interpret, Dauer, Cover) über die Jellyfin-API holen.
 * Alben und Playlists werden zu einzelnen Titeln aufgelöst.
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

  url.searchParams.set('api_key', link.apiKey);
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

export const getJellyfinSongs = async (raw: string, playlistLimit: number): Promise<SongMetadata[]> => {
  const link = parseJellyfinUrl(raw);
  if (!link) {
    return [];
  }

  // /Items?ids= funktioniert mit API-Keys auch ohne Nutzer-ID.
  const {Items: items} = await api<{Items: JellyfinItem[]}>(link, '/Items', {ids: link.itemId, Fields: FIELDS});
  const item = items?.[0];
  if (!item) {
    throw new Error('diesen Eintrag gibt es auf dem Jellyfin-Server nicht');
  }

  if (!COLLECTION_TYPES.has(item.Type ?? '')) {
    return [toSong(link, item, raw, null)];
  }

  const playlist = {title: item.Name ?? 'Jellyfin', source: jellyfinDisplayUrl(raw) ?? link.base};
  const {Items: children} = item.Type === 'Playlist'
    ? await api<{Items: JellyfinItem[]}>(link, `/Playlists/${item.Id}/Items`, {Fields: FIELDS, Limit: String(playlistLimit)})
    : await api<{Items: JellyfinItem[]}>(link, '/Items', {
      ParentId: item.Id, Recursive: 'true', Fields: FIELDS, Limit: String(playlistLimit),
      IncludeItemTypes: 'Audio,Episode,Movie,MusicVideo,Video',
      SortBy: 'ParentIndexNumber,IndexNumber,SortName',
    });

  return (children ?? [])
    .filter(child => child.MediaType === 'Audio' || child.MediaType === 'Video')
    .slice(0, playlistLimit)
    .map(child => toSong(link, child, `${link.base}/Items/${child.Id}/Download?${link.keyParam}=${encodeURIComponent(link.apiKey)}`, playlist));
};
