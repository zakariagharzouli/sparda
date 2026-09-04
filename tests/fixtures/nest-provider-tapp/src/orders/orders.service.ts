import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './order.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly repo: Repository<Order>,
  ) {}

  create(dto: any) {
    return this.repo.save(dto);
  }

  remove(id: string) {
    return this.repo.softDelete(id);
  }

  edit(id: string, dto: any) {
    return this.repo.update(id, dto);
  }

  store(dto: any) {
    return this.repo.save({ email: dto.email, profile: { city: dto.city } });
  }
}
