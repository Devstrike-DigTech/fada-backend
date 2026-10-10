import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillingInterval, SubscriptionStatus } from '@prisma/client';
import { PaginationDto } from '@common/dto/pagination.dto';

export class AdminSubscriptionQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ['active', 'past_due', 'cancelled', 'trialing', 'expired'],
  })
  @IsOptional()
  @IsEnum(['active', 'past_due', 'cancelled', 'trialing', 'expired'])
  status?: SubscriptionStatus;

  @ApiPropertyOptional({ description: 'Plan id or slug' })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ description: 'Pharmacy name, FADA id or email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AdminAssignPlanDto {
  @ApiProperty({ example: 'zuko', description: 'Plan id or slug' })
  @IsString()
  @IsNotEmpty()
  plan: string;

  @ApiPropertyOptional({
    enum: ['monthly', 'quarterly', 'annually'],
    default: 'monthly',
  })
  @IsOptional()
  @IsEnum(['monthly', 'quarterly', 'annually'])
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({
    description:
      'Override the period end (e.g. 6 months free for A-list stores)',
  })
  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @ApiProperty({ example: 'A-list waiting-list perk: 6 months Zuko free' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class AdminExtendPeriodDto {
  @ApiProperty({ example: 30, minimum: 1, maximum: 730 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  days: number;

  @ApiProperty({ example: 'Goodwill after payment outage' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class AdminCancelSubscriptionDto {
  @ApiProperty({ example: 'Chargeback received' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Drop to the free plan now instead of at period end',
  })
  @IsOptional()
  @IsBoolean()
  immediate?: boolean;
}
