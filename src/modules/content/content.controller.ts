import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { ContentService } from './content.service';

/** Public content: static pages and the Good Cause (CSR) section. */
@ApiTags('Content')
@Public()
@Controller({ path: 'content', version: '1' })
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  @ApiOperation({
    summary:
      'Page index with versions (refetch a page when its version changes)',
  })
  index() {
    return this.content.index();
  }

  @Get('app-info')
  @ApiOperation({
    summary: 'App identity, mission, developer, version details',
  })
  appInfo() {
    return this.content.getPage('app_info');
  }

  @Get('disclaimer')
  @ApiOperation({ summary: 'Disclaimers' })
  disclaimer() {
    return this.content.getPage('disclaimer');
  }

  @Get('terms-of-service')
  @ApiOperation({ summary: 'Terms of service' })
  terms() {
    return this.content.getPage('terms_of_service');
  }

  @Get('privacy-policy')
  @ApiOperation({ summary: 'Privacy policy' })
  privacy() {
    return this.content.getPage('privacy_policy');
  }

  @Get('credits')
  @ApiOperation({ summary: 'Team and technology credits' })
  credits() {
    return this.content.getPage('credits');
  }

  @Get('future-features')
  @ApiOperation({
    summary: 'Roadmap items shown on the Future Features screen',
  })
  futureFeatures() {
    return this.content.getPage('future_features');
  }

  // ─── Good Cause ──────────────────────────────────────────────────────────────

  @Get('good-cause')
  @ApiOperation({
    summary:
      'Good Cause screen in one call: stats, active projects, testimonials',
  })
  goodCause() {
    return this.content.goodCauseOverview();
  }

  @Get('good-cause/projects')
  @ApiOperation({ summary: 'Active Good Cause projects with funding progress' })
  projects() {
    return this.content.listProjects();
  }

  @Get('good-cause/projects/:id')
  @ApiOperation({ summary: 'One project with its testimonials' })
  project(@Param('id') id: string) {
    return this.content.getProject(id);
  }

  @Get('good-cause/testimonials')
  @ApiQuery({ name: 'projectId', required: false })
  @ApiOperation({ summary: 'Testimonials, optionally for one project' })
  testimonials(@Query('projectId') projectId?: string) {
    return this.content.listTestimonials(projectId);
  }

  /** Generic accessor, declared last so the named routes above win. */
  @Get('pages/:key')
  @ApiOperation({
    summary: 'Any page by key or slug (app_info, terms-of-service, …)',
  })
  page(@Param('key') key: string) {
    return this.content.getPage(key);
  }
}
