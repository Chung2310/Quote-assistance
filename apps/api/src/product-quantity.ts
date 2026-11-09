/** Convert a stated requirement to the minimum selling quantity using catalog facts only. */
export interface QuantityProduct {
  name: string;
  sku?: string;
  unit: string;
  description?: string;
  attributes?: Record<string, string>;
}

export interface QuantityRequirement { quantity: number; unit: string; evidence: string }
export type QuantityResolution =
  | { status: "resolved"; quantity: number; note: string }
  | { status: "unresolved"; question: string }
  | { status: "not_applicable" };

export const minimumQuantityInstructions = "Tính số lượng tối thiểu, không cộng hao hụt hoặc dự phòng. Nếu khách nêu nhu cầu khác đơn vị bán (m², mét, kg, lít, số cái...), trả quantityRequirement:{quantity:number,unit:string,evidence:string}; evidence phải chép nguyên văn phần yêu cầu có số lượng và đơn vị đó. Không tự tính số bao/thùng/cuộn/hộp: máy chủ quy đổi từ quy cách, định mức và độ phủ của đúng sản phẩm rồi làm tròn lên khi bán nguyên đơn vị. Với định mức dạng khoảng, dùng khả năng đáp ứng lớn nhất (hoặc mức tiêu hao thấp nhất) để tính số lượng tối thiểu. Không lấy độ dày làm diện tích phủ, không tự suy ra định mức thiếu. Giữ số lượng nếu khách đã chỉ rõ theo đơn vị bán. Khi không cần quy đổi, quantityRequirement=null.";

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/²|\^2/g, "2").replace(/³|\^3/g, "3").replace(/[–—~]/g, "-");
interface Unit { key: string; scale: number; discrete: boolean }
const units: Record<string, Unit> = {};
function register(key: string, scale: number, discrete: boolean, aliases: string[]) {
  for (const alias of aliases) units[alias] = { key, scale, discrete };
}
register("m", 1, false, ["m", "met", "meter", "meters"]);
register("m", 0.01, false, ["cm"]);
register("m", 0.001, false, ["mm"]);
register("m", 1000, false, ["km"]);
register("m2", 1, false, ["m2", "met vuong", "sqm"]);
register("m2", 0.0001, false, ["cm2"]);
register("m2", 0.000001, false, ["mm2"]);
register("m3", 1, false, ["m3", "met khoi"]);
register("m3", 0.001, false, ["l", "lit", "liter", "litre", "liters"]);
register("m3", 0.000001, false, ["ml"]);
register("kg", 1, false, ["kg", "kilogram"]);
register("kg", 0.001, false, ["g", "gram"]);
register("kg", 1000, false, ["tan", "tonne"]);
for (const [key, aliases] of Object.entries({ bao: ["bao", "bag", "bags"], thung: ["thung", "bucket"], hop: ["hop", "box", "boxes"], goi: ["goi", "pack"], cuon: ["cuon", "roll", "rolls"], tam: ["tam", "sheet", "sheets"], vien: ["vien", "tile", "tiles"], cai: ["cai", "chiec", "pcs", "piece", "pieces"], bo: ["bo", "set"], chai: ["chai", "bottle"], can: ["can"], ong: ["ong"], thanh: ["thanh"], cay: ["cay"], cong: ["cong"], chuyen: ["chuyen"] })) register(key, 1, true, aliases);
const numberPattern = "\\d+(?:[.,]\\d+)*";
const unitPattern = Object.keys(units).sort((a, b) => b.length - a.length).join("|");
const measurePattern = `(${numberPattern})(?:\\s*(?:-|den|to)\\s*(${numberPattern}))?\\s*(${unitPattern})(?![a-z0-9])`;
interface Measure { min: number; max: number; unit: Unit; text: string; index: number; end: number }

function number(value: string) {
  if (value.includes(",") && value.includes(".")) {
    const decimal = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
    return Number(value.replaceAll(decimal === "," ? "." : ",", "").replace(decimal, "."));
  }
  // Commas are decimal marks in Vietnamese; dotted groups of three are thousands.
  return Number(/^[1-9]\d{0,2}(?:\.\d{3})+$/.test(value) ? value.replaceAll(".", "") : value.replace(",", "."));
}

