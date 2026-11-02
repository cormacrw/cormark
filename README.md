# Cormark

A Chrome extension for annotating web pages and copying the notes as a prompt for a coding agent. One session can span many pages, and the prompt is grouped by page.

## Use it

```sh
pnpm install
pnpm build
```

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `.output/chrome-mv3`.

1. Click the toolbar icon or press `Alt+Shift+A`. The side panel opens and the page enters annotate mode.
2. Allow access to the site when Chrome asks. Without it, Cormark can't follow you to a different site in the same tab.
3. Click an element, or select text, and write what should change.
4. Press `Esc` to browse, go to another page and keep annotating.
5. Choose **Copy prompt** in the side panel and paste it into your agent.

Click a pin to edit it, or click an annotation in the side panel to jump to it.

## Develop

```sh
pnpm dev         # Chrome with hot reload
pnpm test        # unit tests
pnpm test:e2e    # builds, then drives the extension in Chromium
pnpm typecheck
pnpm zip         # Web Store package
```

The first end-to-end run needs `pnpm exec playwright install chromium`.

- `src/entrypoints/background.ts` owns every state write and injects the overlay.
- `src/entrypoints/annotator.tsx` and `src/overlay/` are the in-page UI, element capture and re-anchoring.
- `src/entrypoints/sidepanel/` is the session list and copy action.
- `src/lib/` is browser-independent: state, URL handling and prompt building.
- `src/components/ui/` holds shadcn components, which run on Preact through `preact/compat`. Add more with `pnpm dlx shadcn@latest add <name>`, then check where they landed: the CLI can resolve the `@` alias outside the project.

The overlay renders in a Shadow DOM on other people's pages, so `src/assets/tailwind.css` uses `px` sizes and sets Tailwind's `@property` defaults by hand. Avoid shadcn components that portal to `document.body` in the overlay, because they'd land outside the shadow root.

## What the prompt leaves out

Copied page content can reach an agent, so capture is deliberately narrow:

- Input values, textareas and editable content are never captured.
- Text a person can't read is dropped, such as hidden, clipped, transparent or off-screen text.
- Page data sits in fenced blocks that the prompt marks as data, and page text can't close those fences.
- Tokens and credentials in URLs are redacted before storage.

## Limits

- Cross-origin iframes can be annotated only as a whole element.
- `chrome://` pages and the Chrome Web Store can't be annotated.
- Annotations on modals, tabs or logged-in views show as "Not found on page" when that state isn't showing. They stay in the prompt.
