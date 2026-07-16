import { ObjectId } from 'mongodb';
import { z, type ZodIssue } from 'zod';
import { MigrationValidationError, type MigrationIssue } from './errors';
import type { SourceCollection } from './source-collections';

const objectId = z.custom<ObjectId>(
  (value) => value instanceof ObjectId && ObjectId.isValid(value),
  'valid ObjectId required',
);

const base = { _id: objectId };
const legacyInteger = z.preprocess((value) => {
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    return Number(value);
  }
  return value;
}, z.number().int());

const projectLinkSchema = z
  .object({ title: z.string(), path: z.string() })
  .strict();
const projectDetailSchema = z
  .object({ title: z.string(), description: z.string() })
  .strict();

export const projectDetailsSchema = z
  .object({
    headline: z.string(),
    description: z.string(),
    videoID: z.string().optional(),
    videoTitle: z.string().optional(),
    videoDescription: z.string().optional(),
    imageSources: z.array(z.string()).optional(),
    imagesSources: z.array(z.string()).optional(),
    roleDetails: z.array(z.string()),
    roleTitle: z.string(),
    links: z.array(projectLinkSchema).optional(),
    details: z.array(projectDetailSchema),
  })
  .strict();

const aboutSchema = z
  .object({
    ...base,
    title: z.string(),
    info: z.string(),
    name: z.string(),
    surname: z.string(),
    key: z.enum(['introduction', 'about', 'more', 'japanese']),
    description: z.array(z.string()).optional(),
    imageSource: z.string().optional(),
    link: z.string().optional(),
    linkText: z.string().optional(),
    profileImage: z.string().optional(),
  })
  .strict();

const currentOccupationSchema = z
  .object({
    ...base,
    title: z.string(),
    occupationType: z.string(),
    description: z.string(),
    from: z.string(),
    to: z.string(),
    introduction: z.string(),
    name: z.string(),
    link: z.string(),
  })
  .strict();

const hobbySchema = z
  .object({
    ...base,
    title: z.string(),
    content: z.string(),
    type: z.literal('japanese'),
  })
  .strict();

const languageSchema = z
  .object({
    ...base,
    name: z.string(),
    spoken: z.string(),
    written: z.string(),
  })
  .strict();

const pageCardSchema = z
  .object({
    ...base,
    title: z.string(),
    description: z.string(),
    link: z.string(),
    content: z.string().optional(),
    key: z.enum(['experience', 'about', 'contact']),
    type: z.literal('introdcution'),
  })
  .strict();

const timelineSchema = z
  .object({
    ...base,
    company: z.string().optional(),
    institution: z.string().optional(),
    qualification: z.string().optional(),
    duration: z.string(),
    title: z.string(),
    description: z.string(),
    index: legacyInteger,
  })
  .strict();

const projectSchema = z
  .object({
    ...base,
    title: z.string(),
    description: z.string(),
    imageSource: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
    projectDetails: projectDetailsSchema,
  })
  .strict();

const pursuitSchema = z
  .object({
    ...base,
    title: z.string(),
    description: z.string(),
    leftImageSource: z.string(),
    rightImageSource: z.string(),
  })
  .strict();

const socialMediaSchema = z
  .object({
    ...base,
    name: z.enum(['Facebook', 'Instagram', 'LinkedIn', 'Github']),
    link: z.string(),
  })
  .strict();

const contactFullNameSchema = z
  .object({
    ...base,
    fullName: z.string(),
    email: z.string(),
    subject: z.string(),
    message: z.string(),
    date: z.date(),
  })
  .strict();

const contactFullnameSchema = z
  .object({
    ...base,
    fullname: z.string(),
    email: z.string(),
    subject: z.string(),
    message: z.string(),
    date: z.date(),
  })
  .strict();

const contactSchema = z.union([contactFullNameSchema, contactFullnameSchema]);

const schemas = {
  about: aboutSchema,
  current_occupation: currentOccupationSchema,
  hobbys: hobbySchema,
  languages: languageSchema,
  page_cards: pageCardSchema,
  proffessional_timeline: timelineSchema,
  projects_and_cases: projectSchema,
  pursuit: pursuitSchema,
  social_media: socialMediaSchema,
  contact: contactSchema,
} as const satisfies Record<SourceCollection, z.ZodType>;

const allowedKeys = {
  about: new Set(Object.keys(aboutSchema.shape)),
  current_occupation: new Set(Object.keys(currentOccupationSchema.shape)),
  hobbys: new Set(Object.keys(hobbySchema.shape)),
  languages: new Set(Object.keys(languageSchema.shape)),
  page_cards: new Set(Object.keys(pageCardSchema.shape)),
  proffessional_timeline: new Set(Object.keys(timelineSchema.shape)),
  projects_and_cases: new Set(Object.keys(projectSchema.shape)),
  pursuit: new Set(Object.keys(pursuitSchema.shape)),
  social_media: new Set(Object.keys(socialMediaSchema.shape)),
  contact: new Set([
    ...Object.keys(contactFullNameSchema.shape),
    ...Object.keys(contactFullnameSchema.shape),
  ]),
} satisfies Record<SourceCollection, ReadonlySet<string>>;

export type SourceDocument<K extends SourceCollection> = z.infer<
  (typeof schemas)[K]
>;

function trustedSourceId(input: unknown): string {
  if (!input || typeof input !== 'object') return 'unknown';
  const candidate = (input as Record<string, unknown>)._id;
  return candidate instanceof ObjectId && ObjectId.isValid(candidate)
    ? candidate.toHexString()
    : 'unknown';
}

function structuralPath(path: ZodIssue['path']): string {
  if (path.length === 0) return '$';
  return path
    .map((segment) =>
      typeof segment === 'symbol' ? '<symbol>' : String(segment),
    )
    .join('.');
}

function redactIssue(
  collection: SourceCollection,
  id: string,
  issue: ZodIssue,
): MigrationIssue {
  const basePath = structuralPath(issue.path);
  if (issue.code === 'unrecognized_keys') {
    return {
      collection,
      id,
      code: 'unknown_field',
      path: basePath === '$' ? '<unknown>' : `${basePath}.<unknown>`,
    };
  }
  return {
    collection,
    id,
    code: 'invalid_value',
    path: basePath,
  };
}

function leafIssues(issue: ZodIssue): ZodIssue[] {
  if (issue.code !== 'invalid_union') return [issue];
  return issue.errors.flatMap((branch) => branch.flatMap(leafIssues));
}

function uniqueIssues(issues: readonly MigrationIssue[]): MigrationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const identity = `${issue.code}:${issue.path}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function parseSourceDocument<K extends SourceCollection>(
  collection: K,
  input: unknown,
): SourceDocument<K> {
  const result = schemas[collection].safeParse(input);
  if (!result.success) {
    const id = trustedSourceId(input);
    throw new MigrationValidationError(
      uniqueIssues(
        result.error.issues
          .flatMap(leafIssues)
          .map((issue) => redactIssue(collection, id, issue)),
      ),
    );
  }
  return result.data as SourceDocument<K>;
}

export function allowedSourceKeys(
  collection: SourceCollection,
): ReadonlySet<string> {
  return allowedKeys[collection];
}
