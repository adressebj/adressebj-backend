import { ApiKey } from '@prisma/client';
import { Request } from 'express';

/** Requête enrichie par `ApiKeyGuard` une fois la clé validée. */
export type ApiKeyRequest = Request & { apiKey?: ApiKey };
