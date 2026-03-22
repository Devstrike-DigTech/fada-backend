import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum DrugTypeDto {
  ORAL = 'oral',
  INFUSION = 'infusion',
  INJECTABLE = 'injectable',
  ANTISEPTIC = 'antiseptic',
  OTHER = 'other',
}

export enum PrescriptionTypeDto {
  OTC = 'otc',
  PRESCRIPTION_ONLY = 'prescription_only',
  CONTROLLED = 'controlled',
}

export class AddDrugDto {
  // ── NAFDAC ────────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: 'A4-100019',
    description:
      'NAFDAC registration number. When provided the system auto-fetches ' +
      'drug details from EMDEX and pre-fills fields left blank.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  nafdacNumber?: string;

  // ── Core drug info ────────────────────────────────────────────────────────

  @ApiProperty({ example: 'Paracetamol Tablets 500mg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Paracetamol' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  genericName?: string;

  @ApiPropertyOptional({ example: 'Panadol' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  aliasName?: string;

  @ApiPropertyOptional({ example: 'Emzor Pharmaceutical Industries Ltd' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'Paracetamol 500mg' })
  @IsOptional()
  @IsString()
  composition?: string;

  @ApiProperty({ enum: DrugTypeDto, example: DrugTypeDto.ORAL })
  @IsEnum(DrugTypeDto)
  drugType: DrugTypeDto;

  @ApiPropertyOptional({ example: 'Tablet' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  packageType?: string;

  @ApiPropertyOptional({ example: '2 tablets every 4–6 hours (max 8/day)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adultDosage?: string;

  @ApiPropertyOptional({ example: '1 tablet every 6 hours' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  childrenDosage?: string;

  @ApiPropertyOptional({
    enum: PrescriptionTypeDto,
    example: PrescriptionTypeDto.OTC,
    description: 'OTC, prescription-only, or controlled substance',
  })
  @IsOptional()
  @IsEnum(PrescriptionTypeDto)
  prescriptionType?: PrescriptionTypeDto;

  // ── Pricing & stock ───────────────────────────────────────────────────────

  @ApiProperty({ example: 350.0, description: 'Selling price in Naira' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @ApiProperty({ example: 100, description: 'Initial stock quantity' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockAmount: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Trigger a low-stock alert when stock falls to this level',
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Expiry date (ISO date string)',
  })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  // ── Categories ────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    type: [String],
    description: 'Primary (therapeutic) category IDs',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  primaryCategoryIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Secondary (drug form) category IDs — e.g. Tablet, Syrup',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  secondaryCategoryIds?: string[];

  // ── Indications / contraindications ──────────────────────────────────────

  @ApiPropertyOptional({
    type: [String],
    example: ['Fever', 'Headache', 'Pain relief'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  indications?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Liver disease', 'Alcohol dependence'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  contraindications?: string[];
}
