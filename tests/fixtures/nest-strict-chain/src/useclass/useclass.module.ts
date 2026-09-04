import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Row } from './row.entity';
import { UseClassController } from './useclass.controller';
import { UseClassPort } from './useclass.port';
import { UseClassImpl } from './useclass.impl';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [UseClassController],
  providers: [{ provide: UseClassPort, useClass: UseClassImpl }],
})
export class UseClassModule {}
