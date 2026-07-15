import { sql, type Insertable, type Kysely } from 'kysely';
import { createDatabase } from '../../server/db/client';
import { loadDatabaseConfig } from '../../server/db/config';
import type { Database } from '../../server/db/database.types';
import { migrateToLatest } from '../../server/db/migrator';
import type { ProjectDetails } from '../../types/DBTypes';

const projectId = '64b000000000000000000009';
const projectDetails = {
  headline: 'Legacy portfolio case',
  description: 'A deterministic browser acceptance fixture.',
  videoID: '',
  videoTitle: '',
  videoDescription: '',
  imageSources: ['/images/cases/livsstilsverktyget.webp'],
  imagesSources: ['/images/cases/imaginecare.webp'],
  roleDetails: ['Frontend development'],
  roleTitle: 'Role',
  links: [{ title: 'Case', path: `/cases/${projectId}` }],
  details: [{ title: 'Result', description: 'Acceptance fixture ready.' }],
} satisfies ProjectDetails;

const profileSections = [
  {
    id: '64b000000000000000000001',
    source_order: 0,
    key: 'introduction',
    title: 'Portfolio introduction',
    info: 'Deterministic portfolio fixture',
    name: 'Portfolio',
    surname: 'Developer',
    description: ['Frontend development', 'Accessible product delivery'],
    image_source: '/images/developer.webp',
    link: '/contact',
    link_text: 'Contact',
    profile_image: '/images/profilepicture.webp',
  },
] satisfies Insertable<Database['profile_sections']>[];

const currentOccupations = [
  {
    id: '64b000000000000000000002',
    source_order: 0,
    title: 'Frontend developer',
    occupation_type: 'Portfolio',
    description: 'Builds reliable and accessible web experiences.',
    from_label: '2024',
    to_label: 'Present',
    introduction: 'A deterministic current occupation fixture.',
    name: 'Portfolio project',
    link: '/experience',
  },
] satisfies Insertable<Database['current_occupations']>[];

const hobbies = [
  {
    id: '64b000000000000000000003',
    source_order: 0,
    title: 'Language learning',
    content: 'Practising Japanese language and culture.',
    type: 'japanese',
  },
] satisfies Insertable<Database['hobbies']>[];

const languages = [
  {
    id: '64b000000000000000000004',
    source_order: 0,
    name: 'English',
    spoken: '5',
    written: '5',
  },
] satisfies Insertable<Database['languages']>[];

const pageCards = [
  {
    id: '64b000000000000000000005',
    source_order: 0,
    title: 'About the portfolio',
    description: 'Read about the work behind this portfolio.',
    link: '/about',
    content: 'A deterministic page-card fixture.',
    key: 'about',
    type: 'introdcution',
  },
] satisfies Insertable<Database['page_cards']>[];

const professionalTimeline = [
  {
    id: '64b000000000000000000006',
    source_order: 0,
    company: 'Portfolio project',
    institution: null,
    qualification: null,
    duration: '2024–Present',
    title: 'Frontend developer',
    description: 'Delivered a self-hosted portfolio platform.',
    sort_index: 0,
  },
] satisfies Insertable<Database['professional_timeline']>[];

const socialLinks = [
  {
    id: '64b000000000000000000007',
    source_order: 0,
    name: 'Github',
    link: 'https://example.invalid/portfolio',
  },
] satisfies Insertable<Database['social_links']>[];

const pursuits = [
  {
    id: '64b000000000000000000008',
    source_order: 0,
    title: 'Useful product experiences',
    description: 'Building accessible products with dependable operations.',
    left_image_source: '/images/laptop.webp',
    right_image_source: '/images/phone.webp',
  },
] satisfies Insertable<Database['pursuits']>[];

const projects = [
  {
    id: projectId,
    source_order: 0,
    title: 'Legacy Portfolio Case',
    description: 'The stable legacy case route for browser acceptance.',
    image_source: '/images/cases/libra.webp',
    from_label: '2024',
    to_label: 'Present',
    project_details: JSON.stringify(projectDetails),
  },
] satisfies Insertable<Database['projects']>[];

async function requireMigratorOwner(db: Kysely<Database>): Promise<void> {
  const identity = await sql<{
    current_user: string;
    database_owner: string;
  }>`
    select current_user, pg_get_userbyid(datdba) as database_owner
    from pg_database where datname = current_database()
  `.execute(db);
  const row = identity.rows[0];
  if (
    row?.current_user !== 'portfolio_migrator' ||
    row.database_owner !== 'portfolio_migrator'
  ) {
    throw new Error('Fixture database must be owned by portfolio_migrator');
  }
}

async function replaceFixtureContent(db: Kysely<Database>): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await sql`
      truncate table
        contact_messages,
        social_links,
        pursuits,
        projects,
        professional_timeline,
        page_cards,
        languages,
        hobbies,
        current_occupations,
        profile_sections
    `.execute(transaction);
    await transaction
      .insertInto('profile_sections')
      .values(profileSections)
      .execute();
    await transaction
      .insertInto('current_occupations')
      .values(currentOccupations)
      .execute();
    await transaction.insertInto('hobbies').values(hobbies).execute();
    await transaction.insertInto('languages').values(languages).execute();
    await transaction.insertInto('page_cards').values(pageCards).execute();
    await transaction
      .insertInto('professional_timeline')
      .values(professionalTimeline)
      .execute();
    await transaction.insertInto('projects').values(projects).execute();
    await transaction.insertInto('pursuits').values(pursuits).execute();
    await transaction.insertInto('social_links').values(socialLinks).execute();
  });
}

async function main(): Promise<void> {
  const config = loadDatabaseConfig(process.env);
  if (config.user !== 'portfolio_migrator') {
    throw new Error('Fixture seed requires portfolio_migrator');
  }
  const db = createDatabase(config);
  try {
    await requireMigratorOwner(db);
    await migrateToLatest(db);
    await replaceFixtureContent(db);
    process.stdout.write('PostgreSQL fixture seeded\n');
  } finally {
    await db.destroy();
  }
}

main().catch(() => {
  process.stderr.write('PostgreSQL fixture seed failed\n');
  process.exitCode = 1;
});
