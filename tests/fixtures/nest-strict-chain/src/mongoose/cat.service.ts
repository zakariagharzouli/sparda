import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cat } from './cat.schema';

@Injectable()
export class CatService {
  constructor(@InjectModel(Cat.name) private readonly catModel: Model<Cat>) {}
  list() {
    return this.catModel.find();
  }
}
