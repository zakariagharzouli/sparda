import { Module } from '@nestjs/common';
import { AmbiguousPort } from './ambiguous.port';
import { BetaImpl } from './beta.impl';

@Module({
  providers: [{ provide: AmbiguousPort, useClass: BetaImpl }],
  exports: [AmbiguousPort],
})
export class BetaModule {}
