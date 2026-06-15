import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../types/jwt-payload';

/**
 * Contrôle le rôle de l'utilisateur authentifié. À utiliser APRÈS JwtAuthGuard :
 * `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }
    const user = context.switchToHttp().getRequest<Request>().user as
      | AuthUser
      | undefined;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: 'Droits insuffisants pour cette action.',
      });
    }
    return true;
  }
}
