import { describe, expect, it } from "vitest";
import { evaluateProbeOutput } from "../../src/services/media-validation";

describe("media validation", () => {
  it("accepts an MP4 container with H.264 video, AAC audio and positive duration", () => {
    expect(evaluateProbeOutput({
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.25", tags: { major_brand: "isom" } },
      streams: [
        { codec_type: "video", codec_name: "h264" },
        { codec_type: "audio", codec_name: "aac" },
      ],
    })).toEqual({ valid: true, durationMs: 3250, videoCodec: "h264", audioCodec: "aac" });
  });

  it.each([
    [{ format: { format_name: "matroska", duration: "3" }, streams: [] }, "MP4"],
    [{ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3", tags: { major_brand: "qt  " } }, streams: [{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: "aac" }] }, "QuickTime MOV"],
    [{ format: { format_name: "mp4", duration: "3" }, streams: [{ codec_type: "video", codec_name: "hevc" }] }, "H.264"],
    [{ format: { format_name: "mp4", duration: "3" }, streams: [{ codec_type: "video", codec_name: "h264" }] }, "AAC"],
    [{ format: { format_name: "mp4", duration: "0" }, streams: [{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: "aac" }] }, "duration"],
    [{ format: { format_name: "mp4", duration: "2147484" }, streams: [{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: "aac" }] }, "supported limit"],
  ])("rejects unsupported media with an understandable reason", (probe, phrase) => {
    const result = evaluateProbeOutput(probe as any);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain(phrase);
  });
});
