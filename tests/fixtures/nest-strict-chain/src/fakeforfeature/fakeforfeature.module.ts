import { Module } from '@nestjs/common';
import { TypeOrmModule } from './typeorm-module-lookalike';
import { FakeforfeatureController } from './fakeforfeature.controller';
import { FakeforfeatureService } from './fakeforfeature.service';
import { Row } from './row.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Row])],
  controllers: [FakeforfeatureController],
  providers: [FakeforfeatureService],
})
export class FakeforfeatureModule {}
