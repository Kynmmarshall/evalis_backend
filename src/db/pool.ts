import { Pool } from 'pg';

import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

export async function query<T = unknown>(text: string, params: unknown[] = []) {
  const result = await pool.query<T>(text, params);
  return result.rows;
}
