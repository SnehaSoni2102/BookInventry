import { startTestDatabase } from './db-helper.js';

/** Starts (or connects to) a Postgres server once per run and exposes its admin URL to the workers. */
export default async function setup() {
  const { adminUrl, stop } = await startTestDatabase();
  process.env.TEST_ADMIN_URL = adminUrl;
  return async () => {
    await stop();
  };
}
