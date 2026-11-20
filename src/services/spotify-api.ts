import {URL} from 'url';
import {inject, injectable} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import {TYPES} from '../types.js';
import ThirdParty from './third-party.js';
import shuffle from 'array-shuffle';
import {QueuedPlaylist} from './player.js';
import {getPlaylistWithUser} from './spotify-user.js';
import debug from '../utils/debug.js';

export interface SpotifyTrack {
  name: string;
  artist: string;
}

interface EmbedEntity {
  name?: string;
  title?: string;
  trackList?: Array<{title?: string; subtitle?: string; entityType?: string}>;
}

const EMBED_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Share links from the apps look like open.spotify.com/intl-de/playlist/...; spotify-uri can't parse the language part.
export const normalizeSpotifyUrl = (url: string): string => url.replace(/(open\.spotify\.com)\/intl-[a-z]{2}(?:-[a-z]{2})?\//i, '$1/');

@injectable()
export default class {
  private readonly spotify: Spotify;

  constructor(@inject(TYPES.ThirdParty) thirdParty: ThirdParty) {
    this.spotify = thirdParty.spotify;
  }

  async getAlbum(url: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Album;
    let [{body: album}, {body: tracksResponse}] = await Promise.all([this.spotify.getAlbum(uri.id), this.spotify.getAlbumTracks(uri.id, {limit: 50})]);
    const items = [...tracksResponse.items];

    while (tracksResponse.next) {
      // eslint-disable-next-line no-await-in-loop
      ({body: tracksResponse} = await this.spotify.getAlbumTracks(uri.id, {
        limit: parseInt(new URL(tracksResponse.next).searchParams.get('limit') ?? '50', 10),
        offset: parseInt(new URL(tracksResponse.next).searchParams.get('offset') ?? '0', 10),
      }));

      items.push(...tracksResponse.items);
    }

    const tracks = this.limitTracks(items, playlistLimit).map(this.toSpotifyTrack);
    const playlist = {title: album.name, source: album.href};

    return [tracks, playlist];
  }

  // Spotify no longer lets app tokens (client credentials) list playlist tracks:
  // /playlists/{id}/tracks answers 403 and the playlist object has no tracks any more.
  // The public embed page still carries the track list (title + artists, up to 100 tracks).
  async getPlaylist(url: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Playlist;
    // Mit verbundenem Spotify-Konto (Panel) die ganze Playlist laden.
    try {
      const full = await getPlaylistWithUser(uri.id, Math.max(playlistLimit, 1) * 4);
      if (full && full.tracks.length > 0) {
        return [this.limitEmbedTracks(full.tracks, playlistLimit), {title: full.name, source: `https://open.spotify.com/playlist/${uri.id}`}];
      }
    } catch (error: unknown) {
      debug(`Spotify-Playlist über Nutzer-Konto fehlgeschlagen, nehme Embed-Seite: ${String((error as Error).message ?? error)}`);
    }

    const entity = await this.getEmbedEntity('playlist', uri.id);
    const tracks = this.limitEmbedTracks(this.embedTracks(entity), playlistLimit);
    const playlist = {title: entity.name ?? entity.title ?? 'Spotify playlist', source: `https://open.spotify.com/playlist/${uri.id}`};

    return [tracks, playlist];
  }

  async getTrack(url: string): Promise<SpotifyTrack> {
    const uri = spotifyURI.parse(url) as spotifyURI.Track;
    const {body} = await this.spotify.getTrack(uri.id);

    return this.toSpotifyTrack(body);
  }

  // /artists/{id}/top-tracks answers 403 for app tokens as well; the embed page lists the top tracks.
  async getArtist(url: string, playlistLimit: number): Promise<SpotifyTrack[]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Artist;
    const entity = await this.getEmbedEntity('artist', uri.id);

    return this.limitEmbedTracks(this.embedTracks(entity), playlistLimit);
  }

  private async getEmbedEntity(type: 'playlist' | 'artist', id: string): Promise<EmbedEntity> {
    const response = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
      headers: {'User-Agent': EMBED_USER_AGENT},
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Spotify hat mit ${response.status} geantwortet (${type})`);
    }

    const match = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s.exec(await response.text());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const entity: EmbedEntity | undefined = match ? JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity : undefined;

    if (!entity || !Array.isArray(entity.trackList)) {
      throw new Error(`konnte diese Spotify-${type} nicht lesen (privat oder gelöscht?)`);
    }

    return entity;
  }

  private embedTracks(entity: EmbedEntity): SpotifyTrack[] {
    return (entity.trackList ?? [])
      .filter(track => track.title && (track.entityType ?? 'track') === 'track')
      .map(track => ({
        name: track.title!,
        // artists are joined with ", " ("Tyler, The Creator, Kali Uchis") -> first artist, like the API-based lookups
        artist: (track.subtitle ?? '').split(', ')[0].trim(),
      }));
  }

  private limitEmbedTracks(tracks: SpotifyTrack[], limit: number) {
    return tracks.length > limit ? shuffle(tracks).slice(0, limit) : tracks;
  }

  private toSpotifyTrack(track: SpotifyApi.TrackObjectSimplified): SpotifyTrack {
    return {
      name: track.name,
      artist: track.artists[0].name,
    };
  }

  private limitTracks(tracks: SpotifyApi.TrackObjectSimplified[], limit: number) {
    return tracks.length > limit ? shuffle(tracks).slice(0, limit) : tracks;
  }
}
