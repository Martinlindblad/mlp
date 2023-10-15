import { ObjectId } from 'mongodb';

export interface AboutType {
  _id: ObjectId;
  title: string;
  info: string;
  name: string;
  surname: string;
  key: 'introduction' | 'about' | 'more' | 'japanese';
}
export interface IntroductionType {
  _id: ObjectId;
  occupationType: string;
  description: string;
  from: string;
  to: string;
  introduction: string;
  name: string;
  link: string;
}

export interface HobbyType {
  _id: ObjectId;
  title: string;
  content: string;
  type: 'japanese';
}
export interface PageCardType {
  _id: ObjectId;
  title: string;
  description: string;
  link: string;
  content: string;
  key: 'experience' | 'about' | 'contact';
  type: 'introdcution';
}
export interface SocailMediaLink {
  _id: ObjectId;
  name: 'Facebook' | 'Instagram' | 'LinkedIn' | 'Github';
  link: string;
}
export interface ProjectsAndCases {
  _id: ObjectId;
  title: string;
  description: string;
  imageSource: string;
}
