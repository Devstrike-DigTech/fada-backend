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
  ApiTags,
} from '@nestjs/swagger';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { ContentService } from '@modules/content/content.service';
import {
  CreateProjectDto,
  CreateTestimonialDto,
  UpdateContentDto,
  UpdateProjectDto,
  UpdateTestimonialDto,
} from '@modules/content/dto/content.dto';

const imageUpload = (field: string) =>
  FileInterceptor(field, {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.match(/image\/(jpeg|png|webp)/)) {
        cb(new Error('Only JPEG, PNG and WebP images are allowed'), false);
      } else {
        cb(null, true);
      }
    },
  });

const imageBody = (field: string) => ({
  schema: {
    type: 'object',
    properties: { [field]: { type: 'string', format: 'binary' } },
  },
});

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/content', version: '1' })
export class AdminContentController {
  constructor(private readonly content: ContentService) {}

  // ─── Pages ───────────────────────────────────────────────────────────────────

  @Get('pages')
  @ApiOperation({
    summary:
      'All editable pages with version, publish state and source (database / default)',
  })
  pages() {
    return this.content.adminListPages();
  }

  @Get('pages/:key')
  @ApiOperation({ summary: 'One page including unpublished drafts' })
  page(@Param('key') key: string) {
    return this.content.adminGetPage(key);
  }

  @Put('pages/:key')
  @ApiOperation({
    summary: 'Edit a page (bumps version, clears cache)',
    description:
      'Keys: app_info, disclaimer, terms_of_service, privacy_policy, credits, future_features, contact.',
  })
  updatePage(
    @CurrentUser() admin: CurrentUserData,
    @Param('key') key: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.content.adminUpdatePage(key, dto, admin.sub);
  }

  @Post('pages/:key/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore the default text for a page (as a new version)',
  })
  resetPage(@CurrentUser() admin: CurrentUserData, @Param('key') key: string) {
    return this.content.adminResetPage(key, admin.sub);
  }

  // ─── Good Cause projects ─────────────────────────────────────────────────────

  @Get('good-cause/projects')
  @ApiOperation({ summary: 'All projects incl. inactive' })
  projects() {
    return this.content.adminListProjects();
  }

  @Post('good-cause/projects')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a project' })
  createProject(
    @CurrentUser() admin: CurrentUserData,
    @Body() dto: CreateProjectDto,
  ) {
    return this.content.adminCreateProject(dto, admin.sub);
  }

  @Patch('good-cause/projects/:id')
  @ApiOperation({
    summary: 'Update a project (e.g. raised amount, beneficiaries, status)',
  })
  updateProject(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.content.adminUpdateProject(id, dto, admin.sub);
  }

  @Delete('good-cause/projects/:id')
  @ApiOperation({
    summary: 'Delete a project (testimonials are kept, unlinked)',
  })
  deleteProject(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.content.adminDeleteProject(id, admin.sub);
  }

  @Post('good-cause/projects/:id/image')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody(imageBody('image'))
  @UseInterceptors(imageUpload('image'))
  @ApiOperation({ summary: 'Upload or replace the project image' })
  projectImage(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.content.adminUploadProjectImage(id, file, admin.sub);
  }

  // ─── Good Cause testimonials ─────────────────────────────────────────────────

  @Get('good-cause/testimonials')
  @ApiOperation({ summary: 'All testimonials incl. inactive' })
  testimonials() {
    return this.content.adminListTestimonials();
  }

  @Post('good-cause/testimonials')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a testimonial (only publish real, consented quotes)',
  })
  createTestimonial(
    @CurrentUser() admin: CurrentUserData,
    @Body() dto: CreateTestimonialDto,
  ) {
    return this.content.adminCreateTestimonial(dto, admin.sub);
  }

  @Patch('good-cause/testimonials/:id')
  @ApiOperation({ summary: 'Update a testimonial' })
  updateTestimonial(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateTestimonialDto,
  ) {
    return this.content.adminUpdateTestimonial(id, dto, admin.sub);
  }

  @Delete('good-cause/testimonials/:id')
  @ApiOperation({ summary: 'Delete a testimonial' })
  deleteTestimonial(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.content.adminDeleteTestimonial(id, admin.sub);
  }

  @Post('good-cause/testimonials/:id/avatar')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody(imageBody('avatar'))
  @UseInterceptors(imageUpload('avatar'))
  @ApiOperation({ summary: 'Upload or replace the author avatar' })
  testimonialAvatar(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.content.adminUploadTestimonialAvatar(id, file, admin.sub);
  }
}