function unit(value: string): Unit | undefined {
  const normalized = normalize(value).trim().replace(/\s+/g, " ");
  return (Object.hasOwn(units, normalized) ? units[normalized] : undefined) ?? Object.entries(units).find(([alias, entry]) => entry.discrete && new RegExp(`^${alias}\\s*(?:\\(|\\d)`).test(normalized))?.[1];
}
function measures(text: string): Measure[] {
  const normalized = normalize(text);
  return [...normalized.matchAll(new RegExp(measurePattern, "g"))].flatMap((match) => {
    if (/[-\d.,]\s*$/.test(normalized.slice(0, match.index))) return [];
    const low = number(match[1]!);
    const high = match[2] ? number(match[2]) : low;
    if (!(low > 0) || !(high >= low) || !Number.isFinite(high)) return [];
    return [{ min: low, max: high, unit: units[match[3]!]!, text: match[0], index: match.index!, end: match.index! + match[0].length }];
  });
}

interface Edge { from: string; to: string; capacity: number }
function catalogConversions(product: QuantityProduct): Edge[] {
  const selling = unit(product.unit);
  if (!selling) return [];
  const edges: Edge[] = [];
  const add = (from: Unit, to: Unit, min: number, max: number) => {
    if (from.key === to.key || !(min > 0) || !(max >= min)) return;
    // Both directions choose the smallest possible purchase under the stated range.
    edges.push({ from: from.key, to: to.key, capacity: max * to.scale / from.scale });
    edges.push({ from: to.key, to: from.key, capacity: from.scale / (min * to.scale) });
  };
  const lines = [product.name, product.unit, ...(product.description ?? "").split(/[\n;]+/), ...Object.entries(product.attributes ?? {}).map(([key, value]) => `${key}: ${value}`)];
  for (const original of lines) {
    const text = normalize(original);
    const values = measures(text);
    const ratios = new Set<Measure>();
    for (const value of values) {
      const denominator = text.slice(value.end).match(new RegExp(`^\\s*(?:/|tren\\b|moi\\b|cho\\b|per\\b)\\s*(${numberPattern})?\\s*(${unitPattern})(?![a-z0-9])`));
      if (!denominator) continue;
      const count = denominator[1] ? number(denominator[1]) : 1;
      if (!(count > 0)) continue;
      ratios.add(value);
      for (const other of values) if (other.index >= value.end && other.end <= value.end + denominator[0].length) ratios.add(other);
      add(units[denominator[2]!]!, value.unit, value.min / count, value.max / count);
    }
    const coverage = /\b(do phu|mat do phu|dien tich phu|phu duoc|coverage|hieu suat phu|dinh muc)\b/.test(text);
    const packaging = /\b(quy cach|dong goi|trong luong|khoi luong tinh|dung tich|chieu dai cuon)\b/.test(text)
      || Object.entries(units).some(([alias, entry]) => entry.key === selling.key && new RegExp(`^\\s*${alias}\\s*(?:\\(|\\d)`).test(text));
    const lengthLabel = Object.entries(units).filter(([, entry]) => entry.key === selling.key)
      .map(([alias]) => text.match(new RegExp(`^\\s*(?:moi\\s+)?${alias}\\s+(?:co\\s+)?(?:chieu\\s+)?dai\\s*[:=]?\\s*`)))
      .find((match) => match !== null);
    if (selling.discrete && lengthLabel) for (const value of values) {
      if (value.unit.key === "m" && value.index === lengthLabel[0].length) add(selling, value.unit, value.min, value.max);
    }
    if (selling.discrete && (coverage || packaging)) for (const value of values) {
      if (ratios.has(value)) continue;
      if (coverage && value.unit.key !== "m2") continue;
      add(selling, value.unit, value.min, value.max);
    }
    // A sheet/tile's two stated dimensions establish its area; thickness never does.
    if (/\b(kich thuoc|kho tam|size|dimensions)\b/.test(text) || ["tam", "vien"].includes(selling.key)) {
      const dimensions = text.match(new RegExp(`(${numberPattern})\\s*(mm|cm|m)?\\s*[x×]\\s*(${numberPattern})\\s*(mm|cm|m)(?![a-z0-9])`));
      if (dimensions && !/[x×]\s*$/.test(text.slice(0, dimensions.index))
        && !/[x×]/.test(text.slice(dimensions.index! + dimensions[0].length).trimStart().slice(0, 1))) {
        const first = number(dimensions[1]!) * units[dimensions[2] ?? dimensions[4]!]!.scale;
        const second = number(dimensions[3]!) * units[dimensions[4]!]!.scale;
        const piece = ["tam", "vien"].includes(selling.key) ? selling : unit(/\b(vien|tile)\b/.test(text) ? "vien" : "tam")!;
        add(piece, units.m2!, first * second, first * second);
      }
    }
  }
  return edges;
}

