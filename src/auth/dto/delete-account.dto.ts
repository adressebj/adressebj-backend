import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Suppression de compte : confirmation par le numéro. La correspondance avec le
 * compte connecté est vérifiée côté service (`PHONE_MISMATCH` sinon) — pas de
 * validation de format ici, pour ne pas masquer une non-correspondance derrière un 400 générique.
 */
export class DeleteAccountDto {
  @ApiProperty({
    example: '+22997000000',
    description: 'Numéro du compte (confirmation)',
  })
  @IsString()
  phone!: string;
}
