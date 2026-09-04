import { Module } from '@nestjs/common';
import { UsevalueController } from './usevalue.controller';
import { UsevalueService } from './usevalue.service';

@Module({
  controllers: [UsevalueController],
  providers: [{ provide: UsevalueService, useValue: { list: () => [] } }],
})
export class UsevalueModule {}
