import { Module } from '@nestjs/common';
import { AmbiguousController } from './ambiguous.controller';
import { AlphaModule } from './alpha.module';
import { BetaModule } from './beta.module';

@Module({ imports: [AlphaModule, BetaModule], controllers: [AmbiguousController] })
export class AmbiguousModule {}
