import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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
  MyAddress,
} from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';

@ApiTags('addresses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.HABITANT)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Post()
  @ApiOperation({ summary: "Création d'adresse (rattachement localisation auto)" })
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
}
