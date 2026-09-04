import fs from 'node:fs';

export class ExportService {
  private destination = process.env.EXPORT_DIR;

  // The opaque effect: SPARDA sees the write and cannot name the path. It sits on
  // line 10 of THIS file, and line 10 of the controller that reaches it is blank —
  // which is exactly what the ledger printed before the two halves were joined.
  writeReport(dto: any) {
    return fs.writeFileSync(this.destination, JSON.stringify(dto));
  }
}
