import PizZip from "pizzip";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";

const compatibilityNamespace = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";

function parsePart(xml: string, name: string): Document {
  try {
    const document = new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(xml, "application/xml");
    if (!document.documentElement) throw new Error("Missing root");
    return document;
  } catch {
    throw new Error(`File Office có XML không hợp lệ tại ${name}.`);
  }
}

function namespaceReferences(element: Element) {
  const prefixes = new Set<string>();
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.namespaceURI === compatibilityNamespace) {
      if (["Ignorable", "MustUnderstand"].includes(attribute.localName ?? "")) {
        attribute.value.split(/\s+/).filter(Boolean).forEach((prefix) => prefixes.add(prefix));
      } else if (["PreserveAttributes", "PreserveElements", "ProcessContent"].includes(attribute.localName ?? "")) {
        attribute.value.split(/\s+/).filter((name) => name.includes(":")).forEach((name) => prefixes.add(name.split(":")[0]!));
      }
    } else if (element.namespaceURI === compatibilityNamespace && element.localName === "Choice" && attribute.name === "Requires") {
      attribute.value.split(/\s+/).filter(Boolean).forEach((prefix) => prefixes.add(prefix));
    }
  }
  return prefixes;
}

/** XML serializers drop declarations used only inside mc:Ignorable/Requires values.
 * Restore those bindings from the actual template without serializing any other XML.
 */
export function restoreOfficeXmlNamespaces(originalBytes: Buffer, editedBytes: Buffer): Buffer {
  let original: PizZip;
  let edited: PizZip;
  try {
    original = new PizZip(originalBytes, { checkCRC32: true });
    edited = new PizZip(editedBytes, { checkCRC32: true });
  } catch {
    throw new Error("File Office xuất ra bị lỗi cấu trúc ZIP.");
  }
  if (!edited.file("[Content_Types].xml")) throw new Error("File Office xuất ra thiếu thông tin định dạng.");
  let changed = false;
  for (const [name, part] of Object.entries(edited.files)) {
    if (part.dir || !/\.(?:xml|rels)$/i.test(name)) continue;
    const xml = part.asText();
    const document = parsePart(xml, name);
    const missing = new Set<string>();
    for (const element of Array.from(document.getElementsByTagName("*"))) {
      for (const prefix of namespaceReferences(element)) {
        if (!element.lookupNamespaceURI(prefix)) missing.add(prefix);
      }
    }
    if (!missing.size) continue;
    const originalPart = original.file(name);
    const originalDocument = originalPart ? parsePart(originalPart.asText(), name) : null;
    const additions: string[] = [];
    for (const prefix of missing) {
      const namespaces = new Set<string>();
      if (originalDocument) {
        for (const element of Array.from(originalDocument.getElementsByTagName("*"))) {
          for (const attribute of Array.from(element.attributes)) {
            if (attribute.namespaceURI === xmlnsNamespace && attribute.localName === prefix) namespaces.add(attribute.value);
          }
        }
      }
      if (namespaces.size !== 1 || document.documentElement!.lookupNamespaceURI(prefix)) {
        throw new Error(`File Office thiếu khai báo XML ${prefix} tại ${name}; không thể khôi phục chắc chắn từ mẫu.`);
      }
      const uri = [...namespaces][0]!.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      additions.push(` xmlns:${prefix}="${uri}"`);
    }
    const rootTag = /<(?![!?/])[A-Za-z_][\w.:-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/.exec(xml);
    if (!rootTag || rootTag.index === undefined) throw new Error(`File Office thiếu thẻ XML gốc tại ${name}.`);
    const root = rootTag[0].replace(/(\s*\/?>)$/, `${additions.join("")}$1`);
    const restored = xml.slice(0, rootTag.index) + root + xml.slice(rootTag.index + rootTag[0].length);
    const verified = parsePart(restored, name);
    for (const element of Array.from(verified.getElementsByTagName("*"))) {
      for (const prefix of namespaceReferences(element)) {
        if (!element.lookupNamespaceURI(prefix)) throw new Error(`File Office vẫn thiếu khai báo XML ${prefix} tại ${name}.`);
      }
    }
    edited.file(name, restored);
    changed = true;
  }
  return changed ? edited.generate({ type: "nodebuffer", compression: "DEFLATE" }) : editedBytes;
}

/** Excel must rebuild its calculation graph after an external editor changes formulas. */
export function prepareEditedOfficeFile(originalBytes: Buffer, editedBytes: Buffer): Buffer {
  const restored = restoreOfficeXmlNamespaces(originalBytes, editedBytes);
  if (originalBytes.equals(editedBytes)) return restored;
  const zip = new PizZip(restored);
  const contentTypes = parsePart(zip.file("[Content_Types].xml")!.asText(), "[Content_Types].xml");
  const chainParts = new Set<string>();
  for (const element of Array.from(contentTypes.getElementsByTagName("*"))) {
    if (element.localName !== "Override" || !element.getAttribute("ContentType")?.endsWith(".calcChain+xml")) continue;
    const part = element.getAttribute("PartName");
    if (part) chainParts.add(part.replace(/^\//, ""));
    element.parentNode!.removeChild(element);
  }
  // A damaged editor result may retain the part without its content-type entry.
  if (zip.file("xl/calcChain.xml")) chainParts.add("xl/calcChain.xml");
  if (!chainParts.size) return restored;
  for (const part of chainParts) zip.remove(part);
  zip.file("[Content_Types].xml", new XMLSerializer().serializeToString(contentTypes));
  for (const [name, part] of Object.entries(zip.files)) {
    if (!/\.rels$/i.test(name)) continue;
    const document = parsePart(part.asText(), name);
    let changed = false;
    for (const relationship of Array.from(document.getElementsByTagName("*"))) {
      if (relationship.localName !== "Relationship" || !relationship.getAttribute("Type")?.endsWith("/calcChain")) continue;
      relationship.parentNode!.removeChild(relationship);
      changed = true;
    }
    if (changed) zip.file(name, new XMLSerializer().serializeToString(document));
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
