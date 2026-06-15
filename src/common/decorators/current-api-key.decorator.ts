import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiKey } from '@prisma/client';
import { ApiKeyRequest } from '../../api-keys/api-key-request';

/** Injecte la clé API validée (req.apiKey) : `@CurrentApiKey() key: ApiKey`. */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKey => {
    return ctx.switchToHttp().getRequest<ApiKeyRequest>().apiKey as ApiKey;
  },
);
