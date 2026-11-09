import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";

const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();
function role(text: string): "customerName" | "companyName" | undefined {
  const label = normalize(text).replace(/\s*[:：]\s*$/, "");
  if (/^(?:ben a(?:\s*\(ben (?:giao|mua|giao thau)\))?|ben mua|chu dau tu)$/.test(label)) return "customerName";
  if (/^(?:ben b(?:\s*\(ben (?:nhan|ban|nhan thau)\))?|ben ban|don vi thi cong|nha thau)$/.test(label)) return "companyName";
  return undefined;
}

/** Fill explicit party-name fields after an AI edit, including cover sheets it can miss. */
export function fillXlsxPartyNames(bytes: Buffer, parties: { customerName: string; companyName: string }): Buffer {
  const zip = new PizZip(bytes);
  const parse = (xml: string) => new DOMParser({ onError: () => { throw new Error("File Excel sau khi điền mẫu không hợp lệ."); } }).parseFromString(xml, "application/xml");
  const texts = (element: Element) => Array.from(element.getElementsByTagNameNS(ns, "t")).map((node) => node.textContent ?? "").join("");
  const shared = zip.file("xl/sharedStrings.xml");
  const strings = shared ? Array.from(parse(shared.asText()).getElementsByTagNameNS(ns, "si")).map(texts) : [];
  let changed = false;
  for (const part of zip.file(/^xl\/worksheets\/[^/]+\.xml$/)) {
    const document = parse(part.asText());
    let edited = false;
    const value = (cell: Element) => cell.getAttribute("t") === "s" ? strings[Number(cell.getElementsByTagNameNS(ns, "v").item(0)?.textContent)] ?? "" : cell.getAttribute("t") === "inlineStr" ? texts(cell) : cell.getElementsByTagNameNS(ns, "v").item(0)?.textContent ?? "";
    const write = (cell: Element, text: string) => {
      if (value(cell) === text && !cell.getElementsByTagNameNS(ns, "f").length) return;
      for (const child of Array.from(cell.childNodes)) if (["f", "v", "is"].includes((child as Element).localName ?? "")) cell.removeChild(child);
      cell.setAttribute("t", "inlineStr");
      const inline = document.createElementNS(ns, "is"); const node = document.createElementNS(ns, "t");
      node.setAttribute("xml:space", "preserve"); node.appendChild(document.createTextNode(text)); inline.appendChild(node); cell.insertBefore(inline, cell.firstChild);
      edited = true;
    };
    for (const row of Array.from(document.getElementsByTagNameNS(ns, "row"))) {
      const cells = Array.from(row.getElementsByTagNameNS(ns, "c"));
      for (let index = 0; index < cells.length; index++) {
        const label = value(cells[index]!);
        const key = role(label);
        if (!key) continue;
        // A separate value cell must already exist on the same row. Never fill signature areas.
        const candidate = cells.slice(index + 1).find((cell) => value(cell).trim() && !/^[:：]$/.test(value(cell).trim()));
        if (!candidate || role(value(candidate)) || candidate.getAttribute("t") === "n" || !/[\p{L}]/u.test(value(candidate))) continue;
        write(candidate, parties[key] ?? "");
      }
    }
    if (edited) { zip.file(part.name, new XMLSerializer().serializeToString(document)); changed = true; }
  }
  return changed ? zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) : bytes;
}
