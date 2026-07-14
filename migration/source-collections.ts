export const SOURCE_COLLECTIONS = {
  about: 'profile_sections',
  current_occupation: 'current_occupations',
  hobbys: 'hobbies',
  languages: 'languages',
  page_cards: 'page_cards',
  proffessional_timeline: 'professional_timeline',
  projects_and_cases: 'projects',
  pursuit: 'pursuits',
  social_media: 'social_links',
  contact: 'contact_messages',
} as const;

export type SourceCollection = keyof typeof SOURCE_COLLECTIONS;
export type ContentCollection = Exclude<SourceCollection, 'contact'>;

export const CONTENT_COLLECTIONS = Object.keys(SOURCE_COLLECTIONS).filter(
  (name): name is ContentCollection => name !== 'contact',
);
