import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restreint une route à un ou plusieurs rôles : `@Roles(Role.MODERATEUR, Role.ADMIN)`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
