import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BillingInterval,
  PromotionDiscountType,
  PromotionScope,
} from '@prisma/client';

export class CreatePromotionDto {
  @ApiProperty({
    example: 'XMAS25',
    description: 'Uppercase letters/digits, 3–20 chars',
  })
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,20}$/, {
    message: 'code must be 3–20 uppercase letters, digits, _ or -',
  })
  code: string;

  @ApiProperty({ example: 'Christmas 2026 — 25% off all plans' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: ['percentage', 'fixed_amount'] })
  @IsEnum(['percentage', 'fixed_amount'])
  discountType: PromotionDiscountType;

  @ApiProperty({ example: 25, description: 'Percent (0–100) or ₦ amount' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountValue: number;

  @ApiPropertyOptional({
    example: 5000,
    description: 'Cap in ₦ for percentage promos',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxDiscountNgn?: number;

  @ApiPropertyOptional({
    enum: ['subscriptions', 'ads', 'both'],
    default: 'both',
  })
  @IsOptional()
  @IsEnum(['subscriptions', 'ads', 'both'])
  appliesTo?: PromotionScope;

  @ApiPropertyOptional({
    type: [String],
    description: 'Plan ids or slugs; empty = all plans',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  plans?: string[];

  @ApiPropertyOptional({
    type: [String],
    enum: ['monthly', 'quarterly', 'annually'],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(['monthly', 'quarterly', 'annually'], { each: true })
  billingIntervals?: BillingInterval[];

  @ApiProperty({ example: '2026-12-01T00:00:00Z' })
  @IsDateString()
  startsAt: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Seasonal promos apply without a code',
  })
  @IsOptional()
  @IsBoolean()
  autoApply?: boolean;

  @ApiPropertyOptional({
    description: 'Total redemptions allowed; null = unlimited',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptionsPerPharmacy?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {}

export class PromotionQueryDto {
  @ApiPropertyOptional({ enum: ['subscriptions', 'ads', 'both'] })
  @IsOptional()
  @IsEnum(['subscriptions', 'ads', 'both'])
  appliesTo?: PromotionScope;

  @ApiPropertyOptional({ description: 'true = only promos live right now' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  live?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}
