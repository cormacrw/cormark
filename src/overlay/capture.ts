import type { Rect, Target } from '@/lib/types';

const TEST_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
const SNIPPET_ATTRIBUTES = ['id', 'class', ...TEST_ATTRIBUTES, 'role', 'aria-label', 'name', 'type', 'href', 'alt', 'title', 'placeholder'];
const LANDMARKS = 'main,nav,header,footer,aside,section,article,form,dialog,[role]';
const USER_INPUT = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const NEVER_TEXT = `${USER_INPUT},script,style,noscript,template`;
const MAX_TEXT = 120;
const MAX_TEXT_NODES = 300;

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** Generated names such as css-1x2y3z change between builds and can't be grepped for. */
function isGeneratedName(name: string): boolean {
  return (
    /^(css|sc|jsx|emotion|svelte)-/.test(name) ||
    /__[a-zA-Z0-9_-]{5,}$/.test(name) ||
    (/^_?[a-zA-Z0-9]{5,8}$/.test(name) && /\d/.test(name)) ||
    /^[0-9a-f]{8}-/.test(name) ||
    /^:r[0-9a-z]+:$/.test(name)
  );
}

function usefulClasses(element: Element): string[] {
  return [...element.classList].filter((name) => !isGeneratedName(name));
}

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function stableSelector(element: Element): string | null {
  const tag = element.tagName.toLowerCase();
  for (const attribute of TEST_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value) return `[${attribute}="${CSS.escape(value)}"]`;
  }
  if (element.id && !isGeneratedName(element.id)) return `#${CSS.escape(element.id)}`;
  const label = element.getAttribute('aria-label');
  if (label) return `${tag}[aria-label="${CSS.escape(label)}"]`;
  const name = element.getAttribute('name');
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;
  return null;
}

