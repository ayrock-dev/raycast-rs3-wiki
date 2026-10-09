import { Action, ActionPanel, Icon, List } from '@raycast/api';
import { useEffect, useRef, useState } from 'react';
import { fetchInfobox, type Infobox } from './infobox';
import {
  fetchIntroduction,
  fullSearchUrl,
  type Suggestion,
  searchSuggestions,
} from './runescape-wiki';

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | { kind: 'ready'; query: string; suggestions: Suggestion[] }
  | { kind: 'error'; query: string };

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading'; pageId: number }
  | { kind: 'ready'; pageId: number; introduction: string }
  | { kind: 'error'; pageId: number };

type InfoboxState =
  | { kind: 'idle' }
  | { kind: 'loading'; pageId: number }
  | { kind: 'ready'; pageId: number; infobox: Infobox | null }
  | { kind: 'error'; pageId: number };

const REQUEST_TIMEOUT_MS = 8_000;

function boundedSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|>~]/g, '\\$&');
}

function previewMarkdown(
  suggestion: Suggestion,
  preview: PreviewState,
): string {
  const title = `# ${escapeMarkdown(suggestion.title)}`;
  if (
    preview.kind === 'ready' &&
    preview.pageId === suggestion.pageId &&
    preview.introduction
  ) {
    return `${title}\n\n${escapeMarkdown(preview.introduction)}`;
  }

  const excerpt = suggestion.excerpt || 'No article preview available.';
  if (preview.kind === 'error' && preview.pageId === suggestion.pageId) {
    return `${title}\n\nCould not load the article introduction. The search excerpt is still available below; press Enter to read the page on the wiki.\n\n${escapeMarkdown(excerpt)}`;
  }
  if (preview.kind === 'ready' && preview.pageId === suggestion.pageId) {
    return `${title}\n\nNo article introduction is available. Search excerpt:\n\n${escapeMarkdown(excerpt)}`;
  }
  return `${title}\n\n${escapeMarkdown(excerpt)}`;
}

