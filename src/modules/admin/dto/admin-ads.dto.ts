import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AdCampaignStatus, AdReviewStatus } from '@prisma/client';
import { PaginationDto } from '@common/dto/pagination.dto';

export class AdminCampaignQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ['draft', 'active', 'paused', 'expired', 'cancelled'],
  })
  @IsOptional()
  @IsEnum(['draft', 'active', 'paused', 'expired', 'cancelled'])
  status?: AdCampaignStatus;

  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsEnum(['pending', 'approved', 'rejected'])
  reviewStatus?: AdReviewStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @ApiPropertyOptional({ description: 'Title or pharmacy name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AdminReviewCampaignDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @ApiPropertyOptional({ description: 'Required when rejecting' })
  @ValidateIf((o: AdminReviewCampaignDto) => o.decision === 'reject')
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason?: string;
}

export class AdminCampaignStatusDto {
  @ApiProperty({ enum: ['pause', 'resume', 'cancel'] })
  @IsIn(['pause', 'resume', 'cancel'])
  action: 'pause' | 'resume' | 'cancel';

  @ApiProperty({ example: 'Creative violates advertising guidelines' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
