import fs from 'fs';
import path from 'path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { env } from '../config/env';

function initFirebase(): void {
  if (getApps().length > 0) return;

  // Emulator mode: no credentials needed (the Admin SDK reads FIRESTORE_EMULATOR_HOST itself).
  if (env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
    return;
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH (or FIRESTORE_EMULATOR_HOST) in .env');
  }

  const keyPath = path.resolve(env.FIREBASE_SERVICE_ACCOUNT_PATH);
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Firebase service account file not found at ${keyPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as Record<string, unknown>;
  initializeApp({
    credential: cert(serviceAccount),
    projectId: env.FIREBASE_PROJECT_ID,
  });
}

initFirebase();

export const firestore = getFirestore();
export { FieldValue, Timestamp };
