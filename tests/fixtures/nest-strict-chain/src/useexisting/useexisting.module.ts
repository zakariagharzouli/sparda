import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Row } from './row.entity';
import { UseExistingController } from './useexisting.controller';
import { AliasPort } from './alias.port';
import { AliasImpl } from './alias.impl';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [UseExistingController],
  providers: [AliasImpl, { provide: AliasPort, useExisting: AliasImpl }],
})
export class UseExistingModule {}
