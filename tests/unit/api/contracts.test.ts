import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CaseData, PersonalInfo } from '../../../types/DBTypes';

describe('legacy public identifiers', () => {
  it('remain serialized strings', () => {
    const profile: PersonalInfo = {
      _id: '64b000000000000000000001',
      title: 'Hej',
      info: 'Portfolio',
      name: 'Martin',
      surname: 'Lindblad',
      key: 'introduction',
    };

    expect(profile._id).toMatch(/^[0-9a-f]{24}$/);
    expectTypeOf<CaseData['_id']>().toEqualTypeOf<string>();
  });
});
