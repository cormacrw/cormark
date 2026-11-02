import { Check, Copy, Info, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'preact/hooks';
import { browser, type Browser } from 'wxt/browser';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { buildPrompt } from '@/lib/prompt';
import { groupByPage } from '@/lib/state';
import { dispatch, watchState } from '@/lib/store';
import type { Annotation, State } from '@/lib/types';
import { isAnnotatable, pageKey } from '@/lib/url';
import { useDarkMode } from '@/lib/useDarkMode';

type CopyStatus = 'idle' | 'copied' | 'failed';

function useActiveTab(): Browser.tabs.Tab | null {
  const [tab, setTab] = useState<Browser.tabs.Tab | null>(null);
  useEffect(() => {
    const refresh = () => {
      void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => setTab(active ?? null));
    };
    refresh();
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(refresh);
    return () => {
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(refresh);
    };
  }, []);
  return tab;
}

function pagePath(url: string): string {
  const { pathname, search, hash } = new URL(url);
  return `${pathname}${search}${hash}`;
}

async function openAnnotation(annotation: Annotation, tab: Browser.tabs.Tab | null) {
  await dispatch({ type: 'focus', id: annotation.id });
  const here = isAnnotatable(tab?.url) && pageKey(tab.url) === annotation.pageKey;
  if (!here && tab?.id !== undefined) await browser.tabs.update(tab.id, { url: annotation.url });
}

function Item({ annotation, tab }: { annotation: Annotation; tab: Browser.tabs.Tab | null }) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(annotation.comment);
  const { number, target, detached, copiedAt } = annotation;

  const save = () => {
    setEditing(false);
    const trimmed = comment.trim();
    if (trimmed && trimmed !== annotation.comment) void dispatch({ type: 'edit', id: annotation.id, comment: trimmed });
    else setComment(annotation.comment);
  };

  return (
    <li className="item group flex gap-2 py-3">
      <Button
        className="size-6 shrink-0 rounded-full p-0 text-xs font-semibold"
        title="Show on page"
        onClick={() => void openAnnotation(annotation, tab)}
      >
        {number}
      </Button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <Textarea
            value={comment}
            autoFocus
            onInput={(event) => setComment(event.currentTarget.value)}
            onBlur={save}
          />
        ) : (
          <button
            className="comment block w-full cursor-pointer whitespace-pre-wrap text-left text-sm wrap-anywhere hover:underline"
            title="Show on page"
            onClick={() => void openAnnotation(annotation, tab)}
          >
            {annotation.comment}
          </button>
        )}
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {target.quote ? `“${target.quote}”` : target.element}
        </p>
        {(detached || copiedAt) && (
          <div className="mt-2 flex gap-1">
            {detached && <Badge variant="destructive" className="warn">Not found on page</Badge>}
            {copiedAt && <Badge variant="secondary" className="copied">Copied</Badge>}
          </div>
        )}
      </div>
      <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" title="Edit" onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          title="Delete"
          onClick={() => void dispatch({ type: 'delete', id: annotation.id })}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function Notice({ state, tab }: { state: State; tab: Browser.tabs.Tab | null }) {
  const message = !state.enabled
    ? 'Cormark is off. Click the toolbar icon to turn it on.'
    : !isAnnotatable(tab?.url)
      ? "Cormark isn't active on this page. Click the toolbar icon to enable it here. Browser pages like the Chrome Web Store can't be annotated."
      : null;
  if (!message) return null;
  return (
    <Alert className="notice">
      <Info className="size-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function Panel() {
  const [state, setState] = useState<State | null>(null);
  const [copy, setCopy] = useState<CopyStatus>('idle');
  const [confirming, setConfirming] = useState(false);
  const tab = useActiveTab();
  const dark = useDarkMode();

  useEffect(() => watchState(setState), []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  if (!state) return null;
  const { annotations } = state.session;
  const pages = groupByPage(annotations);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildPrompt(state.session));
      await dispatch({ type: 'markCopied', at: Date.now() });
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
    window.setTimeout(() => setCopy('idle'), 2000);
  };

  const startNewSession = () => {
    setConfirming(false);
    void dispatch({ type: 'newSession', id: crypto.randomUUID() });
  };

  return (
    <main className="flex h-dvh flex-col bg-background text-sm text-foreground">
      <header className="px-4 py-3">
        <h1 className="text-base font-semibold">Comments</h1>
      </header>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="pt-3 empty:hidden"><Notice state={state} tab={tab} /></div>
        {pages.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="font-medium">No annotations yet</p>
            <p className="mt-1 text-muted-foreground">
              Click anything on the page, or select text, then say what should change. Move between pages and keep going.
            </p>
          </div>
        )}
        {pages.map((page) => (
          <section className="page pt-4" key={page.pageKey}>
            <h2 className="truncate font-medium" title={page.url}>{page.pageTitle || pagePath(page.url)}</h2>
            <p className="truncate text-xs text-muted-foreground">{pagePath(page.url)}</p>
            <ul className="divide-y">
              {page.annotations.map((annotation) => (
                <Item key={annotation.id} annotation={annotation} tab={tab} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Separator />
      <footer className="flex flex-col gap-2 p-4">
        <Button className="copy w-full" disabled={!annotations.length} onClick={() => void copyPrompt()}>
          {copy === 'copied' ? <Check /> : <Copy />}
          {copy === 'copied' ? 'Copied' : copy === 'failed' ? "Couldn't copy" : 'Copy prompt'}
        </Button>
        {confirming ? (
          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <span className="mr-1">Clear all annotations?</span>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
            <Button variant="destructive" size="sm" onClick={startNewSession}>Clear</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" disabled={!annotations.length} onClick={() => setConfirming(true)}>
            New session
          </Button>
        )}
      </footer>
    </main>
  );
}
