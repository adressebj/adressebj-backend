import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { BENIN_PHONE_REGEX } from './request-otp.dto';

/**
 * Réinitialisation du mot de passe habitant par OTP : le numéro doit avoir reçu
 * un code via `POST /auth/password-reset/request` (preuve de possession). Le flux
 * est non-énumérant — un numéro inconnu et un OTP erroné renvoient la même erreur.
 */
export class ResetPasswordDto {
  @ApiProperty({ example: '+22997000000', description: 'Numéro béninois (+229…)' })
  @Matches(BENIN_PHONE_REGEX, {
    message:
      'Le numéro doit être au format béninois (+229 suivi de 8 à 10 chiffres).',
  })
  phone!: string;

  @ApiProperty({ example: '123456', description: 'Code OTP reçu par SMS' })
  @Matches(/^\d{6}$/, { message: 'Le code OTP doit comporter 6 chiffres.' })
  code!: string;

  @ApiProperty({ example: 'nouveaumotdepasse', minLength: 8 })
  @IsString()
  @MinLength(8, {
    message: 'Le mot de passe doit comporter au moins 8 caractères.',
  })
  @MaxLength(72, {
    message: 'Le mot de passe ne doit pas dépasser 72 caractères.',
  })
  password!: string;
}
