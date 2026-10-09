import { load } from 'cheerio';
import * as z from 'zod/mini';

const WIKI_ORIGIN = 'https://runescape.wiki';
const SET_TEMPLATE = 'Template:Infobox Set';

type Field = { key: string; label: string; unit?: string };
type InfoboxType = {
  template: string;
  bucket: string;
  label: string;
  fields: readonly Field[];
};

const types: readonly InfoboxType[] = [
  {
    template: 'Template:Infobox Item',
    bucket: 'infobox_item',
    label: 'Item',
    fields: [
      { key: 'examine', label: 'Examine' },
      { key: 'item_id', label: 'Item ID' },
      { key: 'value', label: 'Value', unit: 'coins' },
      { key: 'weight', label: 'Weight', unit: 'kg' },
      { key: 'buy_limit', label: 'Buy limit' },
    ],
  },
  {
    template: 'Template:Infobox Monster',
    bucket: 'infobox_monster',
    label: 'Monster',
    fields: [
      { key: 'combat_level', label: 'Combat level' },
      { key: 'life_points', label: 'Life points' },
      { key: 'slayer_level', label: 'Slayer level' },
      { key: 'examine', label: 'Examine' },
      { key: 'id', label: 'NPC ID' },
    ],
  },
  {
    template: 'Template:Infobox NPC',
    bucket: 'infobox_npc',
    label: 'NPC',
    fields: [
      { key: 'examine', label: 'Examine' },
      { key: 'npc_id', label: 'NPC ID' },
      { key: 'location', label: 'Location' },
      { key: 'options', label: 'Options' },
    ],
  },
  {
    template: 'Template:Infobox Scenery',
    bucket: 'infobox_scenery',
    label: 'Scenery',
    fields: [
      { key: 'examine', label: 'Examine' },
      { key: 'object_id', label: 'Object ID' },
      { key: 'scenery_location', label: 'Location' },
      { key: 'options', label: 'Options' },
    ],
  },
  {
    template: 'Template:Infobox Quest',
    bucket: 'infobox_quest',
    label: 'Quest',
    fields: [
      { key: 'official_difficulty', label: 'Difficulty' },
      { key: 'official_series', label: 'Series' },
      { key: 'release_date', label: 'Release' },
      { key: 'start_area', label: 'Start area' },
    ],
  },
  {
    template: 'Template:Infobox Ability',
    bucket: 'infobox_ability',
    label: 'Ability',
    fields: [
      { key: 'skill', label: 'Skill' },
      { key: 'type', label: 'Type' },
      { key: 'level', label: 'Level' },
      { key: 'target', label: 'Target' },
    ],
  },
  {
    template: 'Template:Infobox Location',
    bucket: 'infobox_location',
    label: 'Location',
    fields: [
      { key: 'location', label: 'Region' },
      { key: 'music', label: 'Music' },
    ],
  },
];

const templatesResponseSchema = z.object({
  query: z.object({
    pages: z.record(
      z.string(),
      z.object({
        pageid: z.int(),
        templates: z.optional(z.array(z.object({ title: z.string() }))),
      }),
    ),
  }),
});

const bucketResponseSchema = z.object({
  bucket: z.array(z.record(z.string(), z.unknown())),
});
const valueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);

export type Infobox = {
  label: string;
  variants: {
    key: string;
    name?: string;
    fields: { label: string; value: string }[];
  }[];
  hasMore: boolean;
  defaultVariantIndex?: number;
};

function templateNames(value: unknown, pageId: number): Set<string> {
  const page = z.parse(templatesResponseSchema, value).query.pages[
    String(pageId)
  ];
  if (!page || page.pageid !== pageId) {
    throw new Error(
      `The RuneScape Wiki did not return templates for page ${pageId}.`,
    );
  }
  return new Set(page.templates?.map((template) => template.title) ?? []);
}

export function infoboxType(
  value: unknown,
  pageId: number,
): InfoboxType | undefined {
  const names = templateNames(value, pageId);
  return types.find((type) => names.has(type.template));
}

