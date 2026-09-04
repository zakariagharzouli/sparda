import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PositiveController } from './positive.controller';
import { MutableController } from './mutable.controller';
import { ExternalController } from './external.controller';
import { EnvironmentController } from './environment.controller';
import { CallController } from './call.controller';
import { CycleController } from './cycle.controller';
import { UnresolvedController } from './unresolved.controller';
import { PrivateController } from './private.controller';
import { PartialController } from './partial.controller';

@Module({
  controllers: [
    PositiveController,
    MutableController,
    ExternalController,
    EnvironmentController,
    CallController,
    CycleController,
    UnresolvedController,
    PrivateController,
    PartialController,
  ],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
