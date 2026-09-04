import { Injectable } from '@nestjs/common';
import { FakePrismaService } from './fake-prisma.service';

@Injectable()
export class PrismaFakeService {
  constructor(private readonly prisma: FakePrismaService) {}
  list() {
    return this.prisma.account.findMany();
  }
}
