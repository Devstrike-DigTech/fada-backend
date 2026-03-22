// dto/add-alternative.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class AddAlternativeDto {
  @ApiProperty({
    example: 'uuid-of-alternative-drug',
    description: 'ID of the alternative drug',
  })
  alternativeDrugId: string;
}
