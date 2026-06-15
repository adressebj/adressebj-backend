import { Role } from '@prisma/client';

/** Charge utile signée dans le JWT. */
export interface JwtPayload {
  sub: string; // userId
  role: Role;
}

/** Utilisateur authentifié exposé par la stratégie (req.user). */
export interface AuthUser {
  id: string;
  role: Role;
}
