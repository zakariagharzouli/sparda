import { Injectable } from '@nestjs/common';
import { PrismaClient } from './prisma-lookalike';

@Injectable()
export class FakePrismaService extends PrismaClient {}
