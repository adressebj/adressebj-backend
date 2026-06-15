import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Contribution terrain (texte libre). Le caractère non-vide est vérifié dans le
 * service pour renvoyer le code machine `CONTRIBUTION_MESSAGE_REQUIRED` (cf. CdC §11)
 * plutôt qu'un 400 de validation générique ; le DTO garantit type et longueur max.
 */
export class CreateContributionDto {
  @ApiProperty({
    maxLength: 1000,
    example: "Le portail a été repeint en vert, l'étoile a disparu.",
  })
  @IsString()
  @MaxLength(1000)
  message!: string;
}
