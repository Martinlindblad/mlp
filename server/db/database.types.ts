import type { ColumnType, Generated, JSONColumnType } from 'kysely';
import type { ProjectDetails } from '../../types/DBTypes';

type Imported = { id: string; source_order: number };

export interface ProfileSectionsTable extends Imported {
  key: string;
  title: string;
  info: string;
  name: string;
  surname: string;
  description: string[] | null;
  image_source: string | null;
  link: string | null;
  link_text: string | null;
  profile_image: string | null;
}

export interface CurrentOccupationsTable extends Imported {
  title: string;
  occupation_type: string;
  description: string;
  from_label: string;
  to_label: string;
  introduction: string;
  name: string;
  link: string;
}

export interface HobbiesTable extends Imported {
  title: string;
  content: string;
  type: string;
}

export interface LanguagesTable extends Imported {
  name: string;
  spoken: string;
  written: string;
}

export interface PageCardsTable extends Imported {
  title: string;
  description: string;
  link: string;
  content: string | null;
  key: string;
  type: string;
}

export interface ProfessionalTimelineTable extends Imported {
  company: string | null;
  institution: string | null;
  qualification: string | null;
  duration: string;
  title: string;
  description: string;
  sort_index: number;
}

export interface ProjectsTable extends Imported {
  title: string;
  description: string;
  image_source: string;
  from_label: string | null;
  to_label: string | null;
  project_details: JSONColumnType<ProjectDetails>;
}

export interface PursuitsTable extends Imported {
  title: string;
  description: string;
  left_image_source: string;
  right_image_source: string;
}

export interface SocialLinksTable extends Imported {
  name: string;
  link: string;
}

export interface ContactMessagesTable {
  id: string;
  full_name: string;
  email: string;
  subject: string;
  message: string;
  created_at: ColumnType<Date, Date | string, never>;
}

export interface Database {
  profile_sections: ProfileSectionsTable;
  current_occupations: CurrentOccupationsTable;
  hobbies: HobbiesTable;
  languages: LanguagesTable;
  page_cards: PageCardsTable;
  professional_timeline: ProfessionalTimelineTable;
  projects: ProjectsTable;
  pursuits: PursuitsTable;
  social_links: SocialLinksTable;
  contact_messages: ContactMessagesTable;
  kysely_migration: { name: string; timestamp: string };
  kysely_migration_lock: { id: string; is_locked: Generated<number> };
}
