import { MousePointer2, Pause, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { dispatch, watchState } from '@/lib/store';
import type { Annotation, Rect, State, Target } from '@/lib/types';
import { pageKey, sanitizeUrl } from '@/lib/url';
import { useDarkMode } from '@/lib/useDarkMode';
import { cn } from '@/lib/utils';
import { captureElement, captureRange, isAttached, locate, scrollToLocated, type Located } from './capture';

const CARD_WIDTH = 300;
const CARD_HEIGHT = 190;
const SETTLE_MS = 1500;
const PAGE_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'dblclick', 'auxclick', 'touchstart', 'touchend'];

export interface Controller {
  onUrlChange?: () => void;
}

function eventElement(event: Event, host: Element): Element | null {
  const path = event.composedPath();
  if (path.includes(host)) return null;
  return path[0] instanceof Element ? path[0] : null;
}

function viewportRect(located: Located): Rect | null {
  const rect = located.getBoundingClientRect();
  return rect.width || rect.height ? rect : null;
}

function px(value: number): string {
  return `${Math.round(value)}px`;
}

function box({ x, y, width, height }: Rect, grow = 0) {
  return {
    left: px(x - grow),
    top: px(y - grow),
    width: px(width + grow * 2),
    height: px(height + grow * 2),
  };
}

function cardPosition(rect: Rect): { left: string; top: string } {
  const below = rect.y + rect.height + 8;
  const top = below + CARD_HEIGHT < window.innerHeight ? below : rect.y - CARD_HEIGHT - 8;
  return {
    left: px(Math.min(Math.max(8, rect.x), window.innerWidth - CARD_WIDTH - 8)),
    top: px(Math.min(Math.max(8, top), window.innerHeight - CARD_HEIGHT - 8)),
  };
}

function useAnchors(annotations: Annotation[], focusId: string | null, resetKey: string) {
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const located = useRef(new Map<string, Located>());
  const latest = useRef({ annotations, focusId });
  latest.current = { annotations, focusId };
  const frame = useRef(0);
  const settle = useRef(0);

  const measure = useCallback(() => {
    frame.current = 0;
    const next: Record<string, Rect> = {};
    for (const { id, target } of latest.current.annotations) {
      let found = located.current.get(id);
      if (!found || !isAttached(found)) {
        found = locate(target) ?? undefined;
        if (found) located.current.set(id, found);
        else located.current.delete(id);
      }
      const rect = found && viewportRect(found);
      if (rect) next[id] = rect;
    }
    setRects(next);

    const { focusId } = latest.current;
    const focused = focusId && located.current.get(focusId);
    if (focused) {
      scrollToLocated(focused);
      setFlash(focusId);
      window.setTimeout(() => setFlash(null), 1600);
      void dispatch({ type: 'focus', id: null });
    }
  }, []);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(measure);
    window.clearTimeout(settle.current);
    // Content can arrive after the route does, so wait before calling anything missing.
    settle.current = window.setTimeout(() => {
      const { annotations, focusId } = latest.current;
      for (const { id, detached } of annotations) {
        const found = located.current.has(id);
        if (found === detached) void dispatch({ type: 'setDetached', id, detached: !found });
        if (!found && focusId === id) void dispatch({ type: 'focus', id: null });
      }
    }, SETTLE_MS);
  }, [measure]);

  useEffect(() => {
    located.current.clear();
    schedule();
  }, [resetKey, schedule]);
  useEffect(schedule, [annotations, focusId, schedule]);

  useEffect(() => {
    const onMove = () => {
      if (!frame.current) frame.current = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove);
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const resize = new ResizeObserver(onMove);
    resize.observe(document.documentElement);
    return () => {
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame.current);
      window.clearTimeout(settle.current);
    };
  }, [measure, schedule]);

  return { rects, flash };
}

interface Draft {
  target: Target;
  rect: Rect;
}

