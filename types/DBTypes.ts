import { ObjectId, Timestamp } from 'mongodb';

export interface RestaurantResponseType {
  _id: ObjectId;
  address: {
    building: string;
    coord: number[];
    street: string;
    zipcode: string;
  };
  borough: string;
  cuisine: string;
  grades: [{ date: Timestamp; grade: string; score: number }];
  name: 'Riviera Caterer';
  restaurant_id: '40356018';
}
