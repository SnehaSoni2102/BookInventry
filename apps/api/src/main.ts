import 'reflect-metadata';
import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { createApp } from './app.js';

const env = loadEnv();
const app = await createApp();
await app.listen(env.PORT, '0.0.0.0');
