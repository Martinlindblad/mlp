import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('profile_sections')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('key', 'text', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('info', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('surname', 'text', (column) => column.notNull())
    .addColumn('description', sql`text[]`)
    .addColumn('image_source', 'text')
    .addColumn('link', 'text')
    .addColumn('link_text', 'text')
    .addColumn('profile_image', 'text')
    .execute();

  await db.schema
    .createTable('current_occupations')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('occupation_type', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('from_label', 'text', (column) => column.notNull())
    .addColumn('to_label', 'text', (column) => column.notNull())
    .addColumn('introduction', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('link', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('hobbies')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('content', 'text', (column) => column.notNull())
    .addColumn('type', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('languages')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('spoken', 'text', (column) => column.notNull())
    .addColumn('written', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('page_cards')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('link', 'text', (column) => column.notNull())
    .addColumn('content', 'text')
    .addColumn('key', 'text', (column) => column.notNull())
    .addColumn('type', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('professional_timeline')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('company', 'text')
    .addColumn('institution', 'text')
    .addColumn('qualification', 'text')
    .addColumn('duration', 'text', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('sort_index', 'integer', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('projects')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('image_source', 'text', (column) => column.notNull())
    .addColumn('from_label', 'text')
    .addColumn('to_label', 'text')
    .addColumn('project_details', 'jsonb', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('pursuits')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('left_image_source', 'text', (column) => column.notNull())
    .addColumn('right_image_source', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('social_links')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('link', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('contact_messages')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('full_name', 'text', (column) => column.notNull())
    .addColumn('email', 'text', (column) => column.notNull())
    .addColumn('subject', 'text', (column) => column.notNull())
    .addColumn('message', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .execute();

  await db.schema
    .createIndex('profile_sections_key_idx')
    .on('profile_sections')
    .column('key')
    .execute();
  await db.schema
    .createIndex('professional_timeline_sort_index_idx')
    .on('professional_timeline')
    .column('sort_index')
    .execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  for (const table of [
    'contact_messages',
    'social_links',
    'pursuits',
    'projects',
    'professional_timeline',
    'page_cards',
    'languages',
    'hobbies',
    'current_occupations',
    'profile_sections',
  ] as const) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
