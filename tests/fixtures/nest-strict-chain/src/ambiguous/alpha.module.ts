import { Module } from '@nestjs/common';
import { AmbiguousPort } from './ambiguous.port';
import { AlphaImpl } from './alpha.impl';

@Module({
  providers: [{ provide: AmbiguousPort, useClass: AlphaImpl }],
  exports: [AmbiguousPort],
})
export class AlphaModule {}