function CommentCard(props: {
  rect: Rect;
  quote?: string;
  initial?: string;
  hint: string;
  onSave: (comment: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [comment, setComment] = useState(props.initial ?? '');
  const field = useRef<HTMLTextAreaElement>(null);
  const position = useMemo(() => cardPosition(props.rect), [props.rect]);
  useEffect(() => field.current?.focus(), []);

  const save = () => {
    if (comment.trim()) props.onSave(comment.trim());
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onCancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };

  return (
    <Card className="fixed w-[300px] gap-0 p-3 shadow-lg" style={position}>
      {props.quote && (
        <p className="mb-2 truncate border-l-2 pl-2 text-xs text-muted-foreground">{props.quote}</p>
      )}
      <Textarea
        ref={field}
        value={comment}
        placeholder="What should change here?"
        onInput={(event) => setComment(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className="mt-2 flex items-center gap-2">
        {props.onDelete ? (
          <Button variant="ghost" size="sm" className="mr-auto text-destructive hover:text-destructive" onClick={props.onDelete}>
            Delete
          </Button>
        ) : (
          <span className="mr-auto text-xs text-muted-foreground">{props.hint}</span>
        )}
        <Button variant="outline" size="sm" onClick={props.onCancel}>Cancel</Button>
        <Button size="sm" disabled={!comment.trim()} onClick={save}>Save</Button>
      </div>
    </Card>
  );
}

export function App({ host, controller }: { host: HTMLElement; controller: Controller }) {
  const [state, setState] = useState<State | null>(null);
  const [key, setKey] = useState(() => pageKey(location.href));
  const [hover, setHover] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const dark = useDarkMode();

  useEffect(() => watchState(setState), []);
  useEffect(() => {
    controller.onUrlChange = () => setKey(pageKey(location.href));
  }, [controller]);
  useEffect(() => {
    setDraft(null);
    setEditing(null);
    setHover(null);
  }, [key]);

  const picking = !!state?.enabled && state.picking;
  const onPage = useMemo(
    () => state?.session.annotations.filter((annotation) => annotation.pageKey === key) ?? [],
    [state?.session.annotations, key],
  );
  const { rects, flash } = useAnchors(onPage, state?.focusId ?? null, key);

  useEffect(() => {
    if (!picking) {
      setHover(null);
      return;
    }
    let selecting = false;
    const inPage = (event: Event) => !event.composedPath().includes(host);
    const block = (event: Event) => {
      if (inPage(event)) event.stopImmediatePropagation();
    };
    const onMove = (event: MouseEvent) => {
      const element = eventElement(event, host);
      setHover(element ? element.getBoundingClientRect() : null);
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!inPage(event)) return;
      event.stopImmediatePropagation();
      const selection = window.getSelection();
      const range = selection && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      const target = range && captureRange(range);
      if (!target) return;
      selecting = true;
      setDraft((current) => current ?? { target, rect: range.getBoundingClientRect() });
    };
    const onClick = (event: MouseEvent) => {
      const element = eventElement(event, host);
      if (!element) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (selecting) {
        selecting = false;
        return;
      }
      setDraft((current) => current ?? {
        target: captureElement(element),
        rect: element.getBoundingClientRect(),
      });
    };
    const onDragStart = (event: Event) => {
      if (inPage(event)) event.preventDefault();
    };
    const options = { capture: true };
    PAGE_EVENTS.forEach((type) => window.addEventListener(type, block, options));
    window.addEventListener('mousemove', onMove, options);
    window.addEventListener('mouseup', onMouseUp, options);
    window.addEventListener('click', onClick, options);
    window.addEventListener('dragstart', onDragStart, options);
    return () => {
      PAGE_EVENTS.forEach((type) => window.removeEventListener(type, block, options));
      window.removeEventListener('mousemove', onMove, options);
      window.removeEventListener('mouseup', onMouseUp, options);
      window.removeEventListener('click', onClick, options);
      window.removeEventListener('dragstart', onDragStart, options);
    };
  }, [picking, host]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !picking || draft) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void dispatch({ type: 'setPicking', picking: false });
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [picking, draft]);

  if (!state?.enabled) return null;

  const saveDraft = (comment: string) => {
    if (!draft) return;
    setDraft(null);
    window.getSelection()?.removeAllRanges();
    void dispatch({
      type: 'add',
      annotation: {
        id: crypto.randomUUID(),
        comment,
        url: sanitizeUrl(location.href),
        pageKey: key,
        pageTitle: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        target: draft.target,
        createdAt: Date.now(),
      },
    });
  };

  const edited = onPage.find(({ id }) => id === editing);
  const editedRect = edited && rects[edited.id];
  const flashRect = flash ? rects[flash] : undefined;

  return (
    <div className={cn('font-sans text-sm text-foreground', dark && 'dark')}>
      {hover && !draft && (
        <div className="pointer-events-none fixed rounded-sm border-2 border-primary bg-primary/10 ring-1 ring-background" style={box(hover)} />
      )}
      {flashRect && (
        <div className="flash pointer-events-none fixed animate-flash rounded-md border-2 border-primary ring-4 ring-primary/20" style={box(flashRect, 3)} />
      )}
      {onPage.map(({ id, number }) => {
        const rect = rects[id];
        if (!rect) return null;
        const left = Math.max(2, Math.min(rect.x + rect.width - 12, window.innerWidth - 26));
        const top = rect.y - 12;
        if (top < -24 || top > window.innerHeight) return null;
        return (
          <Button
            className="pin fixed size-6 rounded-full p-0 text-xs font-semibold shadow-md ring-2 ring-background"
            title={`Annotation #${number}`}
            style={{ left: px(left), top: px(Math.max(2, top)) }}
            onClick={() => setEditing(id)}
          >
            {number}
          </Button>
        );
      })}
      {draft && (
        <CommentCard
          rect={draft.rect}
          quote={draft.target.quote}
          hint="⌘↵ to save"
          onSave={saveDraft}
          onCancel={() => setDraft(null)}
        />
      )}
      {edited && editedRect && (
        <CommentCard
          key={edited.id}
          rect={editedRect}
          quote={edited.target.quote}
          initial={edited.comment}
          hint=""
          onSave={(comment) => {
            setEditing(null);
            void dispatch({ type: 'edit', id: edited.id, comment });
          }}
          onCancel={() => setEditing(null)}
          onDelete={() => {
            setEditing(null);
            void dispatch({ type: 'delete', id: edited.id });
          }}
        />
      )}
      <Card className="pill fixed bottom-4 left-1/2 flex -translate-x-1/2 flex-row items-center gap-1 whitespace-nowrap p-1 shadow-lg">
        <Button
          variant={picking ? 'default' : 'ghost'}
          size="sm"
          className="toggle"
          onClick={() => void dispatch({ type: 'setPicking', picking: !picking })}
        >
          {picking ? <MousePointer2 /> : <Pause />}
          {picking ? 'Annotating · Esc to browse' : 'Browsing · Annotate'}
        </Button>
        <Badge variant="secondary" className="count mx-1">{state.session.annotations.length}</Badge>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="Turn off Cormark"
          onClick={() => void dispatch({ type: 'setEnabled', enabled: false })}
        >
          <X />
        </Button>
      </Card>
    </div>
  );
}
