import { ObjectId } from 'mongodb';

export interface PersonalInfo {
  _id: ObjectId;
  title: string;
  info: string;
  name: string;
  surname: string;
  key: 'introduction' | 'about' | 'more' | 'japanese';
}
export interface CareerSummary {
  _id: ObjectId;
  occupationType: string;
  description: string;
  from: string;
  to: string;
  introduction: string;
  name: string;
  link: string;
}

export interface Interest {
  _id: ObjectId;
  title: string;
  content: string;
  type: 'japanese';
}
export interface InformationCard {
  _id: ObjectId;
  title: string;
  description: string;
  link: string;
  content: string;
  key: 'experience' | 'about' | 'contact';
  type: 'introdcution';
}

export const ProfessionalProfileKeys = {
  about: 'about',
  introduction: 'introduction',
  japanese: 'japanese',
} as const;

export interface ProfessionalProfileBase {
  _id: ObjectId;
  title: string;
  info: string;
  name: string;
  surname: string;
  key: keyof typeof ProfessionalProfileKeys;
}

export interface ProfessionalProfileAbout extends ProfessionalProfileBase {
  description: string[];
  imageSource: string;
  link: string;
  linkText: string;
  profileImage: string;
}

export interface ProfessionalProfileintroduction
  extends ProfessionalProfileBase {
  // Add specific properties for 'introduction'
}

export interface ProfessionalProfileContact extends ProfessionalProfileBase {
  // Add specific properties for 'Contact'
}

export interface ProfessionalProfileJapanese extends ProfessionalProfileBase {
  // Add specific properties for 'Japanese'
}

export interface ProfessionalProfileData {
  about: ProfessionalProfileAbout;
  introduction: ProfessionalProfileintroduction;
  japanese: ProfessionalProfileJapanese;
}

export interface ProfessionalProfileKeysType {
  [key: string]: keyof typeof ProfessionalProfileKeys;
}

export interface ProfessionalProfileDataByKey<
  T extends keyof typeof ProfessionalProfileKeys,
> {
  data: ProfessionalProfileData[T];
}
export interface SocailMediaLink {
  _id: ObjectId;
  name: 'Facebook' | 'Instagram' | 'LinkedIn' | 'Github';
  link: string;
}

export interface ProjectDetail {
  title: string;
  description: string;
}

export interface ProjectDetails {
  headline: string;
  description: string;
  videoID?: string;
  videoTitle?: string;
  videoDescription?: string;
  imageSources?: string[];
  roleDetails: string[];
  roleTitle: string;
  links?: {
    title: string;
    path: string;
  }[];
  details: ProjectDetail[];
}
export interface CaseData {
  _id: ObjectId;
  title: string;
  description: string;
  imageSource: string;
  from: string;
  to: string;
  projectDetails: ProjectDetails;
}

export interface CasePageProps {
  caseData: CaseData | null;
}
export interface Pursuit {
  _id: ObjectId;
  title: string;
  description: string;
  leftImageSource: string;
  rightImageSource: string;
}
export interface ProfessionalTimeline {
  _id: ObjectId;
  company?: string;
  institution?: string;
  qualification?: string;
  duration: string;
  title: string;
  description: string;
  index: number;
}

export type ProfessionalTimelineData = ProfessionalTimeline[];

export interface Language {
  _id: ObjectId;
  name: string;
  spoken: string;
  written: string;
}

export type Languages = Language[];
