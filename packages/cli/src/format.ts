export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function printTable(rows: Array<Record<string, unknown>>, columns: string[]): void {
  if (rows.length === 0) {
    console.log('No results.');
    return;
  }

  const widths = columns.map((column) => {
    const values = rows.map((row) => String(row[column] ?? ''));
    return Math.max(column.length, ...values.map((value) => value.length));
  });

  const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index] ?? value.length)).join('  ');
  console.log(line(columns.map((column) => column.toUpperCase())));
  console.log(line(widths.map((width) => '-'.repeat(width))));
  for (const row of rows) {
    console.log(line(columns.map((column) => String(row[column] ?? ''))));
  }
}

export function compactText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}
