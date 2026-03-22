import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class OverridePcnVerificationDto {
  @ApiPropertyOptional({
    description: 'Admin note explaining why the override was applied',
    example: 'Verified via phone call with PCN office — registry was temporarily unavailable',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
