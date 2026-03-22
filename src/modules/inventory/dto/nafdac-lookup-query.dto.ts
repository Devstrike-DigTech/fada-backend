import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class NafdacLookupQueryDto {
  @ApiPropertyOptional({
    example: 'A4-100019',
    description: 'Look up by NAFDAC registration number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  nafdacNumber?: string;

  @ApiPropertyOptional({
    example: 'Paracetamol',
    description: 'Search drug by name (min 3 chars)',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name?: string;
}
