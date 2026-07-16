export type JournalOutcome =
  | 'intent_failure'
  | 'projection_failure'
  | 'marker_failure'
  | 'conflict'
  | 'success';

export function serializeJournalOutcome(outcome: JournalOutcome): string {
  return JSON.stringify({
    event: 'contact_journal',
    outcome,
  }) + '\n';
}
