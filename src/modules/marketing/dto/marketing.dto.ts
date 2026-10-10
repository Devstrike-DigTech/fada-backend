import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';

export const PROSPECT_STAGES = ['to_call', 'to_visit', 'visited'] as const;
export type ProspectStageValue = (typeof PROSPECT_STAGES)[number];
export const STORE_TYPES = ['small', 'medium', 'large', 'hospital'] as const;
export type StoreTypeValue = (typeof STORE_TYPES)[number];
export const RESPONSES = ['positive', 'neutral', 'negative'] as const;
export type ResponseValue = (typeof RESPONSES)[number];

const PHONE = /^\+?[0-9 ()-]{10,20}$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === ''
    ? undefined
    : trim({ value });
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

// ─── Prospects ─────────────────────────────────────────────────────────────────

export class CreateProspectDto {
  @ApiProperty({ example: 'HealthPlus Pharmacy, Ogui Road' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name: string;

  @ApiProperty({ example: '08031234567' })
  @Transform(trim)
  @Matches(PHONE, { message: 'Enter a valid phone number' })
  phone: string;

  @ApiPropertyOptional({ example: 'info@healthplus.ng' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @ApiProperty({ example: '12 Ogui Road, Enugu' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  address: string;

  @ApiProperty({ description: 'Sales route the pharmacy sits on' })
  @IsUUID()
  routeId: string;

  @ApiPropertyOptional({ enum: STORE_TYPES })
  @IsOptional()
  @IsEnum(STORE_TYPES)
  storeType?: StoreTypeValue;

  @ApiPropertyOptional({ example: 6.4413 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 7.4988 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}

export class UpdateProspectDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @Matches(PHONE, { message: 'Enter a valid phone number' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Empty string clears the email' })
  @Transform(trim)
  @IsOptional()
  @Matches(/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: 'Enter a valid email address',
  })
  @MaxLength(160)
  email?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({ enum: STORE_TYPES })
  @IsOptional()
  @IsEnum(STORE_TYPES)
  storeType?: StoreTypeValue;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}

export class ProspectQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PROSPECT_STAGES })
  @IsOptional()
  @IsEnum(PROSPECT_STAGES)
  stage?: ProspectStageValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({ enum: STORE_TYPES })
  @IsOptional()
  @IsEnum(STORE_TYPES)
  storeType?: StoreTypeValue;

  @ApiPropertyOptional({ description: 'Name, phone, email or address' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Only prospects I added' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;
}

export class AdminProspectQueryDto extends ProspectQueryDto {
  @ApiPropertyOptional({ description: 'Prospects added by this marketer' })
  @IsOptional()
  @IsUUID()
  marketerId?: string;

  @ApiPropertyOptional({ description: 'Include removed prospects' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({ description: 'true: joined FADA; false: not yet' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined ? undefined : toBool({ value }),
  )
  @IsBoolean()
  converted?: boolean;
}

export class LogInteractionDto {
  @ApiProperty({ enum: RESPONSES })
  @IsEnum(RESPONSES)
  response: ResponseValue;

  @ApiProperty({ example: 'Spoke with the owner; open to a demo next week.' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  comment: string;

  @ApiPropertyOptional({
    description: 'When the call or visit happened (defaults to now)',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ description: 'Where the marketer was (visits)' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}

export class LinkProspectDto {
  @ApiProperty({ description: 'The FADA pharmacy this prospect became' })
  @IsUUID()
  pharmacyId: string;
}

// ─── Routes ────────────────────────────────────────────────────────────────────

export class CreateSalesRouteDto {
  @ApiProperty({ example: 'Holy Ghost to GRA' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateSalesRouteDto {
  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'false retires the route' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── Marketer accounts (admin) ─────────────────────────────────────────────────

export class CreateMarketerDto {
  @ApiProperty({ example: 'ada@thefadaapp.com' })
  @Transform(trim)
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Ada' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName: string;

  @ApiProperty({ example: 'Okafor' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName: string;

  @ApiPropertyOptional({ example: '08031234567' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Enter a valid phone number' })
  phone?: string;
}

export class MarketerQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Name or email' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined ? undefined : toBool({ value }),
  )
  @IsBoolean()
  active?: boolean;
}

export class MarketingSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Lagos day YYYY-MM-DD (inclusive)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ description: 'Lagos day YYYY-MM-DD (inclusive)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
