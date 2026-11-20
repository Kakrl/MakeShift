// Synthetic encoded fixture for the production replay UI. Its timings are not
// physical labels; assertions check the decode/worker/scoring path only.
export async function visionReplayVideo(page, { emptyFile, pressFile, width, height }) {
  const bytes = await page.evaluate(async ({ emptyFile, pressFile, width, height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const load = async name => new ImageData(new Uint8ClampedArray(
      await (await fetch(`/vision-fixtures/${name}`)).arrayBuffer()), width, height);
    const empty = await load(emptyFile);
    const press = await load(pressFile);
    context.putImageData(empty, 0, 0);
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    try {
      for (const image of [empty, press, empty]) {
        for (let i = 0; i < 6; i++) {
          context.putImageData(image, 0, 0);
          track.requestFrame();
          await new Promise(resolve => setTimeout(resolve, 1000 / 12));
        }
      }
      recorder.stop();
      await stopped;
      return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
    } finally {
      if (recorder.state !== "inactive") recorder.stop();
      track.stop();
    }
  }, { emptyFile, pressFile, width, height });

  // MediaRecorder writes a streaming WebM without Duration. Insert the known
  // synthetic duration into Segment Info so HTMLVideoElement can seek the blob.
  const buffer = Buffer.from(bytes);
  const info = buffer.indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66]));
  if (info < 0) throw new Error("Recorded WebM is missing Segment Info");
  const sizeAt = info + 4;
  let sizeWidth = 1;
  while (!(buffer[sizeAt] & (0x80 >> (sizeWidth - 1)))) sizeWidth++;
  let size = buffer[sizeAt] & ((1 << (8 - sizeWidth)) - 1);
  for (let i = 1; i < sizeWidth; i++) size = size * 256 + buffer[sizeAt + i];
  const duration = Buffer.alloc(11);
  duration.set([0x44, 0x89, 0x88]);
  duration.writeDoubleBE(1500, 3); // TimecodeScale = 1 ms in Chromium MediaRecorder.
  const expanded = size + duration.length;
  if (expanded >= 2 ** (7 * sizeWidth) - 1) throw new Error("WebM Info size needs a wider encoding");
  let remaining = expanded;
  for (let i = sizeWidth - 1; i >= 0; i--) {
    buffer[sizeAt + i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  buffer[sizeAt] |= 0x80 >> (sizeWidth - 1);
  const end = sizeAt + sizeWidth + size;
  return Buffer.concat([buffer.subarray(0, end), duration, buffer.subarray(end)]);
}
