import { Module } from '@nestjs/common';
import { NotexportedController } from './notexported.controller';
import { HiddenModule } from './hidden.module';

@Module({ imports: [HiddenModule], controllers: [NotexportedController] })
export class NotexportedModule {}
