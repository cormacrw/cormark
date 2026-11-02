export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything needed to find an element again and describe it to an agent. */
export interface Target {
  selector: string;
  path: string;
  tag: string;
  text: string;
  /** Last known position in document coordinates, used to break ties. */
  rect: Rect;
  /** Raw selected text, used only to re-find the selection. */
  range?: { exact: string; prefix: string; suffix: string };
  /** The visible part of the selection. This is what reaches the prompt. */
  quote?: string;
  element: string;
  location: string;
  styles: string;
}

export interface Annotation {
  id: string;
  /** Stable for the whole session, so "#4" keeps meaning the same thing. */
  number: number;
  comment: string;
  url: string;
  pageKey: string;
  pageTitle: string;
  viewport: { width: number; height: number };
  target: Target;
  createdAt: number;
  copiedAt: number | null;
  detached: boolean;
}

export interface Session {
  id: string;
  nextNumber: number;
  annotations: Annotation[];
}

export interface State {
  /** The overlay is shown on pages the extension can reach. */
  enabled: boolean;
  /** Clicks select elements instead of reaching the page. */
  picking: boolean;
  /** An annotation waiting to be scrolled to once its page is showing. */
  focusId: string | null;
  session: Session;
}
