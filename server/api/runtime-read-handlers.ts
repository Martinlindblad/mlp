import { getDatabase } from '../db/client';
import { createContentRepository } from '../repositories/content-repository';
import { createProjectRepository } from '../repositories/project-repository';
import { createReadHandler } from './read-handler';
import {
  serializeCurrentOccupation,
  serializeHobby,
  serializeLanguage,
  serializePageCard,
  serializeProfileSection,
  serializeProject,
  serializePursuit,
  serializeSocialLink,
  serializeTimeline,
} from './serializers';

const content = () => createContentRepository(getDatabase());
const projects = () => createProjectRepository(getDatabase());

export const aboutHandler = createReadHandler(async () =>
  (await content().findProfileSections()).map(serializeProfileSection),
);
export const introductionHandler = createReadHandler(async () =>
  (await content().findIntroduction()).map(serializeProfileSection),
);
export const currentOccupationHandler = createReadHandler(async () =>
  (await content().findCurrentOccupations()).map(serializeCurrentOccupation),
);
export const languagesHandler = createReadHandler(async () =>
  (await content().findLanguages()).map(serializeLanguage),
);
export const hobbiesHandler = createReadHandler(async () =>
  (await content().findHobbies()).map(serializeHobby),
);
export const pageCardsHandler = createReadHandler(async () =>
  (await content().findPageCards()).map(serializePageCard),
);
export const timelineHandler = createReadHandler(async () =>
  (await content().findTimeline()).map(serializeTimeline),
);
export const projectsHandler = createReadHandler(async () =>
  (await projects().list()).map(serializeProject),
);
export const pursuitHandler = createReadHandler(async () =>
  (await content().findPursuits()).map(serializePursuit),
);
export const socialMediaHandler = createReadHandler(async () =>
  (await content().findSocialLinks()).map(serializeSocialLink),
);
