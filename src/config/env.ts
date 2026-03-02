import dotenv from 'dotenv';

dotenv.config();

const required = ['DATABASE_URL', 'JWT_SECRET'] as const;
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var ${key}`);
  }
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL as string,
  jwtSecret: process.env.JWT_SECRET as string,
  assetBaseUrl: process.env.ASSET_BASE_URL ?? '',
  lecturerAccessCode: (process.env.LECTURER_ACCESS_CODE ?? '').trim(),
};
