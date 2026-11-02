import { browser, type Browser } from 'wxt/browser';
import { reduce, type Action } from '@/lib/state';
import { isActionMessage, readState, writeState } from '@/lib/store';
import { isAnnotatable, sitePattern } from '@/lib/url';

let queue: Promise<unknown> = Promise.resolve();

function apply(action: Action): Promise<void> {
  const run = queue.then(async () => writeState(reduce(await readState(), action)));
  queue = run.catch(() => {});
  return run;
}

/** Safe to repeat: an annotator that's already on the page just re-reads the URL. */
async function inject(tabId: number): Promise<void> {
  await browser.scripting
    .executeScript({ target: { tabId }, files: ['/annotator.js'] })
    .catch(() => {}); // Restricted pages and sites without a grant can't be injected.
}

async function injectIfEnabled(tabId: number): Promise<void> {
  if ((await readState()).enabled) await inject(tabId);
}

async function onActionClicked(tab: Browser.tabs.Tab): Promise<void> {
  // Both calls need the click's user gesture, so neither can come after an await.
  void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  // The grant only matters for later pages. This one is covered by activeTab, so
  // the overlay shouldn't sit waiting for the dialog to be answered.
  if (isAnnotatable(tab.url)) {
    void browser.permissions.request({ origins: [sitePattern(tab.url)] }).catch(() => {});
  }

  await apply({ type: 'setEnabled', enabled: true });
  await apply({ type: 'setPicking', picking: true });
  if (tab.id !== undefined) await inject(tab.id);
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isActionMessage(message)) return;
    apply(message.action).then(
      () => sendResponse(true),
      () => sendResponse(false),
    );
    return true;
  });

  browser.action.onClicked.addListener((tab) => void onActionClicked(tab));

  // This covers full page loads and single-page app route changes, and with a
  // site grant it needs no extra permission, unlike webNavigation.
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url || change.status === 'complete') void injectIfEnabled(tabId);
  });
  browser.tabs.onActivated.addListener(({ tabId }) => void injectIfEnabled(tabId));

  browser.storage.onChanged.addListener(() => {
    void readState().then(({ enabled, session }) => {
      const count = session.annotations.length;
      void browser.action.setBadgeText({ text: enabled && count ? String(count) : '' });
      void browser.action.setBadgeBackgroundColor({ color: '#2f5fde' });
    });
  });
});
