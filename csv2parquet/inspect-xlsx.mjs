import xlsx from 'xlsx';
import { resolve } from 'node:path';

const xlsxPath = resolve(process.argv[2] || 'dft-road-casualty-statistics-road-safety-open-dataset-data-guide-2024.xlsx');
const wb = xlsx.readFile(xlsxPath);
console.log('Sheets:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: null });
  console.log('\n===', name, '=== rows:', rows.length);
  if (rows[0]) console.log('Columns:', Object.keys(rows[0]));
}
