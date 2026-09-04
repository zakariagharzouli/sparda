import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { AggregateModule } from './aggregate/aggregate.module';
import { AlphaModule } from './ambiguous/alpha.module';
import { AmbiguousModule } from './ambiguous/ambiguous.module';
import { BadopModule } from './badop/badop.module';
import { BarrelModule } from './barrel/barrel.module';
import { BetaModule } from './ambiguous/beta.module';
import { CallbackModule } from './callback/callback.module';
import { CatModule } from './mongoose/mongoose.module';
import { ComputedModule } from './computed/computed.module';
import { Depth3Module } from './depth3/depth3.module';
import { Depth4Module } from './depth4/depth4.module';
import { DogModule } from './mongonobridge/mongonobridge.module';
import { EntitymismatchModule } from './entitymismatch/entitymismatch.module';
import { ExportedModule } from './exported/exported.module';
import { FakeNestModule } from './fakenest/fakenest.module';
import { FakeOrmModule } from './fakeorm/fakeorm.module';
import { FakebridgeModule } from './fakebridge/fakebridge.module';
import { FakeforfeatureModule } from './fakeforfeature/fakeforfeature.module';
import { FakeinjectableModule } from './fakeinjectable/fakeinjectable.module';
import { FakeverbModule } from './fakeverb/fakeverb.module';
import { ForwardrefModule } from './forwardref/forwardref.module';
import { FoxModule } from './fakemongoose/fakemongoose.module';
import { HiddenModule } from './notexported/hidden.module';
import { IncongruentModule } from './incongruent/incongruent.module';
import { InjectTokenModule } from './injecttoken/injecttoken.module';
import { MutatedModule } from './mutated/mutated.module';
import { NamedconnModule } from './namedconn/namedconn.module';
import { NamedfeatureModule } from './namedfeature/namedfeature.module';
import { NobindingModule } from './nobinding/nobinding.module';
import { NoforfeatureModule } from './noforfeature/noforfeature.module';
import { NotexportedModule } from './notexported/notexported.module';
import { NotinjectableModule } from './notinjectable/notinjectable.module';
import { PrismaBackedModule } from './prisma/prisma.module';
import { PrismaFakeModule } from './prismafake/prismafake.module';
import { SharedRowModule } from './exported/shared-row.module';
import { StrtokenModule } from './strtoken/strtoken.module';
import { TypeormModule } from './typeorm/typeorm.module';
import { UseClassModule } from './useclass/useclass.module';
import { UseExistingModule } from './useexisting/useexisting.module';
import { UsefactoryModule } from './usefactory/usefactory.module';
import { UsevalueModule } from './usevalue/usevalue.module';

@Module({
  imports: [
    AggregateModule,
    AlphaModule,
    AmbiguousModule,
    BadopModule,
    BarrelModule,
    BetaModule,
    CallbackModule,
    CatModule,
    ComputedModule,
    Depth3Module,
    Depth4Module,
    DogModule,
    EntitymismatchModule,
    ExportedModule,
    FakeNestModule,
    FakeOrmModule,
    FakebridgeModule,
    FakeforfeatureModule,
    FakeinjectableModule,
    FakeverbModule,
    ForwardrefModule,
    FoxModule,
    HiddenModule,
    IncongruentModule,
    InjectTokenModule,
    MutatedModule,
    NamedconnModule,
    NamedfeatureModule,
    NobindingModule,
    NoforfeatureModule,
    NotexportedModule,
    NotinjectableModule,
    PrismaBackedModule,
    PrismaFakeModule,
    SharedRowModule,
    StrtokenModule,
    TypeormModule,
    UseClassModule,
    UseExistingModule,
    UsefactoryModule,
    UsevalueModule,
  ],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
