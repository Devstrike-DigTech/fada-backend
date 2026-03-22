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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import { Public } from '@common/decorators/public.decorator';
import { AllowGuest } from '@common/decorators/allow-guest.decorator';
import { InventoryService } from './inventory.service';
import { AddDrugDto } from './dto/add-drug.dto';
import { UpdateDrugDto } from './dto/update-drug.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { InventoryQueryDto } from './dto/inventory-query.dto';
import { NafdacLookupQueryDto } from './dto/nafdac-lookup-query.dto';
import { AddAlternativeDto } from './dto/add-alternative.dto';

@ApiTags('Inventory')
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ─── Drug Categories ────────────────────────────────────────────────────────

  @Get('categories')
  @Public()
  @ApiOperation({
    summary:
      'List active drug categories grouped by type (primary / secondary)',
  })
  @ApiQuery({ name: 'type', required: false, enum: ['primary', 'secondary'] })
  listCategories(@Query('type') type?: 'primary' | 'secondary') {
    return this.inventoryService.listCategories(type);
  }

  // ─── NAFDAC / EMDEX Lookup ──────────────────────────────────────────────────

  @Get('nafdac')
  @Public()
  @ApiOperation({
    summary: 'Look up drug info from EMDEX / NAFDAC registry',
    description:
      'Provide nafdacNumber for a direct lookup or name for a search. ' +
      'Results are cached for 7 days.',
  })
  async nafdacLookup(@Query() query: NafdacLookupQueryDto) {
    if (query.nafdacNumber) {
      return this.inventoryService.lookupNafdac(query.nafdacNumber);
    }
    if (query.name) {
      return this.inventoryService.searchDrugsByName(query.name);
    }
    return { results: [] };
  }

  // ─── Branch Inventory (pharmacist-facing) ───────────────────────────────────

  @Get('branch/:branchId')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List inventory for a branch (pharmacist/staff)',
    description: 'Owner, operator, and branch staff all have read access.',
  })
  @ApiParam({ name: 'branchId', description: 'Branch ID' })
  listInventory(
    @CurrentUser() user: CurrentUserData,
    @Param('branchId') branchId: string,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventoryService.listInventory(user.sub, branchId, query);
  }

  @Get('branch/:branchId/summary')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Inventory dashboard summary for a branch' })
  getInventorySummary(
    @CurrentUser() user: CurrentUserData,
    @Param('branchId') branchId: string,
  ) {
    return this.inventoryService.getInventorySummary(user.sub, branchId);
  }

  // ─── Public branch inventory (customer-facing) ──────────────────────────────

  @Get('branch/:branchId/public')
  @AllowGuest()
  @ApiOperation({
    summary: 'Public drug listing for a branch (customers / search results)',
  })
  listInventoryPublic(
    @Param('branchId') branchId: string,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventoryService.listInventoryPublic(branchId, query);
  }

  // ─── Add Drug ───────────────────────────────────────────────────────────────

  @Post('branch/:branchId/drugs')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Add a drug to a branch inventory',
    description:
      'Supply nafdacNumber to auto-fill details from EMDEX. ' +
      'Owner, operator, and branch staff can add drugs.',
  })
  addDrug(
    @CurrentUser() user: CurrentUserData,
    @Param('branchId') branchId: string,
    @Body() dto: AddDrugDto,
  ) {
    return this.inventoryService.addDrug(user.sub, branchId, dto);
  }

  // ─── Get Drug Detail ────────────────────────────────────────────────────────

  @Get('drugs/:drugId')
  @AllowGuest()
  @ApiOperation({ summary: 'Get full drug details by ID' })
  getDrug(@Param('drugId') drugId: string) {
    return this.inventoryService.getDrugById(drugId);
  }

  // ─── Alternatives ───────────────────────────────────────────────────────────

  @Post('drugs/:drugId/alternatives')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Add a drug as an alternative (bidirectional)' })
  addAlternative(
    @CurrentUser() user: CurrentUserData,
    @Param('drugId') drugId: string,
    @Body() dto: AddAlternativeDto,
  ) {
    return this.inventoryService.addAlternative(
      user.sub,
      drugId,
      dto.alternativeDrugId,
    );
  }

  @Delete('drugs/:drugId/alternatives/:alternativeDrugId')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Remove an alternative link (bidirectional)' })
  removeAlternative(
    @CurrentUser() user: CurrentUserData,
    @Param('drugId') drugId: string,
    @Param('alternativeDrugId') alternativeDrugId: string,
  ) {
    return this.inventoryService.removeAlternative(
      user.sub,
      drugId,
      alternativeDrugId,
    );
  }

  // ─── Update Drug ────────────────────────────────────────────────────────────

  @Patch('drugs/:drugId')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update drug details (owner/operator/staff)' })
  updateDrug(
    @CurrentUser() user: CurrentUserData,
    @Param('drugId') drugId: string,
    @Body() dto: UpdateDrugDto,
  ) {
    return this.inventoryService.updateDrug(user.sub, drugId, dto);
  }

  // ─── Remove Drug ────────────────────────────────────────────────────────────

  @Delete('drugs/:drugId')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Remove a drug from inventory (owner/operator/staff)',
  })
  removeDrug(
    @CurrentUser() user: CurrentUserData,
    @Param('drugId') drugId: string,
  ) {
    return this.inventoryService.removeDrug(user.sub, drugId);
  }

  // ─── Update Stock ───────────────────────────────────────────────────────────

  @Patch('drugs/:drugId/stock')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update drug stock (set / add / subtract)',
    description: 'mode=set replaces quantity, add/subtract adjusts it.',
  })
  updateStock(
    @CurrentUser() user: CurrentUserData,
    @Param('drugId') drugId: string,
    @Body() dto: UpdateStockDto,
  ) {
    return this.inventoryService.updateStock(user.sub, drugId, dto);
  }

  // ─── Drug Images ────────────────────────────────────────────────────────────

  @Post('drugs/:drugId/images')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload a drug image (max 5 per drug)' })
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/image\/(jpeg|png|webp)/)) {
          cb(new Error('Only JPEG, PNG and WebP images are allowed'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  uploadDrugImage(
    @CurrentUser() user: CurrentUserData,
    @Param('drugId') drugId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.inventoryService.uploadDrugImage(user.sub, drugId, file);
  }

  @Delete('drugs/:drugId/images/:imageId')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete a drug image' })
  deleteDrugImage(
    @CurrentUser() user: CurrentUserData,
    @Param('drugId') drugId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.inventoryService.deleteDrugImage(user.sub, drugId, imageId);
  }

  // ─── Batch Upload ───────────────────────────────────────────────────────────

  @Post('branch/:branchId/batch-upload')
  @Roles(UserRole.PHARMACIST)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Batch upload drugs via CSV (owner/operator only)',
    description:
      'CSV columns: nafdac_number, name, generic_name, manufacturer, drug_type, ' +
      'package_type, price, stock_amount, low_stock_threshold, expiry_date, is_prescription. ' +
      'Returns a job ID — poll GET /inventory/batch-jobs/:jobId for status.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/(csv|spreadsheet|excel|text\/plain)/)) {
          cb(new Error('Only CSV files are allowed'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  batchUpload(
    @CurrentUser() user: CurrentUserData,
    @Param('branchId') branchId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.inventoryService.initiateBatchUpload(user.sub, branchId, file);
  }
}
