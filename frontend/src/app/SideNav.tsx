import Link from "next/link";

type NavPage = "calibration" | "tutorial" | "about";

const TABS: { page: NavPage; href: string; label: string }[] = [
  { page: "calibration", href: "/calibration", label: "Calibration" },
  { page: "tutorial", href: "/tutorial", label: "Tutorial" },
  { page: "about", href: "/about", label: "About" },
];

// Below lg the tabs sit in a row under the camera; from lg up they stack in
// the 267px right sidebar with the piano-key decoration.
const TAB_CLASS =
  "flex-1 lg:flex-none border border-black h-12 lg:h-[72px] flex items-center justify-center lg:justify-end px-2 lg:pr-[19px] lg:pl-[100px] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] " +
  "not-first:-ml-px lg:not-first:ml-0 lg:not-first:-mt-px first:rounded-bl-[8px] last:rounded-br-[8px] lg:first:rounded-bl-none lg:first:rounded-tr-[8px]";

export default function SideNav({
  active,
  onCalibrationClick,
  children,
}: {
  active?: NavPage;
  /** Replaces the Calibration link with a button (home page). */
  onCalibrationClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="w-full lg:w-[267px] relative flex flex-col shrink-0">
      {/* Piano key bars */}
      <div className="hidden lg:flex absolute left-0 top-[50px] flex-col gap-[24px] z-10 pointer-events-none">
        <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
        <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
      </div>

      {/* Nav tabs */}
      <nav aria-label="Main" className="flex flex-row lg:flex-col">
        {TABS.map(({ page, href, label }) => {
          const text = (
            <span className="text-[17px] lg:text-[20px] text-black font-sans whitespace-nowrap">{label}</span>
          );
          if (page === active) {
            return (
              <div key={page} aria-current="page" className={`${TAB_CLASS} bg-accent-soft`}>
                {text}
              </div>
            );
          }
          const className = `${TAB_CLASS} bg-surface hover:bg-black/5 transition-colors`;
          if (page === "calibration" && onCalibrationClick) {
            return (
              <button key={page} onClick={onCalibrationClick} className={className}>
                {text}
              </button>
            );
          }
          return (
            <Link key={page} href={href} className={className}>
              {text}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
