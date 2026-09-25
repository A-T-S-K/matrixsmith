export interface FilesPort {
  copyText(text: string): Promise<boolean>;
  download(filename: string, content: string, mimeType: string): void;
}
