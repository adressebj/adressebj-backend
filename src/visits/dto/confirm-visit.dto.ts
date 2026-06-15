import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

/**
 * Confirmation d'arrivée. Deux modes selon la présence d'une clé API :
 *  - **web** (sans clé) : `visitId` + `arrivedAt` ;
 *  - **API** (clé `bj_live_…`) : `addressCode` + `departAt` + `arrivedAt` (+ `finalPrice`).
 * Les champs requis par mode sont vérifiés dans le service.
 */
export class ConfirmVisitDto {
  @ApiPropertyOptional({
    description: 'Mode web : id de la visite à confirmer.',
  })
  @IsOptional()
  @IsString()
  visitId?: string;

  @ApiPropertyOptional({ description: 'Mode API : code de l’adresse visitée.' })
  @IsOptional()
  @IsString()
  @Length(3, 20)
  addressCode?: string;

  @ApiPropertyOptional({ description: 'Mode API : horodatage de départ.' })
  @IsOptional()
  @IsISO8601()
  departAt?: string;

  @ApiPropertyOptional({ example: '2026-05-17T09:14:00Z' })
  @IsISO8601()
  arrivedAt!: string;

  @ApiPropertyOptional({ description: 'Mode API : prix final de la course.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  finalPrice?: number;
}
