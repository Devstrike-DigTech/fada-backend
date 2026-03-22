import { PartialType } from '@nestjs/swagger';
import { AddDrugDto } from './add-drug.dto';

export class UpdateDrugDto extends PartialType(AddDrugDto) {}
