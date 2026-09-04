import { Module } from '@nestjs/common';
import { PrismaBackedController } from './prisma.controller';
import { PrismaBackedService } from './prisma-backed.service';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [PrismaBackedController],
  providers: [PrismaBackedService, PrismaService],
})
export class PrismaBackedModule {}
