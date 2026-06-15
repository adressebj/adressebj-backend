import { ApiProperty } from '@nestjs/swagger';
import { IsInt } from 'class-validator';

/**
 * Évaluation d'une adresse (1..5). La borne 1–5 est vérifiée dans le service
 * pour renvoyer le code machine `INVALID_RATING` (cf. CdC §11) plutôt qu'un
 * 400 de validation générique ; le DTO ne garantit ici que le type entier.
 */
export class RateAddressDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  @IsInt({ message: 'stars doit être un entier.' })
  stars!: number;
}
