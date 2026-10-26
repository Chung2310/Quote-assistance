import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function convertPdfToWord(pdf: Buffer): Promise<Buffer> {
  if (process.platform !== "win32") throw new Error("Chuyển mẫu PDF nghiệm thu sang Word cần Microsoft Word trên máy chủ.");
  const directory = await mkdtemp(join(tmpdir(), "bao-gia-acceptance-word-"));
  const source = join(directory, "acceptance.pdf");
  const target = join(directory, "acceptance.docx");
  const script = join(directory, "convert.ps1");
  try {
    await writeFile(source, pdf);
    await writeFile(script, [
      "param([string]$SourcePath, [string]$TargetPath)",
      "$ErrorActionPreference = 'Stop'",
      "$word = $null",
      "$document = $null",
      "try {",
      "  $word = New-Object -ComObject Word.Application",
      "  $word.Visible = $false",
      "  $word.DisplayAlerts = 0",
      "  $document = $word.Documents.Open($SourcePath, $false, $true)",
      "  $document.SaveAs2($TargetPath, 16)",
      "} finally {",
      "  if ($document -ne $null) { $document.Close() }",
      "  if ($word -ne $null) { $word.Quit() }",
      "}",
    ].join("\r\n"), "utf8");
    await execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", script, source, target], {
      windowsHide: true, timeout: 120_000, maxBuffer: 1_000_000,
    });
    return await readFile(target);
  } catch {
    throw new Error("Không chuyển được biên bản PDF sang Word. Hãy kiểm tra Microsoft Word trên máy chủ.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
