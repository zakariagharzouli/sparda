import { Repository } from 'typeorm';
import { Row } from './row.entity';

export class NotinjectableService {
  constructor(private readonly repo: Repository<Row>) {}
  list() {
    return this.repo.find();
  }
}
