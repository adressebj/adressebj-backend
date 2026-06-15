import { ApiProperty } from '@nestjs/swagger';
import { AddressCategory } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';

/**
 * Modification d'adresse : soumet une nouvelle version de contenu (révision).
 * Le GPS n'est PAS modifiable — la localisation est figée par son premier
 * créateur ; déplacer une adresse reviendrait à en créer une autre.
 */
export class UpdateAddressDto {
  @ApiProperty({ enum: AddressCategory })
  @IsEnum(AddressCategory)
  category!: AddressCategory;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Au moins une étape est requise.' })
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 280, { each: true })
  steps!: string[];

  @ApiProperty({ example: 'https://res.cloudinary.com/.../photo.jpg' })
  @IsUrl(
    { require_protocol: true },
    { message: 'photoUrl doit être une URL valide.' },
  )
  photoUrl!: string;
}
