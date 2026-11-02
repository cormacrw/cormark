import { render } from 'preact';
import { App, type Controller } from '@/overlay/App';
import css from '@/assets/tailwind.css?inline';

declare global {
  interface Window {
    __cormark?: Controller;
  }
}

export default defineUnlistedScript(() => {
  if (window.__cormark) {
    window.__cormark.onUrlChange?.();
    return;
  }
  const controller: Controller = {};
  window.__cormark = controller;

  const host = document.createElement('cormark-overlay');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'open' });

  // A constructed sheet still applies on pages whose CSP blocks <style> tags.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadow.adoptedStyleSheets = [sheet];

  // Stops site shortcuts from firing while typing in a comment.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }

  document.documentElement.append(host);
  render(<App host={host} controller={controller} />, shadow);
});
