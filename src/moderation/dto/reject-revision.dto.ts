import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RejectRevisionDto {
  @ApiProperty({
    description: 'Motif du rejet (obligatoire, notifié à l’auteur)',
  })
  @IsString()
  @Length(3, 500, {
    message: 'Le motif doit comporter entre 3 et 500 caractères.',
  })
  reason!: string;
}