function structuralStep(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const siblings = element.parentElement
    ? [...element.parentElement.children].filter((child) => child.tagName === element.tagName)
    : [];
  return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(element) + 1})` : tag;
}

function structuralPath(element: Element): string {
  const steps: string[] = [];
  for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
    steps.unshift(structuralStep(node));
  }
  return steps.join(' > ');
}

/** Prefers a stable hook on the element or an ancestor, so the selector survives layout changes. */
function buildSelector(element: Element): string {
  const steps: string[] = [];
  for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
    const stable = stableSelector(node);
    if (stable && isUnique(stable)) {
      const selector = [stable, ...steps].join(' > ');
      if (isUnique(selector)) return selector;
    }
    steps.unshift(structuralStep(node));
  }
  return structuralPath(element);
}

function isTransparent(color: string): boolean {
  return color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
}

function backgroundBehind(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (!isTransparent(color)) return color;
  }
  return 'rgb(255, 255, 255)';
}

/** Rejects text a person couldn't read, which is where hidden prompt injections live. */
function isReadable(element: Element): boolean {
  if (element.closest(NEVER_TEXT)) return false;
  if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  const style = getComputedStyle(element);
  if (parseFloat(style.fontSize) < 4) return false;
  if (style.clipPath !== 'none' || style.clip.startsWith('rect(0')) return false;
  if (isTransparent(style.color) || style.color === backgroundBehind(element)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return false;
  return rect.right + window.scrollX > 0 && rect.bottom + window.scrollY > 0;
}

function readableText(root: Node, range?: Range): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const verdicts = new Map<Element, boolean>();
  const parts: string[] = [];
  for (let count = 0; walker.nextNode() && count < MAX_TEXT_NODES; count++) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent || (range && !range.intersectsNode(node))) continue;
    if (!verdicts.has(parent)) verdicts.set(parent, isReadable(parent));
    if (!verdicts.get(parent)) continue;
    let text = node.data;
    if (range?.endContainer === node) text = text.slice(0, range.endOffset);
    if (range?.startContainer === node) text = text.slice(range.startOffset);
    parts.push(text);
  }
  return normalize(parts.join(' '));
}

function snippet(element: Element, text: string): string {
  const tag = element.tagName.toLowerCase();
  const attributes = SNIPPET_ATTRIBUTES.flatMap((name) => {
    if (name === 'class') {
      const classes = usefulClasses(element).slice(0, 4);
      return classes.length ? [`class="${classes.join(' ')}"`] : [];
    }
    const value = element.getAttribute(name);
    if (!value || (name === 'id' && isGeneratedName(value))) return [];
    const shown = name === 'href' ? value.replace(/[?#].*$/, '') : value;
    return [`${name}="${truncate(normalize(shown), 80)}"`];
  });
  const open = `<${[tag, ...attributes].join(' ')}>`;
  if (element.matches(USER_INPUT) || !text) return open;
  return `${open}${truncate(text, MAX_TEXT)}</${tag}>`;
}

function landmarkLabel(element: Element): string {
  const label = element.getAttribute('aria-label');
  if (label) return normalize(label);
  const heading = element.querySelector('h1,h2,h3,h4,h5,h6,legend');
  return heading ? truncate(readableText(heading), 40) : '';
}

function location(element: Element): string {
  const steps: string[] = [];
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (!node.matches(LANDMARKS)) continue;
    const name = node.getAttribute('role') ?? node.tagName.toLowerCase();
    const label = landmarkLabel(node);
    steps.unshift(label ? `${name} "${label}"` : name);
  }
  return steps.join(' > ');
}

function styles(element: Element): string {
  const style = getComputedStyle(element);
  const font = style.fontFamily.split(',')[0]?.replace(/["']/g, '') ?? '';
  const parts = [`${style.fontSize} ${font} weight ${style.fontWeight}`, `color ${style.color}`];
  if (!isTransparent(style.backgroundColor)) parts.push(`background ${style.backgroundColor}`);
  if (style.borderRadius !== '0px') parts.push(`radius ${style.borderRadius}`);
  if (style.padding !== '0px') parts.push(`padding ${style.padding}`);
  return parts.join(', ');
}

function documentRect(rect: DOMRect): Rect {
  return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
}

export function captureElement(element: Element): Target {
  const text = truncate(readableText(element), MAX_TEXT);
  return {
    selector: buildSelector(element),
    path: structuralPath(element),
    tag: element.tagName.toLowerCase(),
    text,
    rect: documentRect(element.getBoundingClientRect()),
    element: snippet(element, text),
    location: location(element),
    styles: styles(element),
  };
}

export function captureRange(range: Range): Target | null {
  const common = range.commonAncestorContainer;
  const element = common instanceof Element ? common : common.parentElement;
  if (!element || element.closest(USER_INPUT)) return null;
  const quote = truncate(readableText(element, range), 500);
  if (!quote) return null;

  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(element);
  after.setStart(range.endContainer, range.endOffset);

  return {
    ...captureElement(element),
    rect: documentRect(range.getBoundingClientRect()),
    quote,
    range: {
      exact: range.toString(),
      prefix: before.toString().slice(-32),
      suffix: after.toString().slice(0, 32),
    },
  };
}

function textMatches(element: Element, text: string): boolean {
  return !text || normalize(element.textContent ?? '').includes(text.replace(/…$/, '').slice(0, 40));
}

function distance(element: Element, rect: Rect): number {
  const { x, y } = documentRect(element.getBoundingClientRect());
  return Math.hypot(x - rect.x, y - rect.y);
}

function closest(candidates: Element[], rect: Rect): Element | null {
  return [...candidates].sort((a, b) => distance(a, rect) - distance(b, rect))[0] ?? null;
}

function query(selector: string): Element[] {
  try {
    return [...document.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function findElement(target: Target): Element | null {
  for (const selector of [target.selector, target.path]) {
    const found = closest(query(selector).filter((element) => textMatches(element, target.text)), target.rect);
    if (found) return found;
  }
  if (!target.text) return null;
  const sameText = query(target.tag).filter(
    (element) => normalize(element.textContent ?? '').startsWith(target.text.replace(/…$/, '')),
  );
  return closest(sameText, target.rect);
}

function findRange(root: Element, { exact, prefix, suffix }: NonNullable<Target['range']>): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let content = '';
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
    content += (walker.currentNode as Text).data;
  }
  const withContext = content.indexOf(`${prefix}${exact}${suffix}`);
  const start = withContext >= 0 ? withContext + prefix.length : content.indexOf(exact);
  if (start < 0) return null;

  const range = document.createRange();
  const end = start + exact.length;
  let offset = 0;
  for (const node of nodes) {
    const next = offset + node.length;
    if (offset <= start && start <= next) range.setStart(node, start - offset);
    if (offset <= end && end <= next) {
      range.setEnd(node, end - offset);
      break;
    }
    offset = next;
  }
  return range;
}

export type Located = Element | Range;

export function locate(target: Target): Located | null {
  const element = findElement(target);
  if (!target.range) return element;
  return (element && findRange(element, target.range)) ?? (document.body && findRange(document.body, target.range));
}

export function isAttached(located: Located): boolean {
  return located instanceof Range ? located.startContainer.isConnected : located.isConnected;
}

export function scrollToLocated(located: Located): void {
  const element = located instanceof Range ? located.startContainer.parentElement : located;
  element?.scrollIntoView({ block: 'center' });
}
