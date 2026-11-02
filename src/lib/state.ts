import type { Annotation, Session, State } from './types';

export type NewAnnotation = Omit<Annotation, 'number' | 'copiedAt' | 'detached'>;

export type Action =
  | { type: 'add'; annotation: NewAnnotation }
  | { type: 'edit'; id: string; comment: string }
  | { type: 'delete'; id: string }
  | { type: 'setDetached'; id: string; detached: boolean }
  | { type: 'setEnabled'; enabled: boolean }
  | { type: 'setPicking'; picking: boolean }
  | { type: 'focus'; id: string | null }
  | { type: 'markCopied'; at: number }
  | { type: 'newSession'; id: string };

export function emptySession(id: string): Session {
  return { id, nextNumber: 1, annotations: [] };
}

export function initialState(sessionId: string): State {
  return { enabled: false, picking: false, focusId: null, session: emptySession(sessionId) };
}

function updateAnnotations(state: State, update: (list: Annotation[]) => Annotation[]): State {
  return { ...state, session: { ...state.session, annotations: update(state.session.annotations) } };
}

function patch(state: State, id: string, change: Partial<Annotation>): State {
  return updateAnnotations(state, (list) =>
    list.map((annotation) => (annotation.id === id ? { ...annotation, ...change } : annotation)),
  );
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      const { session } = state;
      const annotation: Annotation = {
        ...action.annotation,
        number: session.nextNumber,
        copiedAt: null,
        detached: false,
      };
      return {
        ...state,
        session: {
          ...session,
          nextNumber: session.nextNumber + 1,
          annotations: [...session.annotations, annotation],
        },
      };
    }
    case 'edit':
      return patch(state, action.id, { comment: action.comment });
    case 'delete': {
      const next = updateAnnotations(state, (list) => list.filter(({ id }) => id !== action.id));
      return state.focusId === action.id ? { ...next, focusId: null } : next;
    }
    case 'setDetached':
      return patch(state, action.id, { detached: action.detached });
    case 'setEnabled':
      return { ...state, enabled: action.enabled, picking: action.enabled && state.picking };
    case 'setPicking':
      return { ...state, picking: action.picking };
    case 'focus':
      return { ...state, focusId: action.id };
    case 'markCopied':
      return updateAnnotations(state, (list) =>
        list.map((annotation) => ({ ...annotation, copiedAt: action.at })),
      );
    case 'newSession':
      return { ...state, focusId: null, session: emptySession(action.id) };
  }
}

export interface PageGroup {
  pageKey: string;
  url: string;
  pageTitle: string;
  annotations: Annotation[];
}

/** Groups annotations by page, with pages in the order they were first annotated. */
export function groupByPage(annotations: Annotation[]): PageGroup[] {
  const groups = new Map<string, PageGroup>();
  for (const annotation of [...annotations].sort((a, b) => a.number - b.number)) {
    const { pageKey, url, pageTitle } = annotation;
    const group = groups.get(pageKey) ?? { pageKey, url, pageTitle, annotations: [] };
    group.annotations.push(annotation);
    groups.set(pageKey, group);
  }
  return [...groups.values()];
}
