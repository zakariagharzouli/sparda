import { Module } from '@nestjs/common';
import { ExportedController } from './exported.controller';
import { SharedRowModule } from './shared-row.module';

@Module({ imports: [SharedRowModule], controllers: [ExportedController] })
export class ExportedModule {}
