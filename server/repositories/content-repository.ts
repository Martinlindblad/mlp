import type { Kysely, Selectable } from 'kysely';
import { READ_LIMITS } from '../api/contracts';
import type {
  CurrentOccupationsTable,
  Database,
  HobbiesTable,
  LanguagesTable,
  PageCardsTable,
  ProfessionalTimelineTable,
  ProfileSectionsTable,
  PursuitsTable,
  SocialLinksTable,
} from '../db/database.types';

export interface ContentRepository {
  findProfileSections(): Promise<Selectable<ProfileSectionsTable>[]>;
  findIntroduction(): Promise<Selectable<ProfileSectionsTable>[]>;
  findCurrentOccupations(): Promise<Selectable<CurrentOccupationsTable>[]>;
  findHobbies(): Promise<Selectable<HobbiesTable>[]>;
  findLanguages(): Promise<Selectable<LanguagesTable>[]>;
  findPageCards(): Promise<Selectable<PageCardsTable>[]>;
  findTimeline(): Promise<Selectable<ProfessionalTimelineTable>[]>;
  findPursuits(): Promise<Selectable<PursuitsTable>[]>;
  findSocialLinks(): Promise<Selectable<SocialLinksTable>[]>;
}

export function createContentRepository(
  db: Kysely<Database>,
): ContentRepository {
  return {
    findProfileSections: () =>
      db
        .selectFrom('profile_sections')
        .selectAll()
        .orderBy('source_order', 'asc')
        .limit(READ_LIMITS.about)
        .execute(),
    findIntroduction: () =>
      db
        .selectFrom('profile_sections')
        .selectAll()
        .where('key', '=', 'introduction')
        .orderBy('source_order', 'asc')
        .limit(1)
        .execute(),
    findCurrentOccupations: () =>
      db
        .selectFrom('current_occupations')
        .selectAll()
        .orderBy('source_order', 'asc')
        .limit(READ_LIMITS.currentOccupation)
        .execute(),
    findHobbies: () =>
      db
        .selectFrom('hobbies')
        .selectAll()
        .orderBy('source_order', 'asc')
        .limit(READ_LIMITS.hobbies)
        .execute(),
    findLanguages: () =>
      db
        .selectFrom('languages')
        .selectAll()
        .orderBy('source_order', 'asc')
        .limit(READ_LIMITS.languages)
        .execute(),
    findPageCards: () =>
      db
        .selectFrom('page_cards')
        .selectAll()
        .orderBy('source_order', 'asc')
        .limit(READ_LIMITS.pageCards)
        .execute(),
    findTimeline: () =>
      db
        .selectFrom('professional_timeline')
        .selectAll()
        .orderBy('source_order', 'asc')
        .limit(READ_LIMITS.professionalTimeline)
        .execute(),
    findPursuits: () =>
      db
        .selectFrom('pursuits')
        .selectAll()
        .orderBy('source_order', 'asc')
        .limit(READ_LIMITS.pursuit)
        .execute(),
    findSocialLinks: () =>
      db
        .selectFrom('social_links')
        .selectAll()
        .orderBy('source_order', 'asc')
        .limit(READ_LIMITS.socialmedia)
        .execute(),
  };
}
