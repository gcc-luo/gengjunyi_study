import { spawn } from "node:child_process";

export type MediaValidationResult =
  | { valid: true; durationMs: number; videoCodec: "h264"; audioCodec: "aac" }
  | { valid: false; reason: string };

type ProbeOutput = {
  format?: { format_name?: string; duration?: string; tags?: { major_brand?: string } };
  streams?: Array<{ codec_type?: string; codec_name?: string }>;
};

export function evaluateProbeOutput(output: ProbeOutput): MediaValidationResult {
  const formats = output.format?.format_name?.toLowerCase().split(",") ?? [];
  if (!formats.some((format) => format === "mp4" || format === "mov")) {
    return { valid: false, reason: "The uploaded file is not an MP4 video" };
  }
  if (output.format?.tags?.major_brand?.trim().toLowerCase() === "qt") {
    return { valid: false, reason: "The uploaded file is a QuickTime MOV, not an MP4 video" };
  }
  const video = output.streams?.find((stream) => stream.codec_type === "video");
  const audio = output.streams?.find((stream) => stream.codec_type === "audio");
  if (video?.codec_name?.toLowerCase() !== "h264") {
    return { valid: false, reason: "The video must use H.264 encoding" };
  }
  if (audio?.codec_name?.toLowerCase() !== "aac") {
    return { valid: false, reason: "The audio must use AAC encoding" };
  }
  const duration = Number(output.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { valid: false, reason: "The video duration could not be verified" };
  }
  if (duration * 1000 > 2_147_483_647) {
    return { valid: false, reason: "The video duration exceeds the supported limit" };
  }
  return {
    valid: true,
    durationMs: Math.max(1, Math.round(duration * 1000)),
    videoCodec: "h264",
    audioCodec: "aac",
  };
}

export async function validateMediaUrl(url: string): Promise<MediaValidationResult> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=format_name,duration:format_tags=major_brand:stream=codec_type,codec_name",
      "-of", "json",
      url,
    ], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let collectedBytes = 0;
    let settled = false;
    const finish = (result: MediaValidationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ valid: false, reason: "Video validation timed out" });
    }, 15 * 60 * 1000);
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      collectedBytes += chunk.length;
      if (collectedBytes > 1024 * 1024) {
        child.kill("SIGKILL");
        finish({ valid: false, reason: "Video metadata is too large to validate" });
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", () => finish({ valid: false, reason: "Video validation could not start" }));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish({ valid: false, reason: "The uploaded media could not be read" });
        return;
      }
      try {
        finish(evaluateProbeOutput(JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProbeOutput));
      } catch {
        finish({ valid: false, reason: "The uploaded media metadata is invalid" });
      }
    });
  });
}