function capacities(edges: Edge[], from: string, to: string, visited = new Set<string>()): number[] {
  if (from === to) return [1];
  if (visited.has(from) || visited.size >= 4) return [];
  const nextVisited = new Set([...visited, from]);
  return edges.filter((edge) => edge.from === from && !nextVisited.has(edge.to))
    .flatMap((edge) => capacities(edges, edge.to, to, nextVisited).map((capacity) => edge.capacity * capacity));
}

function close(a: number, b: number) { return Math.abs(a - b) <= Number.EPSILON * 16 * Math.max(1, Math.abs(a), Math.abs(b)); }
function uniqueMeasures(values: Measure[]) {
  return values.filter((value, index) => values.findIndex((other) => other.unit.key === value.unit.key && close(other.min * other.unit.scale, value.min * value.unit.scale)) === index);
}

function applicationQuestion(product: QuantityProduct, requestText: string): string | undefined {
  const specifications = [product.description ?? "", ...Object.entries(product.attributes ?? {}).map(([key, value]) => `${key}: ${value}`)].join("\n");
  const thickness = (text: string) => [...normalize(text).matchAll(/\b(?:do day|day|thickness)\s*(?::|la|khoang|tu)?\s*([^\n;]+)/g)]
    .flatMap((match) => measures(match[1]!).slice(0, 1).filter((value) => value.unit.key === "m"));
  const requested = thickness(requestText);
  const specified = thickness(specifications);
  if (requested.length) {
    if (!specified.length) return "chưa có định mức ứng với độ dày yêu cầu.";
    if (requested.some((wanted) => !specified.some((given) => wanted.min * wanted.unit.scale >= given.min * given.unit.scale
      && wanted.max * wanted.unit.scale <= given.max * given.unit.scale))) return "độ dày yêu cầu nằm ngoài điều kiện định mức của sản phẩm.";
    if (specified.some((value) => value.min !== value.max)) return "cần độ phủ hoặc mức tiêu hao ứng với độ dày cụ thể; không tự nội suy từ khoảng độ dày.";
  }
  const layers = (text: string) => [...normalize(text).matchAll(/(\d+)\s*(?:lop|coats?)\b/g)].map((match) => Number(match[1]));
  const requestedLayers = layers(requestText);
  const specifiedLayers = layers(specifications);
  if (requestedLayers.length && (!specifiedLayers.length || requestedLayers.some((count) => !specifiedLayers.includes(count)))) return "cần định mức ứng với số lớp yêu cầu để quy đổi số lượng tối thiểu.";
  return undefined;
}

