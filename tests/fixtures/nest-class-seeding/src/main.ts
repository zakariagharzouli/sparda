import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { SharedModule } from './shared/shared.module';
import { BarrelModule } from './barrel/barrel.module';
import { FactoryModule } from './factory/factory.module';
import { PinAModule } from './ambigctrl/pin-a.module';
import { PinBModule } from './ambigctrl/pin-b.module';
import { TabAModule } from './ambigsvc/tab-a.module';
import { TabBModule } from './ambigsvc/tab-b.module';

@Module({ imports: [
    SharedModule,
    BarrelModule,
    FactoryModule,
    PinAModule,
    PinBModule,
    TabAModule,
    TabBModule,
  ] })
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
