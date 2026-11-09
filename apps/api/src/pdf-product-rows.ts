import type { TemplateFillPlan } from "./types.js";
import type { PdfTextPosition } from "./pdf-layout.js";

type Edit = TemplateFillPlan["pdfEdits"][number];
const references = (edit: Edit) => [...edit.text.matchAll(/\[\[line_(\d+)_(\w+)\]\]/g)];
const pattern = (edit: Edit) => edit.text.replace(/\[\[line_\d+_(\w+)\]\]/g, "[[$1]]");
const overlaps = (left: Pick<Edit,"x"|"y"|"width"|"height">,right: Pick<Edit,"x"|"y"|"width"|"height">) => left.x < right.x+right.width && left.x+left.width > right.x && left.y < right.y+right.height && left.y+left.height > right.y;

/** Extend an observed repeating row pattern only into proven empty space. */
export function expandPdfProductRows(plan: TemplateFillPlan, fields: Record<string,string>, indices: number[], pages: Array<{page:number;texts:PdfTextPosition[]}>): TemplateFillPlan {
  const groups = new Map<number,Edit[]>();
  for (const edit of plan.pdfEdits) {
    const keys = references(edit); const own = new Set(keys.map((key) => Number(key[1])));
    if (own.size !== 1 || !keys.length) continue;
    const index = [...own][0]!; const group = groups.get(index) ?? []; group.push(edit); groups.set(index,group);
  }
  const mapped = [...groups.keys()].sort((a,b)=>a-b);
  if (mapped.length < 2 || indices.every((index)=>groups.has(index))) return plan;
  const last = mapped[mapped.length-1]!; const previous = last-1;
  const before = groups.get(previous); const prototype = groups.get(last)!;
  if (!before || before.length !== prototype.length || prototype.some((edit)=>edit.page!==prototype[0]!.page)) return plan;
  const sourcePage = pages.find((page)=>page.page===prototype[0]!.page);
  if (!sourcePage || ![before,prototype].every((row)=>row.some((cell)=>sourcePage.texts.some((text)=>overlaps(cell,text))))) return plan;
  const pitches: number[] = [];
  for(const cell of prototype){
    const source=before.find((candidate)=>pattern(candidate)===pattern(cell)&&candidate.page===cell.page);
    if(!source||Math.abs(source.x-cell.x)>.5||Math.abs(source.height-cell.height)>.5)return plan;
    pitches.push(source.y-cell.y);
  }
  const pitch=pitches[0]!;
  if(!Number.isFinite(pitch)||pitch<=Math.max(...prototype.map((edit)=>edit.height))+1||pitches.some((value)=>Math.abs(value-pitch)>.5))return plan;
  const edits=[...plan.pdfEdits];
  for(const index of indices.filter((index)=>index>last)){
    const additions=prototype.map((cell)=>({...cell,y:cell.y-(index-last)*pitch,text:cell.text.replace(/\[\[line_\d+_(\w+)\]\]/g,(_match,key:string)=>`[[line_${index}_${key}]]`),erase:true}));
    if(additions.some((cell)=>cell.y<0||references(cell).some((key)=>!(`line_${key[1]}_${key[2]}` in fields))||edits.some((existing)=>existing.text&&existing.page===cell.page&&overlaps(cell,existing))||(pages.find((page)=>page.page===cell.page)?.texts??[]).some((text)=>overlaps(cell,text))))return plan;
    edits.push(...additions);
  }
  return {...plan,pdfEdits:edits};
}
