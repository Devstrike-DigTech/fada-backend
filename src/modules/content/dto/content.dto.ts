import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContentFormat, GoodCauseProjectStatus } from '@prisma/client';

export class UpdateContentDto {
  @ApiPropertyOptional({ example: 'Terms of Service' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiProperty({
    description:
      'Markdown / HTML string, or for format=json a JSON value (object/array) or a JSON-encoded string',
  })
  @IsOptional()
  @Allow() // free-form (string or JSON); validated against `format` in ContentService
  content?: unknown;

  @ApiPropertyOptional({ enum: ['markdown', 'html', 'json'] })
  @IsOptional()
  @IsEnum(['markdown', 'html', 'json'])
  format?: ContentFormat;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Legal effective date',
  })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}

export class CreateProjectDto {
  @ApiProperty({ example: 'Healthcare For All' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({
    example: 'Free malaria testing and treatment in rural Enugu',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  summary?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @ApiPropertyOptional({
    enum: ['upcoming', 'active', 'completed'],
    default: 'active',
  })
  @IsOptional()
  @IsEnum(['upcoming', 'active', 'completed'])
  status?: GoodCauseProjectStatus;

  @ApiPropertyOptional({ example: 2000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  targetAmountNgn?: number;

  @ApiPropertyOptional({ example: 1300000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  raisedAmountNgn?: number;

  @ApiPropertyOptional({ example: 420, description: 'People helped so far' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  beneficiaries?: number;

  @ApiPropertyOptional({ type: [String], example: ['Enugu', 'Anambra'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(37)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  states?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}

export class CreateTestimonialDto {
  @ApiProperty({ example: 'Amaka N.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  authorName: string;

  @ApiPropertyOptional({ example: 'Enugu' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  authorLocation?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1500)
  content: string;

  @ApiPropertyOptional({ description: 'Project this testimonial is about' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateTestimonialDto extends PartialType(CreateTestimonialDto) {}
