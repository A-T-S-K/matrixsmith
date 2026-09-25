import type { FilesPort } from "../../application/ports/files";

export class BrowserFilesAdapter implements FilesPort {
  async copyText(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
      const copied = await navigator.clipboard.writeText(text).then(
        () => true,
        () => false,
      );
      if (copied) return true;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }

  download(filename: string, content: string, mimeType: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
