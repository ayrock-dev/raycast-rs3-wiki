import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchInfobox,
  infoboxType,
  parseInfobox,
  parseSetInfobox,
} from './infobox';

afterEach(() => vi.unstubAllGlobals());

function templates(pageId: number, ...names: string[]) {
  return {
    query: {
      pages: {
        [pageId]: {
          pageid: pageId,
          templates: names.map((title) => ({ title })),
        },
      },
    },
  };
}

describe('RuneScape Wiki infoboxes', () => {
  it.each([
    ['Template:Infobox Item', 'infobox_item'],
    ['Template:Infobox Monster', 'infobox_monster'],
    ['Template:Infobox NPC', 'infobox_npc'],
    ['Template:Infobox Scenery', 'infobox_scenery'],
    ['Template:Infobox Quest', 'infobox_quest'],
    ['Template:Infobox Ability', 'infobox_ability'],
    ['Template:Infobox Location', 'infobox_location'],
  ])('maps %s to %s', (template, bucket) => {
    expect(infoboxType(templates(9611, template), 9611)?.bucket).toBe(bucket);
  });

  it('prefers a primary item infobox over bonuses and skips pages without a match', () => {
    expect(
      infoboxType(
        templates(9611, 'Template:Infobox Bonuses', 'Template:Infobox Item'),
        9611,
      )?.bucket,
    ).toBe('infobox_item');
    expect(
      infoboxType(templates(9611, 'Template:Other'), 9611),
    ).toBeUndefined();
    expect(() => infoboxType({ query: { pages: {} } }, 9611)).toThrow();
  });

  it('formats simple item fields and ignores empty or unsupported values', () => {
    const type = infoboxType(templates(9611, 'Template:Infobox Item'), 9611);
    if (!type) throw new Error('Item infobox template not configured');
    const result = parseInfobox(
      {
        bucket: [
          {
            item_id: [1115],
            examine: 'Provides excellent protection.',
            value: 626,
            weight: 0.025,
            buy_limit: 100,
          },
          {
            item_id: [1115],
            examine: 'Provides excellent protection.',
            value: 626,
            weight: 0.025,
            buy_limit: 100,
          },
          { item_id: [1234], examine: '', value: { invalid: true }, weight: 1 },
        ],
      },
      type,
    );

    expect(result?.label).toBe('Item');
    expect(result?.variants).toHaveLength(2);
    expect(result?.variants[0]?.fields).toEqual([
      { label: 'Examine', value: 'Provides excellent protection.' },
      { label: 'Item ID', value: '1115' },
      { label: 'Value', value: '626 coins' },
      { label: 'Weight', value: '0.025 kg' },
      { label: 'Buy limit', value: '100' },
    ]);
    expect(parseInfobox({ bucket: [] }, type)).toBeUndefined();
    expect(() => parseInfobox({ error: 'No bucket' }, type)).toThrow();
  });

  it('uses the NPC default marker instead of Bucket record order', () => {
    const type = infoboxType(templates(9785, 'Template:Infobox NPC'), 9785);
    if (!type) throw new Error('NPC infobox template not configured');
    const info = parseInfobox(
      {
        bucket: [
          { npc_id: ['7935'] },
          {
            default_version: '',
            npc_id: ['0'],
            examine: 'Servant of the Duke of Lumbridge.',
          },
        ],
      },
      type,
    );
    expect(info?.defaultVariantIndex).toBe(1);
    expect(info?.variants[1]?.fields).toContainEqual({
      label: 'NPC ID',
      value: '0',
    });
    expect(
      parseInfobox({ bucket: [{ npc_id: ['7935'] }, { npc_id: ['0'] }] }, type)
        ?.defaultVariantIndex,
    ).toBeUndefined();
    expect(
      parseInfobox(
        {
          bucket: [
            { default_version: '', npc_id: ['1'] },
            { default_version: '', npc_id: ['2'] },
          ],
        },
        type,
      )?.defaultVariantIndex,
    ).toBeUndefined();
    expect(
      parseInfobox(
        {
          bucket: [
            { default_version: '', npc_id: ['0'] },
            { npc_id: ['0'] },
            { npc_id: ['1'] },
          ],
        },
        type,
      )?.defaultVariantIndex,
    ).toBe(0);
    const truncated = parseInfobox(
      {
        bucket: Array.from({ length: 21 }, (_, index) => ({
          npc_id: [String(index)],
          ...(index === 0 ? { default_version: '' } : {}),
        })),
      },
      type,
    );
    expect(truncated?.hasMore).toBe(true);
    expect(truncated?.defaultVariantIndex).toBeUndefined();
  });

  it('converts wiki links to plain text for location fields', () => {
    const type = infoboxType(templates(515, 'Template:Infobox Location'), 515);
    if (!type) throw new Error('Location infobox template not configured');
    expect(
      parseInfobox(
        {
          bucket: [
            {
              location: '[[Misthalin]]',
              music: '[[Garden (music track)|Garden]]',
            },
          ],
        },
        type,
      )?.variants[0]?.fields,
    ).toEqual([
      { label: 'Region', value: 'Misthalin' },
      { label: 'Music', value: 'Garden' },
    ]);
  });

  it('reads both versions of an equipment set from the rendered infobox', () => {
    const html = `<table class="rsw-infobox infobox-set"><tbody>
      <tr><th class="infobox-header">Iron equipment</th></tr>
      <tr><th>Release</th><td data-attr-param="release">4 January 2001</td></tr>
      <tr><th data-attr-param="body"><a title="Iron platebody">Torso</a></th><td data-attr-param="bodyprice">5,223</td></tr>
      <tr><td data-attr-param="graph">Interactive chart</td></tr>
    </tbody></table>
    <div class="item showing"><table class="rsw-infobox infobox-set"><tbody>
      <tr><th class="infobox-header">Iron equipment + 1</th></tr>
      <tr><th data-attr-param="body"><a title="Iron platebody + 1">Torso</a></th><td data-attr-param="bodyprice">4,652</td></tr>
    </tbody></table></div>`;
    const info = parseSetInfobox(html);
    expect(info?.label).toBe('Equipment set');
    expect(info?.variants.map((variant) => variant.name)).toEqual([
      'Iron equipment',
      'Iron equipment + 1',
    ]);
    expect(info?.variants[0]?.fields).toEqual([
      { label: 'Release', value: '4 January 2001' },
      { label: 'Torso', value: 'Iron platebody · 5,223 coins' },
    ]);
    expect(info?.defaultVariantIndex).toBe(1);
    expect(info?.variants[1]?.fields).toEqual([
      { label: 'Torso', value: 'Iron platebody + 1 · 4,652 coins' },
    ]);
    expect(
      parseSetInfobox('<table class="rsw-infobox infobox-item"></table>'),
    ).toBeUndefined();
  });

  it('fetches the rendered infobox only for a selected equipment set', async () => {
    const controller = new AbortController();
    const request = vi.fn(async (url: URL, options: RequestInit) => {
      expect(options.signal).toBe(controller.signal);
      if (url.searchParams.get('prop') === 'templates') {
        expect(url.searchParams.get('tltemplates')).toContain(
          'Template:Infobox Set',
        );
        return new Response(
          JSON.stringify(templates(66837, 'Template:Infobox Set')),
        );
      }
      expect(url.pathname).toBe('/rest.php/v1/page/Iron_equipment/html');
      return new Response(
        '<table class="rsw-infobox infobox-set"><tbody><tr><th class="infobox-header">Iron equipment</th></tr><tr><th>Tradeable</th><td>Yes</td></tr></tbody></table>',
      );
    });
    vi.stubGlobal('fetch', request);

    expect(
      (await fetchInfobox(66837, 'Iron equipment', controller.signal))
        ?.variants[0]?.fields,
    ).toEqual([{ label: 'Tradeable', value: 'Yes' }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('requests the NPC default marker when fetching variants', async () => {
    const request = vi.fn(async (url: URL) => {
      if (url.searchParams.get('prop') === 'templates') {
        return new Response(
          JSON.stringify(templates(9785, 'Template:Infobox NPC')),
        );
      }
      expect(url.searchParams.get('query')).toContain("'default_version'");
      return new Response(
        JSON.stringify({
          bucket: [
            { npc_id: ['7935'] },
            { default_version: '', npc_id: ['0'] },
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', request);
    const infobox = await fetchInfobox(
      9785,
      'Hans',
      new AbortController().signal,
    );
    expect(infobox?.defaultVariantIndex).toBe(1);
  });

  it('fetches templates and then only the matching bucket for a selected page', async () => {
    const controller = new AbortController();
    const request = vi.fn(async (url: URL, options: RequestInit) => {
      expect(options.signal).toBe(controller.signal);
      if (url.searchParams.get('prop') === 'templates') {
        expect(url.searchParams.get('pageids')).toBe('195');
        expect(url.searchParams.get('tltemplates')).toContain(
          'Template:Infobox Quest',
        );
        return new Response(
          JSON.stringify(templates(195, 'Template:Infobox Quest')),
        );
      }
      expect(url.searchParams.get('action')).toBe('bucket');
      expect(url.searchParams.get('query')).toContain(
        `bucket('infobox_quest')`,
      );
      expect(url.searchParams.get('query')).toContain(
        `where('page_name',"Cook's Assistant")`,
      );
      return new Response(
        JSON.stringify({ bucket: [{ official_difficulty: 'Novice' }] }),
      );
    });
    vi.stubGlobal('fetch', request);

    expect(
      (await fetchInfobox(195, "Cook's Assistant", controller.signal))
        ?.variants[0]?.fields,
    ).toEqual([{ label: 'Difficulty', value: 'Novice' }]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
