import type { Selectable } from 'kysely';
import type {
  CareerSummary,
  CaseData,
  InformationCard,
  Interest,
  Language,
  PersonalInfo,
  ProfessionalTimeline,
  Pursuit,
  SocailMediaLink,
} from '../../types/DBTypes';
import type {
  CurrentOccupationsTable,
  HobbiesTable,
  LanguagesTable,
  PageCardsTable,
  ProfessionalTimelineTable,
  ProfileSectionsTable,
  ProjectsTable,
  PursuitsTable,
  SocialLinksTable,
} from '../db/database.types';

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== null && item !== undefined,
    ),
  ) as T;
}

export const serializeProfileSection = (
  row: Selectable<ProfileSectionsTable>,
): PersonalInfo =>
  compact({
    _id: row.id,
    key: row.key,
    title: row.title,
    info: row.info,
    name: row.name,
    surname: row.surname,
    description: row.description,
    imageSource: row.image_source,
    link: row.link,
    linkText: row.link_text,
    profileImage: row.profile_image,
  }) as PersonalInfo;

export const serializeCurrentOccupation = (
  row: Selectable<CurrentOccupationsTable>,
): CareerSummary => ({
  _id: row.id,
  title: row.title,
  occupationType: row.occupation_type,
  description: row.description,
  from: row.from_label,
  to: row.to_label,
  introduction: row.introduction,
  name: row.name,
  link: row.link,
});

export const serializeHobby = (row: Selectable<HobbiesTable>): Interest => ({
  _id: row.id,
  title: row.title,
  content: row.content,
  type: row.type as Interest['type'],
});

export const serializeLanguage = (
  row: Selectable<LanguagesTable>,
): Language => ({
  _id: row.id,
  name: row.name,
  spoken: row.spoken,
  written: row.written,
});

export const serializePageCard = (
  row: Selectable<PageCardsTable>,
): InformationCard =>
  compact({
    _id: row.id,
    title: row.title,
    description: row.description,
    link: row.link,
    content: row.content,
    key: row.key as InformationCard['key'],
    type: row.type as InformationCard['type'],
  }) as InformationCard;

export const serializeTimeline = (
  row: Selectable<ProfessionalTimelineTable>,
): ProfessionalTimeline =>
  compact({
    _id: row.id,
    company: row.company,
    institution: row.institution,
    qualification: row.qualification,
    duration: row.duration,
    title: row.title,
    description: row.description,
    index: row.sort_index,
  }) as ProfessionalTimeline;

export const serializeProject = (row: Selectable<ProjectsTable>): CaseData =>
  compact({
    _id: row.id,
    title: row.title,
    description: row.description,
    imageSource: row.image_source,
    from: row.from_label,
    to: row.to_label,
    projectDetails: row.project_details,
  }) as CaseData;

export const serializePursuit = (row: Selectable<PursuitsTable>): Pursuit => ({
  _id: row.id,
  title: row.title,
  description: row.description,
  leftImageSource: row.left_image_source,
  rightImageSource: row.right_image_source,
});

export const serializeSocialLink = (
  row: Selectable<SocialLinksTable>,
): SocailMediaLink => ({
  _id: row.id,
  name: row.name as SocailMediaLink['name'],
  link: row.link,
});
