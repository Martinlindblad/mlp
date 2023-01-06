import { ObjectId } from 'mongodb';

export interface AboutType {
  _id: ObjectId;
  title: string;
  info: string;
  name: string;
  surname: string;
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
