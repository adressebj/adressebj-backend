import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

/** Modification du profil habitant : champs tous optionnels (mise à jour partielle). */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Awa' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Bello' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  lastName?: string;

  @ApiPropertyOptional({ example: 'nouveau@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Email invalide.' })
  email?: string;
}
