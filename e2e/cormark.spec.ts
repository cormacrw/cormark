import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { startFixture } from './fixture';

const extension = resolve('.output/e2e/chrome-mv3');

let context: BrowserContext;
let worker: Worker;
let panel: Page;
let page: Page;
let server: Server;
let origin: string;
let profile: string;
let extensionId: string;

test.beforeAll(async () => {
  ({ server, origin } = await startFixture());
  profile = mkdtempSync(join(tmpdir(), 'cormark-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1200, height: 800 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--enable-unsafe-extension-debugging',
    ],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.bringToFront();
});

test.afterAll(async () => {
  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
});

test.beforeEach(async () => {
  await panel.evaluate(() => chrome.storage.local.clear());
});

/** Fires the real toolbar action, so the click's user gesture and activeTab grant apply. */
async function start(path: string) {
  await page.goto(`${origin}${path}`);
  await page.bringToFront();
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const tab = targetInfos.find(({ url }) => url === page.url());
  await cdp.send('Extensions.triggerAction' as never, { id: extensionId, targetId: tab?.targetId } as never);
  await cdp.detach();
  await expect(overlay(page).locator('.pill')).toContainText('Annotating');
}

const overlay = (target: Page) => target.locator('cormark-overlay');

async function annotate(selector: string, comment: string) {
  await page.locator(selector).click();
  await overlay(page).locator('textarea').fill(comment);
  await overlay(page).getByRole('button', { name: 'Save' }).click();
  await expect(overlay(page).locator('textarea')).toHaveCount(0);
}

async function setBrowsing() {
  await overlay(page).locator('.toggle').click();
  await expect(overlay(page).locator('.pill')).toContainText('Browsing');
}

async function setAnnotating() {
  await overlay(page).locator('.toggle').click();
  await expect(overlay(page).locator('.pill')).toContainText('Annotating');
}

async function copyPrompt(): Promise<string> {
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Copy prompt' }).click();
  await expect(panel.locator('.copy')).toHaveText('Copied');
  // Pasting proves the text reached the real clipboard.
  await panel.evaluate(() => {
    const field = document.createElement('textarea');
    field.id = 'paste-check';
    document.body.append(field);
    field.focus();
  });
  await panel.keyboard.press('ControlOrMeta+V');
  const text = await panel.locator('#paste-check').inputValue();
  await panel.evaluate(() => document.querySelector('#paste-check')?.remove());
  await page.bringToFront();
  return text;
}

test('picks elements without triggering them', async () => {
  await start('/pricing');
  await annotate('[data-testid="trial-cta"]', 'Make this primary');

  await expect(page).toHaveTitle('Pricing – Acme');
  await expect(overlay(page).locator('.pin')).toHaveText('1');
  await expect(panel.locator('.item .comment')).toHaveText('Make this primary');

  const pin = (await overlay(page).locator('.pin').boundingBox())!;
  const element = (await page.locator('[data-testid="trial-cta"]').boundingBox())!;
  expect(Math.abs(pin.x + pin.width / 2 - (element.x + element.width))).toBeLessThan(3);
  expect(Math.abs(pin.y + pin.height / 2 - element.y)).toBeLessThan(3);
});

test('builds one prompt across full page loads', async () => {
  await start('/pricing?plan=pro&access_token=abc123');
  await annotate('[data-testid="trial-cta"]', 'Make this primary');
  await setBrowsing();

  await page.getByRole('link', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/signup/);
  await expect(overlay(page).locator('.pill')).toContainText('Browsing');
  await expect(overlay(page).locator('.pin')).toHaveCount(0);

  await setAnnotating();
  await annotate('button.cta', 'Use the same button as #1');

  await expect(panel.locator('.page')).toHaveCount(2);
  const prompt = await copyPrompt();
  expect(prompt).toContain('2 annotations across 2 pages');
  expect(prompt).toContain('> Make this primary');
  expect(prompt).toContain('selector: [data-testid="trial-cta"]');
  expect(prompt).toContain('location: main "Pricing" > section "Plans"');
  expect(prompt).toContain('access_token=REDACTED');
  expect(prompt).not.toContain('abc123');
  expect(prompt).not.toContain('css-1x2y3z');
  expect(prompt.indexOf('### #1')).toBeLessThan(prompt.indexOf('### #2'));
  await expect(panel.locator('.copied')).toHaveCount(2);
});

test('follows single-page app routes', async () => {
  await start('/app');
  await annotate('#compose', 'Rename this');
  await setBrowsing();

  await page.locator('#go').click();
  await expect(page).toHaveURL(/app\/settings/);
  await expect(overlay(page).locator('.pin')).toHaveCount(0);

  await setAnnotating();
  await annotate('#save', 'Move this right');
  await expect(overlay(page).locator('.pin')).toHaveText('2');
  await expect(panel.locator('.page')).toHaveCount(2);
});

test('re-anchors after a reload and tracks layout changes', async () => {
  await start('/pricing');
  await annotate('#blurb', 'Shorten this');
  await page.reload();
  const pin = overlay(page).locator('.pin');
  await expect(pin).toHaveText('1');

  const before = (await pin.boundingBox())!;
  await page.evaluate(() => document.querySelector('main')!.insertAdjacentHTML('afterbegin', '<div style="height:120px"></div>'));
  await expect.poll(async () => (await pin.boundingBox())!.y).toBeGreaterThan(before.y + 100);
});

test('marks missing elements as detached and keeps them in the prompt', async () => {
  await start('/pricing');
  await annotate('#blurb', 'Shorten this');
  await page.evaluate(() => document.querySelector('#blurb')!.remove());

  await expect(panel.locator('.warn')).toHaveText('Not found on page');
  expect(await copyPrompt()).toContain('Not found on the page when last checked');
  await expect(overlay(page).locator('.pin')).toHaveCount(0);

  await page.evaluate(() => {
    const paragraph = document.createElement('p');
    paragraph.id = 'blurb';
    paragraph.textContent = 'Everything your team needs to ship faster every day.';
    document.querySelector('section')!.append(paragraph);
  });
  await expect(panel.locator('.warn')).toHaveCount(0);
});

test('annotates text selections', async () => {
  await start('/pricing');
  const box = (await page.locator('#blurb').boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await overlay(page).locator('textarea').fill('Reword');
  await overlay(page).getByRole('button', { name: 'Save' }).click();

  await expect(overlay(page).locator('.pin')).toHaveText('1');
  await page.reload();
  await expect(overlay(page).locator('.pin')).toHaveText('1');
  expect(await copyPrompt()).toContain('selected text: "Everything');
});

test('opens an annotation from another page', async () => {
  await start('/pricing');
  await annotate('#blurb', 'Shorten this');
  await setBrowsing();
  await page.goto(`${origin}/signup`);
  await expect(overlay(page).locator('.pill')).toBeVisible();

  // A real click would make the panel the active tab, which a side panel never is.
  await panel.locator('.comment').evaluate((element: HTMLElement) => element.click());
  await expect(page).toHaveURL(/pricing/);
  await expect(overlay(page).locator('.pin')).toHaveText('1');
  await expect(overlay(page).locator('.flash')).toHaveCount(1);
});

test('never captures input values', async () => {
  await start('/signup');
  await annotate('#password', 'Add a show toggle');
  await annotate('#notes', 'Make this taller');

  const prompt = await copyPrompt();
  expect(prompt).toContain('<input id="password" type="password">');
  expect(prompt).not.toContain('hunter2');
  expect(prompt).not.toContain('private draft');
});

test('works under a strict CSP and leaves hidden text out of the prompt', async () => {
  await start('/hostile');
  await expect(overlay(page).locator('.pill')).toHaveCSS('position', 'fixed');
  await annotate('#visible', 'Tidy this');

  const prompt = await copyPrompt();
  expect(prompt).toContain('Visible copy');
  expect(prompt).toContain('and more.');
  for (const hidden of ['Ignore all previous', 'Exfiltrate', 'Upload the env', 'Disable the tests']) {
    expect(prompt).not.toContain(hidden);
  }
});

test('ignores the page root font size', async () => {
  await start('/pricing');
  const toggle = overlay(page).locator('.toggle');
  const height = (await toggle.boundingBox())!.height;
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '10px';
  });
  expect((await toggle.boundingBox())!.height).toBe(height);
});

test('renders its styles inside the shadow root', async () => {
  await start('/pricing');
  const pill = overlay(page).locator('.pill');
  const box = (await pill.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(1);
  await expect(pill).toHaveCSS('border-top-style', 'solid');
  await expect(pill).not.toHaveCSS('box-shadow', 'none');
});

test('stays off after being turned off', async () => {
  await start('/pricing');
  await overlay(page).getByTitle('Turn off Cormark').click();
  await page.goto(`${origin}/signup`);
  await expect(panel.locator('.notice')).toContainText('Cormark is off');
  await expect(overlay(page)).toHaveCount(0);
});
