import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/types/jwt-payload';
import {
  AddressesService,
  CreatedAddress,
  DeactivatedAddress,
  DiscoverableResult,
  MyAddress,
  RateResult,
  ReportResult,
  RevisionView,
  UpdatedAddress,
} from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { DiscoverableDto } from './dto/discoverable.dto';
import { RateAddressDto } from './dto/rate-address.dto';
import { ReportAddressDto } from './dto/report-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@ApiTags('addresses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.HABITANT)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Post()
  @ApiOperation({
    summary: "Création d'adresse (rattachement localisation auto)",
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAddressDto,
  ): Promise<CreatedAddress> {
    return this.addresses.create(user.id, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Mes adresses et leur état' })
  mine(@CurrentUser() user: AuthUser): Promise<MyAddress[]> {
    return this.addresses.listMine(user.id);
  }

  @Get(':code/revisions')
  @ApiOperation({ summary: 'Historique des versions de mon adresse' })
  revisions(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
  ): Promise<RevisionView[]> {
    return this.addresses.listRevisions(user.id, code);
  }

  @Post(':code/rate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Évaluer une adresse (1–5, upsert)' })
  rate(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: RateAddressDto,
  ): Promise<RateResult> {
    return this.addresses.rate(user.id, code, dto.stars);
  }

  @Post(':code/report')
  @ApiOperation({ summary: 'Signaler une adresse (file de modération)' })
  report(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: ReportAddressDto,
  ): Promise<ReportResult> {
    return this.addresses.report(user.id, code, dto.message);
  }

  @Patch(':code')
  @ApiOperation({ summary: 'Modifier une adresse (→ nouvelle révision)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<UpdatedAddress> {
    return this.addresses.update(user.id, code, dto);
  }

  @Patch(':code/discoverable')
  @ApiOperation({ summary: 'Basculer la découverte cartographique' })
  setDiscoverable(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: DiscoverableDto,
  ): Promise<DiscoverableResult> {
    return this.addresses.setDiscoverable(user.id, code, dto.discoverable);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Désactiver une adresse (propriétaire)' })
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
  ): Promise<DeactivatedAddress> {
    return this.addresses.deactivate(user.id, code);
  }
}
