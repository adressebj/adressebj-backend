import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadService, UploadSignature } from './upload.service';

@ApiTags('upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  @Post('signature')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Signature Cloudinary pour upload direct (frontend)',
  })
  signature(): UploadSignature {
    return this.upload.signature();
  }
}
