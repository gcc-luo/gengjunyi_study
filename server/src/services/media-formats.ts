const MEDIA_TYPES = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  "3gp": "video/3gpp",
  flv: "video/x-flv",
  ts: "video/mp2t",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  ogv: "video/ogg",
} as const;

export const SUPPORTED_MEDIA_EXTENSIONS = Object.keys(MEDIA_TYPES);

export function mediaExtension(fileName: string): string | null {
  const match = /\.([^.]+)$/u.exec(fileName.trim());
  if (!match) return null;
  const extension = match[1].toLowerCase();
  return extension in MEDIA_TYPES ? extension : null;
}

export function mediaContentType(fileName: string): string | null {
  const extension = mediaExtension(fileName);
  return extension ? MEDIA_TYPES[extension as keyof typeof MEDIA_TYPES] : null;
}

export function titleFromMediaFileName(fileName: string): string {
  const extension = mediaExtension(fileName);
  const title = extension ? fileName.slice(0, -(extension.length + 1)) : fileName;
  return title.trim().slice(0, 200) || "Untitled video";
}
