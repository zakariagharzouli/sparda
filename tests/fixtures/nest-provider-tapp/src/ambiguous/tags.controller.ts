import { Body, Controller, Post } from '@nestjs/common';
import { TagsService } from './tags.service';

@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  // Everything here is literal and direct. The source still states TWO bindings
  // for this controller, and the container picks between them.
  @Post()
  create(@Body() dto: any) {
    return this.tags.create(dto);
  }
}
