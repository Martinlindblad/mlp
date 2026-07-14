import type { Insertable } from 'kysely';
import type { Database } from '../server/db/database.types';
import type { SourceCollection } from './source-collections';
import type { SourceDocument } from './source-schemas';

interface DestinationMap {
  about: Insertable<Database['profile_sections']>;
  current_occupation: Insertable<Database['current_occupations']>;
  hobbys: Insertable<Database['hobbies']>;
  languages: Insertable<Database['languages']>;
  page_cards: Insertable<Database['page_cards']>;
  proffessional_timeline: Insertable<Database['professional_timeline']>;
  projects_and_cases: Insertable<Database['projects']>;
  pursuit: Insertable<Database['pursuits']>;
  social_media: Insertable<Database['social_links']>;
  contact: Insertable<Database['contact_messages']>;
}

export type DestinationInsert<K extends SourceCollection> = DestinationMap[K];

type Mapper<K extends SourceCollection> = (
  document: SourceDocument<K>,
  sourceOrder: number,
) => DestinationInsert<K>;

const mappers = {
  about: (document, sourceOrder) => ({
    id: document._id.toHexString(),
    source_order: sourceOrder,
    key: document.key,
    title: document.title,
    info: document.info,
    name: document.name,
    surname: document.surname,
    description: document.description ?? null,
    image_source: document.imageSource ?? null,
    link: document.link ?? null,
    link_text: document.linkText ?? null,
    profile_image: document.profileImage ?? null,
  }),
  current_occupation: (document, sourceOrder) => ({
    id: document._id.toHexString(),
    source_order: sourceOrder,
    title: document.title,
    occupation_type: document.occupationType,
    description: document.description,
    from_label: document.from,
    to_label: document.to,
    introduction: document.introduction,
    name: document.name,
    link: document.link,
  }),
  hobbys: (document, sourceOrder) => ({
    id: document._id.toHexString(),
    source_order: sourceOrder,
    title: document.title,
    content: document.content,
    type: document.type,
  }),
  languages: (document, sourceOrder) => ({
    id: document._id.toHexString(),
    source_order: sourceOrder,
    name: document.name,
    spoken: document.spoken,
    written: document.written,
  }),
  page_cards: (document, sourceOrder) => ({
    id: document._id.toHexString(),
    source_order: sourceOrder,
    title: document.title,
    description: document.description,
    link: document.link,
    content: document.content ?? null,
    key: document.key,
    type: document.type,
  }),
  proffessional_timeline: (document, sourceOrder) => ({
    id: document._id.toHexString(),
    source_order: sourceOrder,
    company: document.company ?? null,
    institution: document.institution ?? null,
    qualification: document.qualification ?? null,
    duration: document.duration,
    title: document.title,
    description: document.description,
    sort_index: document.index,
  }),
  projects_and_cases: (document, sourceOrder) => ({
    id: document._id.toHexString(),
    source_order: sourceOrder,
    title: document.title,
    description: document.description,
    image_source: document.imageSource,
    from_label: document.from ?? null,
    to_label: document.to ?? null,
    project_details: JSON.stringify(document.projectDetails),
  }),
  pursuit: (document, sourceOrder) => ({
    id: document._id.toHexString(),
    source_order: sourceOrder,
    title: document.title,
    description: document.description,
    left_image_source: document.leftImageSource,
    right_image_source: document.rightImageSource,
  }),
  social_media: (document, sourceOrder) => ({
    id: document._id.toHexString(),
    source_order: sourceOrder,
    name: document.name,
    link: document.link,
  }),
  contact: (document) => ({
    id: document._id.toHexString(),
    full_name: 'fullName' in document ? document.fullName : document.fullname,
    email: document.email,
    subject: document.subject,
    message: document.message,
    created_at: document.date,
  }),
} satisfies { [K in SourceCollection]: Mapper<K> };

export function mapSourceDocument(
  collection: 'about',
  document: SourceDocument<'about'>,
  sourceOrder: number,
): DestinationInsert<'about'>;
export function mapSourceDocument(
  collection: 'current_occupation',
  document: SourceDocument<'current_occupation'>,
  sourceOrder: number,
): DestinationInsert<'current_occupation'>;
export function mapSourceDocument(
  collection: 'hobbys',
  document: SourceDocument<'hobbys'>,
  sourceOrder: number,
): DestinationInsert<'hobbys'>;
export function mapSourceDocument(
  collection: 'languages',
  document: SourceDocument<'languages'>,
  sourceOrder: number,
): DestinationInsert<'languages'>;
export function mapSourceDocument(
  collection: 'page_cards',
  document: SourceDocument<'page_cards'>,
  sourceOrder: number,
): DestinationInsert<'page_cards'>;
export function mapSourceDocument(
  collection: 'proffessional_timeline',
  document: SourceDocument<'proffessional_timeline'>,
  sourceOrder: number,
): DestinationInsert<'proffessional_timeline'>;
export function mapSourceDocument(
  collection: 'projects_and_cases',
  document: SourceDocument<'projects_and_cases'>,
  sourceOrder: number,
): DestinationInsert<'projects_and_cases'>;
export function mapSourceDocument(
  collection: 'pursuit',
  document: SourceDocument<'pursuit'>,
  sourceOrder: number,
): DestinationInsert<'pursuit'>;
export function mapSourceDocument(
  collection: 'social_media',
  document: SourceDocument<'social_media'>,
  sourceOrder: number,
): DestinationInsert<'social_media'>;
export function mapSourceDocument(
  collection: 'contact',
  document: SourceDocument<'contact'>,
  sourceOrder: number,
): DestinationInsert<'contact'>;
export function mapSourceDocument<K extends SourceCollection>(
  collection: K,
  document: SourceDocument<K>,
  sourceOrder: number,
): DestinationInsert<K>;
export function mapSourceDocument<K extends SourceCollection>(
  collection: K,
  document: SourceDocument<K>,
  sourceOrder: number,
): DestinationInsert<K> {
  const mapper = mappers[collection] as unknown as Mapper<K>;
  return mapper(document, sourceOrder);
}