export default function Search() {
  const [searchText, setSearchText] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('search');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const [infoboxState, setInfoboxState] = useState<InfoboxState>({
    kind: 'idle',
  });
  const [selectedVariant, setSelectedVariant] = useState<{
    pageId: number;
    index: number;
  } | null>(null);
  const introductions = useRef(new Map<number, string>());
  const infoboxes = useRef(new Map<number, Infobox | null>());
  const query = searchText.trim();

  useEffect(() => {
    if (!query) {
      setState({ kind: 'idle' });
      return;
    }

    const controller = new AbortController();
    setState({ kind: 'loading', query });
    const timer = setTimeout(() => {
      searchSuggestions(query, boundedSignal(controller.signal))
        .then((suggestions) => setState({ kind: 'ready', query, suggestions }))
        .catch(() => {
          if (!controller.signal.aborted) setState({ kind: 'error', query });
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const current =
    'query' in state && state.query === query
      ? state
      : { kind: 'idle' as const };
  const suggestions = current.kind === 'ready' ? current.suggestions : [];
  const selectedSuggestion = suggestions.find(
    (suggestion) => suggestion.url === selectedItemId,
  );
  const selectedPageId = selectedSuggestion?.pageId;
  const selectedTitle = selectedSuggestion?.title;

  useEffect(() => {
    if (selectedPageId === undefined) return;

    const cached = introductions.current.get(selectedPageId);
    if (cached !== undefined) {
      setPreview({
        kind: 'ready',
        pageId: selectedPageId,
        introduction: cached,
      });
      return;
    }

    const controller = new AbortController();
    setPreview({ kind: 'loading', pageId: selectedPageId });
    const timer = setTimeout(() => {
      fetchIntroduction(selectedPageId, boundedSignal(controller.signal))
        .then((introduction) => {
          introductions.current.set(selectedPageId, introduction);
          setPreview({ kind: 'ready', pageId: selectedPageId, introduction });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setPreview({ kind: 'error', pageId: selectedPageId });
        });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedPageId]);

  useEffect(() => {
    if (selectedPageId === undefined || selectedTitle === undefined) return;

    if (infoboxes.current.has(selectedPageId)) {
      setInfoboxState({
        kind: 'ready',
        pageId: selectedPageId,
        infobox: infoboxes.current.get(selectedPageId) ?? null,
      });
      return;
    }

    const controller = new AbortController();
    setInfoboxState({ kind: 'loading', pageId: selectedPageId });
    const timer = setTimeout(() => {
      fetchInfobox(
        selectedPageId,
        selectedTitle,
        boundedSignal(controller.signal),
      )
        .then((infobox) => {
          infoboxes.current.set(selectedPageId, infobox ?? null);
          setInfoboxState({
            kind: 'ready',
            pageId: selectedPageId,
            infobox: infobox ?? null,
          });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setInfoboxState({ kind: 'error', pageId: selectedPageId });
        });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedPageId, selectedTitle]);

  const searchDescription =
    current.kind === 'error'
      ? 'Suggestions are unavailable. Press Enter to search on the wiki.'
      : current.kind === 'ready' && suggestions.length === 0
        ? 'No page suggestions found. Press Enter to search on the wiki.'
        : 'Press Enter to search the entire wiki, or select a page to preview it.';

  return (
    <List
      filtering={false}
      isShowingDetail
      isLoading={current.kind === 'loading'}
      searchBarPlaceholder="Search RuneScape Wiki..."
      searchText={searchText}
      onSearchTextChange={(text) => {
        setSearchText(text);
        setSelectedItemId('search');
      }}
      selectedItemId={selectedItemId}
      onSelectionChange={(id) => setSelectedItemId(id ?? 'search')}
    >
      {!query && (
        <List.EmptyView
          title="Search RuneScape Wiki"
          description="Type to find wiki pages"
        />
      )}
      {query && (
        <List.Item
          id="search"
          title={`Search Wiki for “${query}”`}
          icon={Icon.MagnifyingGlass}
          detail={
            <List.Item.Detail
              markdown={`# Search RuneScape Wiki\n\n${searchDescription}`}
            />
          }
          actions={
            <ActionPanel>
              <Action.OpenInBrowser
                title="Search Wiki"
                url={fullSearchUrl(query)}
              />
            </ActionPanel>
          }
        />
      )}
      {suggestions.map((suggestion) => {
        const infobox =
          infoboxState.kind === 'ready' &&
          infoboxState.pageId === suggestion.pageId
            ? infoboxState.infobox
            : null;
        const variantIndex =
          selectedVariant?.pageId === suggestion.pageId
            ? selectedVariant.index
            : infobox?.defaultVariantIndex;
        const fields =
          variantIndex === undefined
            ? []
            : (infobox?.variants[variantIndex]?.fields ?? []);

        return (
          <List.Item
            key={suggestion.url}
            id={suggestion.url}
            title={suggestion.title}
            icon={
              suggestion.imageUrl
                ? { source: suggestion.imageUrl }
                : Icon.Document
            }
            detail={
              <List.Item.Detail
                isLoading={
                  (preview.kind === 'loading' &&
                    preview.pageId === suggestion.pageId) ||
                  (infoboxState.kind === 'loading' &&
                    infoboxState.pageId === suggestion.pageId)
                }
                markdown={previewMarkdown(suggestion, preview)}
                metadata={
                  infobox ? (
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title={infobox.label} />
                      {infobox.variants.length > 1 && (
                        <List.Item.Detail.Metadata.Label
                          title="Variant"
                          text={
                            variantIndex === undefined
                              ? `Choose one of ${infobox.variants.length}${infobox.hasMore ? '+' : ''} in Actions`
                              : (infobox.variants[variantIndex]?.name ??
                                `${variantIndex + 1} of ${infobox.variants.length}${infobox.hasMore ? '+' : ''}`)
                          }
                        />
                      )}
                      {fields.map((field) => (
                        <List.Item.Detail.Metadata.Label
                          key={field.label}
                          title={field.label}
                          text={field.value}
                        />
                      ))}
                    </List.Item.Detail.Metadata>
                  ) : infoboxState.kind === 'error' &&
                    infoboxState.pageId === suggestion.pageId ? (
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label
                        title="Metadata"
                        text="Unavailable — open the wiki page for details"
                      />
                    </List.Item.Detail.Metadata>
                  ) : undefined
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.OpenInBrowser
                  title="Open Wiki Page"
                  url={suggestion.url}
                />
                {infobox && infobox.variants.length > 1 && (
                  <ActionPanel.Submenu title="Choose Variant">
                    {infobox.variants.map((variant, index) => {
                      const hint = variant.fields.find((field) =>
                        [
                          'Examine',
                          'Combat level',
                          'NPC ID',
                          'Object ID',
                        ].includes(field.label),
                      )?.value;
                      return (
                        <Action
                          key={variant.key}
                          title={
                            variant.name ??
                            `Variant ${index + 1}${hint ? ` · ${hint.slice(0, 40)}` : ''}`
                          }
                          onAction={() =>
                            setSelectedVariant({
                              pageId: suggestion.pageId,
                              index,
                            })
                          }
                        />
                      );
                    })}
                  </ActionPanel.Submenu>
                )}
                <Action.OpenInBrowser
                  title="Search Wiki"
                  url={fullSearchUrl(query)}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
