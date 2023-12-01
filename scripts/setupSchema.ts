/* eslint-disable no-underscore-dangle */

import { connectToDatabase } from 'src/lib/mongodb';

async function setupSchema() {
  try {
    const { database, mongoClient } = await connectToDatabase();

    try {
      await database.command({
        collMod: 'contact',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['fullname', 'email', 'subject', 'message'],
            properties: {
              fullname: {
                bsonType: 'string',
                description: 'must be a string and is required',
                minLength: 2,
                maxLength: 50,
              },
              email: {
                bsonType: 'string',
                pattern: '^[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}$',
                description:
                  'must be a string and match the regular expression pattern',
              },
              subject: {
                bsonType: 'string',
                description: 'must be a string and is required',
              },
              message: {
                bsonType: 'string',
                description: 'must be a string and is required',
              },
              date: {
                bsonType: 'date',
                description:
                  'must be a date, default is the current date and time',
              },
            },
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      });

      console.log('Schema validation set up successfully');
    } catch (error) {
      console.error('Error setting up schema validation:', error);
    } finally {
      await mongoClient.close();
    }
  } catch (error) {
    console.error(error);
  }
}

void setupSchema();
