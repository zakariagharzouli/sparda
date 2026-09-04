// A barrel. The import specifier IS relative and it DOES resolve — and the file
// it resolves to does not declare the class, it forwards the name. Which
// declaration `LeafService` reaches is a question this grammar has not answered.
export { LeafService } from './leaf.service';
