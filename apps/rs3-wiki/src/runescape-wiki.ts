import { decode } from 'html-entities';
import * as z from 'zod/mini';

const WIKI_ORIGIN = 'https://runescape.wiki';

const searchResponseSchema = z.object({
  pages: z.array(
    z.object({
      id: z.int().check(z.positive()),
      key: z.string().check(z.minLength(1)),
      title: z.string(),
      excerpt: z.string(),
      thumbnail: z.optional(z.nullable(z.object({ url: z.string() }))),
    }),
  ),
});

const introductionResponseSchema = z.object({
  query: z.object({
    pages: z.record(
      z.string(),
      z.object({ pageid: z.int(), extract: z.string() }),
    ),
  }),
});

export type Suggestion = {
  pageId: number;
  title: string;
  url: string;
  excerpt: string;
  imageUrl?: string;
};

export function fullSearchUrl(query: string): string {
  const url = new URL('/w/Special:Search', WIKI_ORIGIN);
  url.searchParams.set('fulltext', '1');
  url.searchParams.set('search', query);
  return url.toString();
}

export function parseSuggestions(value: unknown): Suggestion[] {
  const { pages } = z.parse(searchResponseSchema, value);

  return pages.slice(0, 10).map((page) => {
    const image =
      page.thumbnail?.url && URL.canParse(page.thumbnail.url)
        ? new URL(page.thumbnail.url)
        : undefined;
    const imageUrl =
      image?.origin === WIKI_ORIGIN && image.pathname.startsWith('/images/')
        ? image.toString()
        : undefined;

    return {
      pageId: page.id,
      title: page.title,
      url: new URL(
        `/w/${encodeURIComponent(page.key)}`,
        WIKI_ORIGIN,
      ).toString(),
      excerpt: decode(page.excerpt.replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim(),
      ...(imageUrl ? { imageUrl } : {}),
    };
  });
}

export async function searchSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<Suggestion[]> {
  const url = new URL('/rest.php/v1/search/page', WIKI_ORIGIN);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '10');

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `RuneScape Wiki suggestions request failed with HTTP ${response.status}.`,
    );
  }

  const body: unknown = await response.json();
  return parseSuggestions(body);
}

export function parseIntroduction(value: unknown, pageId: number): string {
  const { pages } = z.parse(introductionResponseSchema, value).query;
  const page = pages[String(pageId)];
  if (!page || page.pageid !== pageId) {
    throw new Error(
      `The RuneScape Wiki did not return an introduction for page ${pageId}.`,
    );
  }

  return page.extract.trim().replace(/\n+/g, '\n\n');
}

export async function fetchIntroduction(
  pageId: number,
  signal: AbortSignal,
): Promise<string> {
  const url = new URL('/api.php', WIKI_ORIGIN);
  url.searchParams.set('action', 'query');
  url.searchParams.set('prop', 'extracts');
  url.searchParams.set('exintro', '1');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('pageids', String(pageId));
  url.searchParams.set('format', 'json');

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `RuneScape Wiki article request failed with HTTP ${response.status}.`,
    );
  }

  const body: unknown = await response.json();
  return parseIntroduction(body, pageId);
}