function displayValue(value: unknown, field: Field): string | undefined {
  const parsed = z.safeParse(valueSchema, value);
  if (!parsed.success) return undefined;
  const item = parsed.data;
  const text = Array.isArray(item)
    ? item.map(String).join(', ')
    : typeof item === 'number'
      ? item.toLocaleString('en-GB')
      : String(item);
  const plain = text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain || /\[\[|\{\{|<[^>]*>/.test(plain)) return undefined;
  return field.unit ? `${plain} ${field.unit}` : plain;
}

export function parseInfobox(
  value: unknown,
  type: InfoboxType,
): Infobox | undefined {
  const { bucket } = z.parse(bucketResponseSchema, value);
  if (bucket.length === 0) return undefined;

  const variants = bucket
    .slice(0, 20)
    .map((record) => {
      const fields = type.fields.flatMap((field) => {
        const value = displayValue(record[field.key], field);
        return value ? [{ label: field.label, value }] : [];
      });
      return {
        key: JSON.stringify(fields),
        fields,
        isDefault: Object.hasOwn(record, 'default_version'),
      };
    })
    .filter((variant) => variant.fields.length > 0);
  if (variants.length === 0) return undefined;

  const byKey = new Map<string, (typeof variants)[number]>();
  for (const variant of variants) {
    byKey.set(variant.key, {
      ...variant,
      isDefault:
        variant.isDefault || (byKey.get(variant.key)?.isDefault ?? false),
    });
  }
  const unique = [...byKey.values()];
  const defaults = unique.flatMap((variant, index) =>
    variant.isDefault ? [index] : [],
  );
  const defaultVariantIndex =
    bucket.length > 20
      ? undefined
      : unique.length === 1
        ? 0
        : defaults.length === 1
          ? defaults[0]
          : undefined;

  return {
    label: type.label,
    variants: unique.map(({ key, fields }) => ({ key, fields })),
    hasMore: bucket.length > 20,
    ...(defaultVariantIndex === undefined ? {} : { defaultVariantIndex }),
  };
}

export function parseSetInfobox(html: string): Infobox | undefined {
  const $ = load(html);
  const tables = $('table.rsw-infobox.infobox-set');
  const variants = tables
    .slice(0, 20)
    .toArray()
    .map((table) => {
      const box = $(table);
      const name = box
        .find('th.infobox-header')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      const fields = box
        .children('tbody')
        .children('tr')
        .toArray()
        .flatMap((row) => {
          const heading = $(row).children('th').first();
          const cell = $(row).children('td').first();
          const label = heading.text().replace(/\s+/g, ' ').trim();
          const text = cell.text().replace(/\s+/g, ' ').trim();
          if (
            !label ||
            !text ||
            heading.hasClass('infobox-header') ||
            heading.hasClass('infobox-subheader')
          )
            return [];
          const item = heading.find('a[title]').first().attr('title');
          const price =
            cell.attr('data-attr-param')?.endsWith('price') ||
            cell.attr('data-attr-param') === 'total';
          const value = price
            ? `${item ? `${item} · ` : ''}${text} coins`
            : text;
          return [{ label, value }];
        });
      return {
        key: JSON.stringify([name, fields]),
        name,
        fields,
        isDefault: box.closest('.item.showing').length > 0,
      };
    })
    .filter((variant) => variant.name && variant.fields.length > 0);
  if (variants.length === 0) return undefined;
  const defaults = variants.flatMap((variant, index) =>
    variant.isDefault ? [index] : [],
  );
  const defaultVariantIndex =
    tables.length > 20
      ? undefined
      : variants.length === 1
        ? 0
        : defaults.length === 1
          ? defaults[0]
          : undefined;
  return {
    label: 'Equipment set',
    variants: variants.map(({ key, name, fields }) => ({ key, name, fields })),
    hasMore: tables.length > 20,
    ...(defaultVariantIndex === undefined ? {} : { defaultVariantIndex }),
  };
}

export async function fetchInfobox(
  pageId: number,
  title: string,
  signal: AbortSignal,
): Promise<Infobox | undefined> {
  const templatesUrl = new URL('/api.php', WIKI_ORIGIN);
  templatesUrl.searchParams.set('action', 'query');
  templatesUrl.searchParams.set('prop', 'templates');
  templatesUrl.searchParams.set('pageids', String(pageId));
  templatesUrl.searchParams.set(
    'tltemplates',
    [...types.map((type) => type.template), SET_TEMPLATE].join('|'),
  );
  templatesUrl.searchParams.set('format', 'json');

  const templatesResponse = await fetch(templatesUrl, { signal });
  if (!templatesResponse.ok) {
    throw new Error(
      `RuneScape Wiki templates request for page ${pageId} failed (HTTP ${templatesResponse.status}).`,
    );
  }
  const templates: unknown = await templatesResponse.json();
  const names = templateNames(templates, pageId);
  const type = types.find((candidate) => names.has(candidate.template));
  if (!type && names.has(SET_TEMPLATE)) {
    const htmlUrl = new URL(
      `/rest.php/v1/page/${encodeURIComponent(title.replaceAll(' ', '_'))}/html`,
      WIKI_ORIGIN,
    );
    const htmlResponse = await fetch(htmlUrl, { signal });
    if (!htmlResponse.ok) {
      throw new Error(
        `RuneScape Wiki equipment set request for page ${pageId} failed (HTTP ${htmlResponse.status}).`,
      );
    }
    return parseSetInfobox(await htmlResponse.text());
  }
  if (!type) return undefined;

  const bucketUrl = new URL('/api.php', WIKI_ORIGIN);
  bucketUrl.searchParams.set('action', 'bucket');
  const fields = type.fields.map((field) => field.key);
  if (type.bucket === 'infobox_npc') fields.push('default_version');
  bucketUrl.searchParams.set(
    'query',
    `bucket('${type.bucket}').select(${fields.map((field) => `'${field}'`).join(',')}).where('page_name',${JSON.stringify(title)}).limit(21).run()`,
  );
  bucketUrl.searchParams.set('format', 'json');

  const bucketResponse = await fetch(bucketUrl, { signal });
  if (!bucketResponse.ok) {
    throw new Error(
      `RuneScape Wiki ${type.bucket} request for page ${pageId} failed (HTTP ${bucketResponse.status}).`,
    );
  }
  const bucket: unknown = await bucketResponse.json();
  return parseInfobox(bucket, type);
}
