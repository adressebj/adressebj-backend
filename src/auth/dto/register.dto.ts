import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BENIN_PHONE_REGEX } from './request-otp.dto';

export class RegisterDto {
  @ApiProperty({ example: '+22997000000' })
  @Matches(BENIN_PHONE_REGEX, {
    message: 'Le numéro doit être au format béninois (+229 suivi de 8 à 10 chiffres).',
  })
  phone!: string;

  @ApiProperty({ example: '123456', description: 'Code OTP reçu par SMS' })
  @Matches(/^\d{6}$/, { message: 'Le code OTP doit comporter 6 chiffres.' })
  code!: string;

  @ApiProperty({ example: 'habitant@example.com' })
  @IsEmail({}, { message: 'Email invalide.' })
  email!: string;

  @ApiProperty({ example: 'motdepasse123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit comporter au moins 8 caractères.' })
  @MaxLength(72, { message: 'Le mot de passe ne doit pas dépasser 72 caractères.' })
  password!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  lastName?: string;
}