export function resolveMinimumQuantity(product: QuantityProduct, requestText: string, rawRequirement?: unknown): QuantityResolution {
  const selling = unit(product.unit);
  const unresolved = (reason: string): QuantityResolution => ({ status: "unresolved", question: `${product.name}: ${reason}` });
  const edges = catalogConversions(product);
  const identifiers = [product.sku, product.name].filter((value): value is string => Boolean(value && value.trim().length > 1));
  const matchingLines = requestText.split(/\r?\n/).filter((line) => identifiers.some((id) => normalize(line).includes(normalize(id))));
  const scoped = identifiers.reduce((text, id) => text.replaceAll(normalize(id), " "), normalize(matchingLines.length ? matchingLines.join("\n") : requestText));
  const values = measures(scoped).filter((value) => value.min === value.max);
  const direct = selling ? uniqueMeasures(values.filter((value) => value.unit.key === selling.key)) : [];
  let requirement: Measure | undefined;
  if (selling?.discrete && direct.length === 1) requirement = direct[0];
  else if (rawRequirement !== undefined && rawRequirement !== null) {
    if (typeof rawRequirement !== "object" || Array.isArray(rawRequirement)) return unresolved("cần xác nhận nhu cầu và đơn vị để quy đổi số lượng tối thiểu.");
    const raw = rawRequirement as Record<string, unknown>;
    const requestedUnit = typeof raw.unit === "string" ? unit(raw.unit) : undefined;
    if (typeof raw.quantity !== "number" || !Number.isFinite(raw.quantity) || raw.quantity <= 0 || !requestedUnit
      || typeof raw.evidence !== "string" || !raw.evidence.trim() || !requestText.includes(raw.evidence)) return unresolved("nhu cầu quy đổi phải có số lượng, đơn vị và trích dẫn đúng yêu cầu.");
    requirement = measures(raw.evidence).find((value) => value.min === value.max && value.unit.key === requestedUnit.key && close(value.min * value.unit.scale, (raw.quantity as number) * requestedUnit.scale));
    if (!requirement) return unresolved("số lượng quy đổi không khớp nội dung yêu cầu.");
  } else {
    if (direct.length === 1) requirement = direct[0];
    else {
      const compatible = selling ? values.filter((value) => capacities(edges, selling.key, value.unit.key).length > 0) : [];
      const distinct = uniqueMeasures(compatible);
      if (distinct.length === 1) requirement = distinct[0];
      else if (distinct.length > 1) return unresolved("có nhiều số đo khác nhau; cần xác nhận nhu cầu áp dụng cho sản phẩm.");
      else if (selling?.discrete && values.some((value) => !value.unit.discrete) && (matchingLines.length > 0 || /\b(do phu|mat do phu|dinh muc|tieu hao|coverage)\b/.test(normalize([product.description, ...Object.entries(product.attributes ?? {}).flat()].join(" "))))) return unresolved("chưa có quy cách hoặc định mức đủ rõ để đổi nhu cầu sang đơn vị bán.");
    }
  }
  if (!requirement) return { status: "not_applicable" };
  if (!selling) return unresolved("đơn vị bán chưa hỗ trợ quy đổi; cần xác nhận số lượng theo đơn vị bán.");
  if (selling.key !== requirement.unit.key) {
    const question = applicationQuestion(product, requestText);
    if (question) return unresolved(question);
  }
  const possible = capacities(edges, selling.key, requirement.unit.key);
  if (!possible.length) return unresolved(`chưa có định mức từ ${requirement.text} sang ${product.unit}.`);
  if (possible.some((value) => !close(value, possible[0]!))) return unresolved("các định mức hoặc quy cách cho kết quả khác nhau; cần xác nhận định mức áp dụng.");
  const capacity = possible[0]! * selling.scale / requirement.unit.scale;
  const exact = requirement.min / capacity;
  const nearest = Math.round(exact);
  const quantity = selling.discrete ? close(exact, nearest) ? nearest : Math.ceil(exact) : Number(exact.toPrecision(12));
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return unresolved("số lượng sau quy đổi nằm ngoài giới hạn cho phép.");
  const display = (value: number) => Number(value.toPrecision(12)).toLocaleString("vi-VN", { maximumFractionDigits: 8 });
  const requirementUnit = requirement.text.replace(new RegExp(`^${numberPattern}\\s*`), "");
  return { status: "resolved", quantity, note: `Tối thiểu ${display(quantity)} ${product.unit}: ${display(requirement.min)} ${requirementUnit} ÷ ${display(capacity)} ${requirementUnit}/${product.unit}${selling.discrete ? ", làm tròn lên" : ""}; không cộng hao hụt.` };
}
