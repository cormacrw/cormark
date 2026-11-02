import { browser } from 'wxt/browser';
import { initialState, type Action } from './state';
import type { State } from './types';

export const STATE_KEY = 'cormark';
const ACTION_MESSAGE = 'cormark/action';

export interface ActionMessage {
  type: typeof ACTION_MESSAGE;
  action: Action;
}

export function isActionMessage(message: unknown): message is ActionMessage {
  return (message as ActionMessage | undefined)?.type === ACTION_MESSAGE;
}

export async function readState(): Promise<State> {
  const stored = await browser.storage.local.get(STATE_KEY);
  return (stored[STATE_KEY] as State | undefined) ?? initialState(crypto.randomUUID());
}

export function writeState(state: State): Promise<void> {
  return browser.storage.local.set({ [STATE_KEY]: state });
}

/** All writes go through the background worker, so tabs and the panel can't overwrite each other. */
export async function dispatch(action: Action): Promise<void> {
  await browser.runtime.sendMessage({ type: ACTION_MESSAGE, action } satisfies ActionMessage);
}

export function watchState(listener: (state: State) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[STATE_KEY]?.newValue) {
      listener(changes[STATE_KEY].newValue as State);
    }
  };
  browser.storage.onChanged.addListener(onChanged);
  void readState().then(listener);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
