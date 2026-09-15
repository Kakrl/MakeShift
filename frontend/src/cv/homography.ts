import type { Point } from "./types";

export type Homography = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function solveLinearSystem(matrix: number[][]): number[] | null {
  const size = matrix.length;

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(matrix[pivot][column]) < 1e-10) return null;

    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];

    const pivotValue = matrix[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      matrix[column][entry] /= pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        matrix[row][entry] -= factor * matrix[column][entry];
      }
    }
  }

  return matrix.map((row) => row[size]);
}

export function computeHomography(
  source: Point[],
  target: Point[],
): Homography | null {
  if (source.length !== 4 || target.length !== 4) return null;

  const equations: number[][] = [];
  source.forEach((point, index) => {
    const destination = target[index];
    const { x, y } = point;
    const { x: u, y: v } = destination;

    equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    equations.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });

  const matrix = equations.map((equation) => [
    equation.slice(0, 8),
    equation[8],
  ]).map(([coefficients, value]) => [
    ...(coefficients as number[]),
    value as number,
  ]);
  const solution = solveLinearSystem(matrix);
  if (!solution) return null;

  return [
    solution[0],
    solution[1],
    solution[2],
    solution[3],
    solution[4],
    solution[5],
    solution[6],
    solution[7],
    1,
  ];
}

export function projectPoint(
  homography: Homography,
  point: Point,
): Point | null {
  const denominator =
    homography[6] * point.x + homography[7] * point.y + homography[8];
  if (Math.abs(denominator) < 1e-10) return null;

  return {
    x:
      (homography[0] * point.x +
        homography[1] * point.y +
        homography[2]) /
      denominator,
    y:
      (homography[3] * point.x +
        homography[4] * point.y +
        homography[5]) /
      denominator,
  };
}
