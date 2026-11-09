const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("vi");

/** A saved source file must not reintroduce a product removed from the catalog. */
export function availablePriceListRows<T extends { cells: string[] }>(rows: T[], deleted: Array<{sku:string;name:string}>, activeSkus: string[]): T[] {
  if (!deleted.length) return rows;
  const removedSkus = new Set(deleted.map((item) => normalized(item.sku)).filter(Boolean));
  const removedNames = new Set(deleted.map((item) => normalized(item.name)).filter(Boolean));
  const active = new Set(activeSkus.map(normalized));
  return rows.filter((row) => {
    const cells = row.cells.map(normalized);
    if (cells.some((cell) => removedSkus.has(cell))) return false;
    if (cells.some((cell) => active.has(cell))) return true;
    return !cells.some((cell) => removedNames.has(cell));
  });
}
