import { Module } from '@nestjs/common';
import { PrismaFakeController } from './prismafake.controller';
import { PrismaFakeService } from './prismafake.service';
import { FakePrismaService } from './fake-prisma.service';

@Module({
  controllers: [PrismaFakeController],
  providers: [PrismaFakeService, FakePrismaService],
})
export class PrismaFakeModule {}
