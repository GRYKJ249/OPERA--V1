import { openDb } from '../server/db.ts';

const db = openDb();
try {
  await db.query('CREATE SCHEMA IF NOT EXISTS gitea');
  console.log('Gitea schema is ready in the existing PostgreSQL database.');
} finally {
  await db.close();
}