import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchIntroduction,
  fullSearchUrl,
  parseIntroduction,
  parseSuggestions,
  searchSuggestions,
} from './runescape-wiki';

afterEach(() => vi.unstubAllGlobals());

describe('RuneScape Wiki search', () => {
  it('encodes a full-text search query', () => {
    expect(fullSearchUrl('dragon & bones')).toBe(
      'https://runescape.wiki/w/Special:Search?fulltext=1&search=dragon+%26+bones',
    );
  });

  it('returns ten pages with plain-text excerpts and wiki thumbnails', () => {
    const pages = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      key: `Iron_platelegs_+_${index}`,
      title: `Iron platelegs + ${index}`,
      excerpt:
        'An <span class="searchmatch">iron</span> item&#039;s\nfirst line &amp; more',
      thumbnail: { url: 'https://runescape.wiki/images/iron.png' },
    }));
    const suggestions = parseSuggestions({ pages });

    expect(suggestions).toHaveLength(10);
    expect(suggestions[0]).toEqual({
      pageId: 1,
      title: 'Iron platelegs + 0',
      url: 'https://runescape.wiki/w/Iron_platelegs_%2B_0',
      excerpt: "An iron item's first line & more",
      imageUrl: 'https://runescape.wiki/images/iron.png',
    });
  });

  it('falls back to no thumbnail and rejects incomplete results', () => {
    expect(
      parseSuggestions({
        pages: [
          {
            id: 2866,
            key: 'Dragon',
            title: 'Dragon',
            excerpt: 'A dragon',
            thumbnail: null,
          },
        ],
      }),
    ).toEqual([
      {
        pageId: 2866,
        title: 'Dragon',
        url: 'https://runescape.wiki/w/Dragon',
        excerpt: 'A dragon',
      },
    ]);
    expect(
      parseSuggestions({
        pages: [
          {
            id: 2866,
            key: 'Dragon',
            title: 'Dragon',
            excerpt: 'A dragon',
            thumbnail: { url: 'https://example.com/image.png' },
          },
        ],
      }),
    ).toEqual([
      {
        pageId: 2866,
        title: 'Dragon',
        url: 'https://runescape.wiki/w/Dragon',
        excerpt: 'A dragon',
      },
    ]);
    expect(() => parseSuggestions({ pages: [{ title: 'Dragon' }] })).toThrow();
  });

  it('reads a plain-text introduction for the selected page', () => {
    expect(
      parseIntroduction(
        {
          query: {
            pages: {
              '9611': {
                pageid: 9611,
                extract: 'First paragraph.\nSecond paragraph.',
              },
            },
          },
        },
        9611,
      ),
    ).toBe('First paragraph.\n\nSecond paragraph.');
    expect(() => parseIntroduction({ query: { pages: {} } }, 9611)).toThrow();
  });

  it('requests an introduction for only the selected page', async () => {
    const controller = new AbortController();
    const request = vi.fn(async (url: URL, options: RequestInit) => {
      expect(url.pathname).toBe('/api.php');
      expect(url.searchParams.get('prop')).toBe('extracts');
      expect(url.searchParams.get('pageids')).toBe('9611');
      expect(url.searchParams.get('exintro')).toBe('1');
      expect(url.searchParams.get('explaintext')).toBe('1');
      expect(options.signal).toBe(controller.signal);
      return new Response(
        JSON.stringify({
          query: {
            pages: {
              '9611': { pageid: 9611, extract: 'An iron platebody...' },
            },
          },
        }),
      );
    });
    vi.stubGlobal('fetch', request);

    expect(await fetchIntroduction(9611, controller.signal)).toBe(
      'An iron platebody...',
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it('requests ten page results with an abort signal', async () => {
    const controller = new AbortController();
    const request = vi.fn(async (url: URL, options: RequestInit) => {
      expect(url.pathname).toBe('/rest.php/v1/search/page');
      expect(url.searchParams.get('q')).toBe('iron plate');
      expect(url.searchParams.get('limit')).toBe('10');
      expect(options.signal).toBe(controller.signal);
      return new Response(JSON.stringify({ pages: [] }));
    });
    vi.stubGlobal('fetch', request);

    expect(await searchSuggestions('iron plate', controller.signal)).toEqual(
      [],
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
