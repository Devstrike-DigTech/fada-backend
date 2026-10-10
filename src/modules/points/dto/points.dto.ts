import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PointsReason } from '@prisma/client';
import { PaginationDto } from '@common/dto/pagination.dto';

export class PointsHistoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: [
      'registration',
      'reservation_completed',
      'drug_added',
      'ad_launched',
      'profile_completed',
      'admin_adjustment',
      'other',
    ],
  })
  @IsOptional()
  @IsEnum([
    'registration',
    'reservation_completed',
    'drug_added',
    'ad_launched',
    'profile_completed',
    'admin_adjustment',
    'other',
  ])
  reason?: PointsReason;
}

export class LeaderboardQueryDto {
  @ApiPropertyOptional({ example: 'Enugu' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  state?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Back office manual credit / debit. Exactly one of userId / pharmacyId. */
export class AdminAdjustPointsDto {
  @ApiPropertyOptional({ description: 'Customer user id' })
  @ValidateIf((o: AdminAdjustPointsDto) => !o.pharmacyId)
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Pharmacy id' })
  @ValidateIf((o: AdminAdjustPointsDto) => !o.userId)
  @IsUUID()
  pharmacyId?: string;

  @ApiProperty({
    example: 100,
    description: 'Positive to credit, negative to debit',
  })
  @Type(() => Number)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  delta: number;

  @ApiProperty({ example: 'Goodwill after reservation dispute #RSV3AB9XY2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}
