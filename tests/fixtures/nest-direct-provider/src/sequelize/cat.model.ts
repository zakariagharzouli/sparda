import { Column, Model, Table } from 'sequelize-typescript';

@Table
export class Cat extends Model {
  @Column name: string;
}
