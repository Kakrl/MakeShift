import Link from "next/link";

type NavPage = "calibration" | "tutorial" | "about";

function CalibrationIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M12 2.5h2.5a1 1 0 0 1 1 1V6M15.5 12v2.5a1 1 0 0 1-1 1H12M6 15.5H3.5a1 1 0 0 1-1-1V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="9" r="2" fill="currentColor" />
    </svg>
  );
}

function TutorialIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2.25" y="3.25" width="13.5" height="11.5" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 6.75v4.5L11.25 9 7.5 6.75Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function AboutIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="6.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 8.25v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="5.75" r="0.95" fill="currentColor" />
    </svg>
  );
}

const TABS: { page: NavPage; href: string; label: string; Icon: () => React.JSX.Element }[] = [
  { page: "calibration", href: "/calibration", label: "Calibration", Icon: CalibrationIcon },
  { page: "tutorial", href: "/tutorial", label: "Tutorial", Icon: TutorialIcon },
  { page: "about", href: "/about", label: "About", Icon: AboutIcon },
];

// Each tab is a key on a small keybed. The current page stays pressed down.
const TAB_CLASS =
  "ms-key justify-center sm:justify-start gap-2.5 px-2 sm:px-3 lg:px-4 h-12 lg:h-[52px] text-[15px] lg:text-[16px] min-w-0";

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
    <div className="w-full lg:w-[267px] lg:pl-5 flex flex-col gap-4 shrink-0 mt-4 lg:mt-0">
      <nav aria-label="Main" className="ms-well p-1.5 grid grid-cols-3 lg:grid-cols-1 gap-1.5">
        {TABS.map(({ page, href, label, Icon }) => {
          const content = (
            <>
              <span className={`hidden sm:inline ${page === active ? "text-accent" : "text-ink-muted"}`}>
                <Icon />
              </span>
              <span className="truncate">{label}</span>
              {page === active && (
                <span aria-hidden="true" className="ml-auto hidden lg:block size-1.5 rounded-full bg-accent" />
              )}
            </>
          );
          if (page === active) {
            return (
              <div key={page} aria-current="page" className={TAB_CLASS}>
                {content}
              </div>
            );
          }
          if (page === "calibration" && onCalibrationClick) {
            return (
              <button key={page} onClick={onCalibrationClick} className={TAB_CLASS}>
                {content}
              </button>
            );
          }
          return (
            <Link key={page} href={href} className={TAB_CLASS}>
              {content}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
