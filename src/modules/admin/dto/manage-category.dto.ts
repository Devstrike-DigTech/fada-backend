import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export enum CategoryTypeDto {
  PRIMARY = 'primary',
  SECONDARY = 'secondary',
}

export class CreateCategoryDto {
  @ApiProperty({ enum: CategoryTypeDto, example: CategoryTypeDto.PRIMARY })
  @IsEnum(CategoryTypeDto)
  type: CategoryTypeDto;

  @ApiProperty({ example: 'Pain & Fever' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'pain-fever' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, numbers and hyphens only',
  })
  slug: string;

  @ApiPropertyOptional({ example: 'Analgesics, NSAIDs, antipyretics' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Pain & Fever (Updated)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Analgesics, NSAIDs, antipyretics' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
