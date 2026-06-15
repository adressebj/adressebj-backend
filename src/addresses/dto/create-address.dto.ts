import { ApiProperty } from '@nestjs/swagger';
import { AddressCategory } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * Création d'adresse. NB : `localisationId` n'est JAMAIS accepté du client —
 * il est résolu côté serveur depuis le GPS (faille de modèle sinon, cf. CdC §16).
 */
export class CreateAddressDto {
  @ApiProperty({ enum: AddressCategory })
  @IsEnum(AddressCategory)
  category!: AddressCategory;

  @ApiProperty({
    type: [String],
    description: "Étapes d'accès (assemblées côté serveur)",
  })
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

  @ApiProperty({ example: 6.3662 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  gpsLat!: number;

  @ApiProperty({ example: 2.3912 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  gpsLng!: number;
}
