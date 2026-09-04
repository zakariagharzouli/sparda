import { Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { Dog } from './dog.schema';

@Injectable()
export class DogService {
  constructor(private readonly dogModel: Model<Dog>) {}
  list() {
    return this.dogModel.find();
  }
}
