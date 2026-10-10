import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ServeReservationDto {
  @ApiPropertyOptional({
    description: 'Any notes added at time of serving (e.g. substitutions made)',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
