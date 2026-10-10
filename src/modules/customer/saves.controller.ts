import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import { SavesService } from './saves.service';
import {
  AddListItemDto,
  CreateDrugListDto,
  RenameDrugListDto,
  ReserveFromListDto,
  SaveStatusQueryDto,
  SavedItemsQueryDto,
  UpdateListItemDto,
} from './dto/saves.dto';

@ApiTags('Customer')
@ApiBearerAuth('access-token')
@Roles(UserRole.CUSTOMER)
@Controller({ path: 'saves', version: '1' })
export class SavesController {
  constructor(private readonly saves: SavesService) {}

  // ─── Status ──────────────────────────────────────────────────────────────────

  @Get('status')
  @ApiOperation({
    summary: 'Which of the given drug/pharmacy ids are saved (for heart icons)',
  })
  status(
    @CurrentUser() user: CurrentUserData,
    @Query() query: SaveStatusQueryDto,
  ) {
    return this.saves.saveStatus(user.sub, query);
  }

  // ─── Drugs ───────────────────────────────────────────────────────────────────

  @Get('drugs')
  @ApiOperation({
    summary: 'Saved drugs (pass latitude/longitude for distances)',
  })
  listDrugs(
    @CurrentUser() user: CurrentUserData,
    @Query() query: SavedItemsQueryDto,
  ) {
    return this.saves.listSavedDrugs(user.sub, query);
  }

  @Post('drugs/:drugId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a drug (idempotent)' })
  saveDrug(
    @CurrentUser() user: CurrentUserData,
    @Param('drugId') drugId: string,
  ) {
    return this.saves.saveDrug(user.sub, drugId);
  }

  @Delete('drugs/:drugId')
  @ApiOperation({ summary: 'Unsave a drug' })
  unsaveDrug(
    @CurrentUser() user: CurrentUserData,
    @Param('drugId') drugId: string,
  ) {
    return this.saves.unsaveDrug(user.sub, drugId);
  }

  // ─── Pharmacies ──────────────────────────────────────────────────────────────

  @Get('pharmacies')
  @ApiOperation({
    summary: 'Saved pharmacies (pass latitude/longitude for distances)',
  })
  listPharmacies(
    @CurrentUser() user: CurrentUserData,
    @Query() query: SavedItemsQueryDto,
  ) {
    return this.saves.listSavedPharmacies(user.sub, query);
  }

  @Post('pharmacies/:pharmacyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a pharmacy (idempotent)' })
  savePharmacy(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
  ) {
    return this.saves.savePharmacy(user.sub, pharmacyId);
  }

  @Delete('pharmacies/:pharmacyId')
  @ApiOperation({ summary: 'Unsave a pharmacy' })
  unsavePharmacy(
    @CurrentUser() user: CurrentUserData,
    @Param('pharmacyId') pharmacyId: string,
  ) {
    return this.saves.unsavePharmacy(user.sub, pharmacyId);
  }

  // ─── Lists ───────────────────────────────────────────────────────────────────

  @Get('lists')
  @ApiOperation({ summary: 'My drug lists with totals' })
  listLists(@CurrentUser() user: CurrentUserData) {
    return this.saves.listLists(user.sub);
  }

  @Post('lists')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a named list' })
  createList(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateDrugListDto,
  ) {
    return this.saves.createList(user.sub, dto);
  }

  @Get('lists/:id')
  @ApiOperation({
    summary: 'List detail with drugs, totals and per-branch availability',
  })
  getList(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: SavedItemsQueryDto,
  ) {
    return this.saves.getList(user.sub, id, query);
  }

  @Put('lists/:id')
  @ApiOperation({ summary: 'Rename a list' })
  renameList(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: RenameDrugListDto,
  ) {
    return this.saves.renameList(user.sub, id, dto);
  }

  @Delete('lists/:id')
  @ApiOperation({ summary: 'Delete a list' })
  deleteList(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.saves.deleteList(user.sub, id);
  }

  @Post('lists/:id/drugs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a drug to a list (adding again increases quantity)',
  })
  addItem(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AddListItemDto,
  ) {
    return this.saves.addItem(user.sub, id, dto);
  }

  @Patch('lists/:id/drugs/:drugId')
  @ApiOperation({ summary: 'Change the quantity of a drug in a list' })
  updateItem(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('drugId') drugId: string,
    @Body() dto: UpdateListItemDto,
  ) {
    return this.saves.updateItem(user.sub, id, drugId, dto);
  }

  @Delete('lists/:id/drugs/:drugId')
  @ApiOperation({ summary: 'Remove a drug from a list' })
  removeItem(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('drugId') drugId: string,
  ) {
    return this.saves.removeItem(user.sub, id, drugId);
  }

  @Post('lists/:id/reserve')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Reserve every drug in the list at one branch',
    description:
      'Lists can span branches; pass branchId to choose. Drugs stocked elsewhere are reported as skipped.',
  })
  reserveFromList(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ReserveFromListDto,
  ) {
    return this.saves.reserveFromList(user.sub, id, dto);
  }
}
