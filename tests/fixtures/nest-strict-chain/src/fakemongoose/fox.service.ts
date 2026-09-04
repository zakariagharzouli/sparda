import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Fox } from './fox.schema';

@Injectable()
export class FoxService {
  constructor(@InjectModel(Fox.name) private readonly foxModel: Model<Fox>) {}
  list() {
    return this.foxModel.find();
  }
}
