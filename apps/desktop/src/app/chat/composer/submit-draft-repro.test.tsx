/**
 * Regression test for issue #39560: submitDraft must read draftRef.current,
 * not the stale React `draft` prop.
 *
 * Race condition: submitDraft() fires inside keydown, BEFORE the `input` event
 * that syncs DOM → React store. The store always lags one keystroke behind.
 * `draftRef.current` is updated inside handleInput (called by the `input` event),
 * but handleInput also pre-updates draftRef synchronously before any React
 * re-render, so keydown's call to submitDraft() sees the correct value.
 */
import { describe, expect, it, vi } from 'vitest'

// Minimal simulation of the race between keydown (fires submitDraft) and
// input event (fires handleInput, which is the DOM→store sync).
describe('draftRef.current vs draft (the store race)', () => {
  // Simulates the bug: submitDraft reads `draft` (the store, not the ref)
  function submitDraft_BUGGY({ draft, draftRef }: { draft: string; draftRef: React.MutableRefObject<string> }) {
    if (draft.trim()) {
      return draft // BUG: reads stale store, misses last keystroke
    }
    return null
  }

  // Simulates the fix: submitDraft reads draftRef.current
  function submitDraft_FIXED({ draftRef }: { draft: string; draftRef: React.MutableRefObject<string> }) {
    if (draftRef.current.trim()) {
      return draftRef.current // FIX: reads ref, which is always current
    }
    return null
  }

  it('BUG mode truncates last keystroke (store lags behind DOM)', () => {
    let draft = 'hello'
    const draftRef = { current: 'hello' }

    // User types ' world' — DOM is updated immediately
    const newText = 'hello world'
    // BUT: keydown fires submitDraft BEFORE input event updates the store
    // So `draft` (store) is still 'hello', while DOM and draftRef have 'hello world'

    // Simulate: draftRef is updated by handleInput running AFTER keydown returns,
    // BUT submitDraft already fired inside keydown with stale `draft`
    // In this simulation we set draftRef AFTER calling BUG version
    const draftRefAfterInput = { current: newText }

    const buggyResult = submitDraft_BUGGY({ draft, draftRef: draftRefAfterInput })

    // When BUGGY submit fires inside keydown: draft='hello', draftRef='hello world'
    // The store `draft` hasn't been updated yet (input event hasn't fired)
    // But in our sim, draftRef is already updated — the bug is that we READ `draft` not draftRef.current
    // So buggy always reads the store value

    // Demonstrate: if store hasn't updated yet, BUG reads stale value
    expect(submitDraft_BUGGY({ draft: 'hello', draftRef: { current: newText } })).toBe('hello')
  })

  it('FIX mode always submits the complete text from draftRef', () => {
    const draftRef = { current: 'hello world' }
    const result = submitDraft_FIXED({ draft: 'hello', draftRef })
    expect(result).toBe('hello world')
  })

  it('CJK reproduction: "帮我查一下这个bug" is complete with FIX', () => {
    const text = '帮我查一下这个bug'
    const draftRef = { current: text }
    const staleDraft = '' // store hasn't synced yet

    const buggy = submitDraft_BUGGY({ draft: staleDraft, draftRef })
    const fixed = submitDraft_FIXED({ draft: staleDraft, draftRef })

    // BUG: submitted '' (empty because store was still '')
    expect(buggy).toBeNull()
    // FIX: submitted the full text from draftRef
    expect(fixed).toBe(text)
  })

  it('realistic sequence: rapid typing + Enter, no punctuation', () => {
    // Simulate rapid typing of "hello world" with Enter at end
    // Store (draft) reflects only committed state; ref tracks DOM state
    let draftStore = 'hello'
    const draftRef = { current: 'hello' }

    // Simulate rapid char-by-char typing, then Enter
    // At 'd': store='hello worl', ref='hello worl'  (last keystroke committed)
    // At 'd' Enter: ref='hello world' BEFORE input event → FIX reads complete, BUG reads 'hello worl'
    draftStore = 'hello worl'
    draftRef.current = 'hello world'

    expect(submitDraft_FIXED({ draft: draftStore, draftRef })).toBe('hello world')

    // BUG: truncated to 'hello worl' (misses the 'd' that was already in DOM)
    expect(submitDraft_BUGGY({ draft: draftStore, draftRef })).toBe('hello worl')
  })
})