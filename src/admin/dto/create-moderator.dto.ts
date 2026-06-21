import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Création d'un compte Modérateur (admin). */
export class CreateModeratorDto {
  @ApiProperty({ example: 'moderateur@adressebj.bj' })
  @IsEmail({}, { message: 'Email invalide.' })
  email!: string;

  @ApiProperty({ example: 'motdepasse123', minLength: 8 })
  @IsString()
  @MinLength(8, {
    message: 'Le mot de passe doit comporter au moins 8 caractères.',
  })
  @MaxLength(72, {
    message: 'Le mot de passe ne doit pas dépasser 72 caractères.',
  })
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  lastName?: string;
}
