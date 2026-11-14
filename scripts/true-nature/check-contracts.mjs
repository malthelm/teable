// Validate importer-generated schemas with this exact checkout's public API contracts.
// Build packages/core and packages/openapi first. Input contains schema, never row values.
import fs from 'node:fs';
import { createFieldRoSchema } from '../../packages/core/dist/index.js';
import { tableRoSchema } from '../../packages/openapi/dist/index.js';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/true-nature/check-contracts.mjs schema.json');
const tables = JSON.parse(fs.readFileSync(file, 'utf8'));
let fields = 0;
let links = 0;
for (const [name, table] of Object.entries(tables)) {
  tableRoSchema.parse({
    name,
    description: 'Synthetic contract validation',
    fields: table.fields,
    records: [],
    views: [{ name: 'All records', type: 'grid' }],
    fieldKeyType: 'name',
  });
  fields += table.fields.length;
  for (const [field, spec] of Object.entries(table.links)) {
    createFieldRoSchema.parse({
      name: field,
      type: 'link',
      options: {
        foreignTableId: 'tbl0000000000000000',
        relationship: spec.many ? 'manyMany' : 'manyOne',
        isOneWay: !spec.bidirectional,
      },
    });
    links++;
  }
}
console.log(
  `Validated ${Object.keys(tables).length} tables, ${fields} fields, ${links} relationships against upstream contracts`
);
