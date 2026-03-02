import { Pool, QueryResultRow } from 'pg';

import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}
