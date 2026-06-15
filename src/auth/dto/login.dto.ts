import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';
import { BENIN_PHONE_REGEX } from './request-otp.dto';

/**
 * Connexion : habitant via `{ phone, password }`, modérateur/admin via `{ email, password }`.
 * Exactement un identifiant (phone XOR email) — validé dans le service.
 */
export class LoginDto {
  @ApiPropertyOptional({ example: '+22997000000', description: 'Habitant' })
  @IsOptional()
  @Matches(BENIN_PHONE_REGEX, {
    message: 'Le numéro doit être au format béninois (+229 suivi de 8 à 10 chiffres).',
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'moderateur@example.com', description: 'Modérateur/Admin' })
  @IsOptional()
  @IsEmail({}, { message: 'Email invalide.' })
  email?: string;

  @ApiPropertyOptional({ example: 'motdepasse123' })
  @IsString()
  password!: string;
}
