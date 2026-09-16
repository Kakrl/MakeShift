import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

export function drawHandLandmarks(
  context: CanvasRenderingContext2D,
  hands: NormalizedLandmark[][],
  canvasWidth: number,
  canvasHeight: number,
): void {
  context.strokeStyle = "#00ff88";
  context.fillStyle = "#ff3b30";
  context.lineWidth = 3;

  hands.forEach((hand) => {
    HAND_CONNECTIONS.forEach(([startIndex, endIndex]) => {
      const start = hand[startIndex];
      const end = hand[endIndex];

      context.beginPath();
      context.moveTo(start.x * canvasWidth, start.y * canvasHeight);
      context.lineTo(end.x * canvasWidth, end.y * canvasHeight);
      context.stroke();
    });

    hand.forEach((landmark) => {
      context.beginPath();
      context.arc(
        landmark.x * canvasWidth,
        landmark.y * canvasHeight,
        6,
        0,
        Math.PI * 2,
      );
      context.fill();
    });
  });
}
