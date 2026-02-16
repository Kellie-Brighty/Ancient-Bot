import admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

function initializeFirebase() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!serviceAccountPath) {
    console.warn('FIREBASE_SERVICE_ACCOUNT_PATH not provided. Falling back to local/emulator or potential failure.');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    return admin.firestore();
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
    return null;
  }
}

export const db = initializeFirebase();
