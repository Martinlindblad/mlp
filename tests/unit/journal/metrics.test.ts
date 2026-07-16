import { describe, expect, it } from 'vitest';
import {
  serializeJournalOutcome,
  type JournalOutcome,
} from '../../../server/journal/metrics';

describe('contact journal metrics', () => {
  it.each<JournalOutcome>([
    'intent_failure',
    'projection_failure',
    'marker_failure',
    'conflict',
    'success',
  ])('serializes only the fixed outcome %s', (outcome) => {
    expect(serializeJournalOutcome(outcome)).toBe(
      `{"event":"contact_journal","outcome":"${outcome}"}\n`,
    );
  });

  it('cannot include request, object, key, endpoint, or secret sentinels', () => {
    const output = serializeJournalOutcome('success');

    for (const sentinel of [
      '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
      'martin@example.com',
      'v1/intents',
      'https://r2.example',
      'journal-2026-01',
      'secret-sentinel',
    ]) {
      expect(output).not.toContain(sentinel);
    }
  });
});
