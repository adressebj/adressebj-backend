import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyRequest } from './api-key-request';
import { API_KEY_PREFIX, ApiKeysService } from './api-keys.service';

/**
 * Garde des endpoints intégrateurs (`/resolve`, `/verify`, `/eta`, …).
 * Attend `Authorization: Bearer bj_live_xxxxxxxxxxxxxxxx`, valide la clé puis
 * l'attache à la requête (`req.apiKey`) pour les décorateurs aval.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'API_KEY_MISSING',
        message: 'Clé API requise (header Authorization: Bearer).',
      });
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token.startsWith(API_KEY_PREFIX)) {
      throw new UnauthorizedException({
        code: 'API_KEY_INVALID',
        message: 'Clé API invalide.',
      });
    }
    request.apiKey = await this.apiKeys.validate(token);
    return true;
  }
}
