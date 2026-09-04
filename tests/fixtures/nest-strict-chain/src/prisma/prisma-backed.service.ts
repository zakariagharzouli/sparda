import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaBackedService {
  constructor(private readonly prisma: PrismaService) {}
  list() {
    return this.prisma.account.findMany();
  }
}
