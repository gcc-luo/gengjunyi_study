import { describe, expect, it } from "vitest";
import { buildFfmpegArguments, buildThumbnailFfmpegArguments, overallProcessingProgress } from "../../src/services/media-transcoding";

describe("media transcoding", () => {
  it("builds a browser-compatible H.264/AAC MP4 command", () => {
    const args = buildFfmpegArguments({
      inputUrl: "http://minio/source.mov",
      outputPath: "/tmp/output.mp4",
      hasAudio: true,
    });

    expect(args).toEqual(expect.arrayContaining([
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-progress", "pipe:1",
    ]));
    expect(args.at(-1)).toBe("/tmp/output.mp4");
  });

  it("adds a silent AAC track when the source has no audio", () => {
    const args = buildFfmpegArguments({
      inputUrl: "http://minio/source.avi",
      outputPath: "/tmp/output.mp4",
      hasAudio: false,
    });

    expect(args).toEqual(expect.arrayContaining(["anullsrc=channel_layout=stereo:sample_rate=48000", "-shortest"]));
  });

  it("captures a compact JPEG thumbnail from the first video frame", () => {
    const args = buildThumbnailFfmpegArguments({
      inputPath: "/tmp/output.mp4",
      outputPath: "/tmp/thumbnail.jpg",
    });

    expect(args).toEqual(expect.arrayContaining([
      "-i", "/tmp/output.mp4",
      "-frames:v", "1",
      "-vf", "scale=320:-2",
      "-q:v", "4",
    ]));
    expect(args.at(-1)).toBe("/tmp/thumbnail.jpg");
  });

  it("maps transcoding percentage into the combined upload-and-processing progress", () => {
    expect(overallProcessingProgress("QUEUED", 0)).toBe(72);
    expect(overallProcessingProgress("TRANSCODING", 50)).toBe(85);
    expect(overallProcessingProgress("VERIFYING", 100)).toBe(97);
    expect(overallProcessingProgress("COMPLETE", 100)).toBe(100);
  });
});
