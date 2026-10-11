/**
 * Fixed-height strip above the camera, shared by every page with a camera
 * stage. Pages put different things here (status line, calibration stepper,
 * nothing), but the strip is always the same height, so the camera and the
 * side keys never jump when you switch pages. It spans the camera's width.
 */
export default function PageTopBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-14 shrink-0 flex-col justify-end pl-(--gutter-l) pr-(--gutter-r) pb-2">
      <div className="lg:mr-[267px]">{children}</div>
    </div>
  );
}
