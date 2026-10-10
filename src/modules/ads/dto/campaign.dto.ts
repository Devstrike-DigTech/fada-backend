import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AdCampaignStatus, DrugType } from '@prisma/client';
import { PaginationDto } from '@common/dto/pagination.dto';
import { AD_LIMITS } from '../ad-pricing';

export class CreateCampaignDto {
  @ApiProperty({ example: 'Buy 2 Panadol Extra, get 1 free this weekend' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ example: 'Valid at our Ikeja branch only' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  subtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'Why this offer?' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  specialPointsTitle?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Genuine NAFDAC-registered stock'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  specialPoints?: string[];

  @ApiPropertyOptional({
    description: 'Drug being promoted (must belong to this pharmacy)',
  })
  @IsOptional()
  @IsUUID()
  drugId?: string;

  @ApiPropertyOptional({
    enum: ['oral', 'infusion', 'injectable', 'antiseptic', 'other'],
  })
  @IsOptional()
  @IsEnum(['oral', 'infusion', 'injectable', 'antiseptic', 'other'])
  drugTypeFilter?: DrugType;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(AD_LIMITS.targetRadiusKm.min)
  @Max(AD_LIMITS.targetRadiusKm.max)
  targetRadiusKm?: number;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  targetState?: string;

  @ApiProperty({
    example: '2026-11-01T00:00:00Z',
    description: 'When the campaign should start',
  })
  @IsDateString()
  startAt: string;

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: 24,
    description: 'Impressions per viewer per day',
  })
  @Type(() => Number)
  @IsInt()
  @Min(AD_LIMITS.dailyFrequency.min)
  @Max(AD_LIMITS.dailyFrequency.max)
  dailyFrequency: number;

  @ApiProperty({ example: 7, minimum: 1, maximum: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(AD_LIMITS.weeklyDays.min)
  @Max(AD_LIMITS.weeklyDays.max)
  weeklyDays: number;

  @ApiProperty({ example: 4, minimum: 1, maximum: 52 })
  @Type(() => Number)
  @IsInt()
  @Min(AD_LIMITS.durationWeeks.min)
  @Max(AD_LIMITS.durationWeeks.max)
  durationWeeks: number;

  @ApiPropertyOptional({
    example: 'XMAS25',
    description: 'Promo code (seasonal promos auto-apply)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  promoCode?: string;
}

export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {}

export class QuoteCampaignDto {
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(AD_LIMITS.dailyFrequency.min)
  @Max(AD_LIMITS.dailyFrequency.max)
  dailyFrequency: number;

  @ApiProperty({ example: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(AD_LIMITS.weeklyDays.min)
  @Max(AD_LIMITS.weeklyDays.max)
  weeklyDays: number;

  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(AD_LIMITS.durationWeeks.min)
  @Max(AD_LIMITS.durationWeeks.max)
  durationWeeks: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  promoCode?: string;
}

export class CampaignStatusActionDto {
  @ApiProperty({ enum: ['pause', 'resume', 'cancel'] })
  @IsIn(['pause', 'resume', 'cancel'])
  action: 'pause' | 'resume' | 'cancel';
}

export class CampaignCheckoutDto {
  @ApiPropertyOptional({ enum: ['paystack', 'flutterwave'] })
  @IsOptional()
  @IsIn(['paystack', 'flutterwave'])
  provider?: 'paystack' | 'flutterwave';

  @ApiPropertyOptional({ description: 'Promo code to (re)apply at checkout' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  promoCode?: string;
}

export class CampaignQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ['draft', 'active', 'paused', 'expired', 'cancelled'],
  })
  @IsOptional()
  @IsEnum(['draft', 'active', 'paused', 'expired', 'cancelled'])
  status?: AdCampaignStatus;
}

export class CampaignAnalyticsQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;
}
