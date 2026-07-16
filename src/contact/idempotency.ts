export interface ContactFormValues {
  fullName: string;
  email: string;
  subject: string;
  message: string;
}

export interface PendingContactAttempt {
  key: string;
  canonicalPayload: string;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function contactPayloadJson(input: ContactFormValues): string {
  return JSON.stringify({
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    subject: input.subject.trim(),
    message: input.message.trim(),
  });
}

export function selectAttempt(
  current: PendingContactAttempt | null,
  input: ContactFormValues,
  randomUUID: () => string,
): PendingContactAttempt {
  const canonicalPayload = contactPayloadJson(input);
  if (current?.canonicalPayload === canonicalPayload) {
    return current;
  }

  const key = randomUUID();
  if (!UUID_V4_PATTERN.test(key)) {
    throw new Error('invalid contact idempotency key');
  }

  return { key, canonicalPayload };
}
