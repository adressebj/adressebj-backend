import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/** Numéro béninois au format E.164 : +229 suivi de 8 à 10 chiffres. */
export const BENIN_PHONE_REGEX = /^\+229\d{8,10}$/;

export class RequestOtpDto {
  @ApiProperty({
    example: '+22997000000',
    description: 'Numéro béninois (+229…)',
  })
  @Matches(BENIN_PHONE_REGEX, {
    message:
      'Le numéro doit être au format béninois (+229 suivi de 8 à 10 chiffres).',
  })
  phone!: string;
}
