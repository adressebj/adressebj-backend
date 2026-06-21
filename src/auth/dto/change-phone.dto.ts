import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { BENIN_PHONE_REGEX } from './request-otp.dto';

/**
 * Changement de numéro : le nouveau numéro doit avoir été vérifié au préalable
 * via `POST /auth/request-otp` (preuve de possession). Le mot de passe n'est pas touché.
 */
export class ChangePhoneDto {
  @ApiProperty({
    example: '+22997000001',
    description: 'Nouveau numéro béninois',
  })
  @Matches(BENIN_PHONE_REGEX, {
    message:
      'Le numéro doit être au format béninois (+229 suivi de 8 à 10 chiffres).',
  })
  phone!: string;

  @ApiProperty({
    example: '123456',
    description: 'Code OTP reçu sur le nouveau numéro',
  })
  @Matches(/^\d{6}$/, { message: 'Le code OTP doit comporter 6 chiffres.' })
  code!: string;
}
