import { describe, expect, it } from 'vitest';
import { groupByPage, initialState, reduce, type NewAnnotation } from './state';

const draft = (id: string, pageKey = 'p1'): NewAnnotation =>
  ({ id, pageKey, url: pageKey, pageTitle: pageKey, comment: id }) as NewAnnotation;

describe('reduce', () => {
  it('never reuses a number after a delete', () => {
    let state = reduce(initialState('s'), { type: 'add', annotation: draft('a') });
    state = reduce(state, { type: 'add', annotation: draft('b') });
    state = reduce(state, { type: 'delete', id: 'b' });
    state = reduce(state, { type: 'add', annotation: draft('c') });
    expect(state.session.annotations.map(({ number }) => number)).toEqual([1, 3]);
  });

  it('turns picking off when disabled', () => {
    let state = reduce(initialState('s'), { type: 'setEnabled', enabled: true });
    state = reduce(state, { type: 'setPicking', picking: true });
    expect(reduce(state, { type: 'setEnabled', enabled: false }).picking).toBe(false);
  });

  it('starts numbering again in a new session', () => {
    let state = reduce(initialState('s'), { type: 'add', annotation: draft('a') });
    state = reduce(state, { type: 'newSession', id: 's2' });
    state = reduce(state, { type: 'add', annotation: draft('b') });
    expect(state.session.annotations[0]?.number).toBe(1);
  });
});

describe('groupByPage', () => {
  it('orders pages by their first annotation', () => {
    let state = initialState('s');
    for (const [id, page] of [['a', 'p1'], ['b', 'p2'], ['c', 'p1']] as const) {
      state = reduce(state, { type: 'add', annotation: draft(id, page) });
    }
    expect(groupByPage(state.session.annotations).map(({ pageKey, annotations }) => [pageKey, annotations.length])).toEqual([
      ['p1', 2],
      ['p2', 1],
    ]);
  });
});
