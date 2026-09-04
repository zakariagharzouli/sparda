import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Mark {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
}
