"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  MAX_SEARCH_LENGTH,
  OCTAVE_CHOICES,
  RECORDING_LIMITS,
  RECORDING_SORTS,
  type RecordingSort,
} from "../../lib/recordings";
import CopyLinkButton from "./CopyLinkButton";
import type { SongFilters } from "./songFilters";
import { shareUrl } from "./shareStore";

export function CloseIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The last step of every share: the link, Copy link and Done on the bottom edge. */
export function SharedConfirmation({ heading, shareId, onDone }: { heading: ReactNode; shareId: string; onDone: () => void }) {
  const url = shareUrl(shareId);
  return (
    <div className="flex flex-1 flex-col">
      {heading}
      <p className="mt-2 text-[15px] text-ink-muted leading-relaxed">
        It&apos;s in Shared songs, and anyone with this link can listen.
      </p>
      <p className="ms-well mt-4 px-3 py-2.5 text-[14px] break-all select-all">{url}</p>
      <div className="mt-auto flex shrink-0 gap-2 pt-5">
        <CopyLinkButton url={url} className="ms-key ms-key-primary flex-1 px-4 py-2.5 text-[15px]" />
        <button type="button" className="ms-key flex-1 px-4 py-2.5 text-[15px]" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Once the sharing name is set, the share forms just say it. */
export function SharingAs({ name }: { name: string }) {
  return (
    <p className="text-[14px] text-ink-muted">
      Shared as <span className="font-medium text-ink">{name}</span>. You can change it in My recordings.
    </p>
  );
}

/** The public name field the first share asks for. */
export function AuthorNameField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <label htmlFor={id} className="ms-label">Your name</label>
      <input
        id={id}
        value={value}
        maxLength={RECORDING_LIMITS.authorNameLength.max}
        placeholder="First name or nickname"
        onChange={(event) => onChange(event.target.value)}
        className="ms-input mt-1.5 w-full"
        autoComplete="nickname"
      />
      <p className="mt-1.5 text-[13px] text-ink-muted">Shown next to your song. Don&apos;t use your full name.</p>
    </>
  );
}

export function StarButton({
  title,
  favorite,
  onToggle,
  className = "",
}: {
  title: string;
  favorite: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={favorite}
      aria-label={`Favorite ${title}`}
      onClick={onToggle}
      className={`ms-key ms-key-ghost ms-key-icon size-9 shrink-0 ${favorite ? "text-ink" : "text-ink-muted"} ${className}`}
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill={favorite ? "currentColor" : "none"}>
        <path
          d="M9 2.2l2.0 4.2 4.6.6-3.4 3.2.9 4.6L9 12.5l-4.1 2.3.9-4.6L2.4 7l4.6-.6L9 2.2z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

const SORT_LABELS: Record<RecordingSort, string> = { newest: "Newest", oldest: "Oldest", longest: "Longest" };

/** Search, sort, octave size and favorites-only for either song list. */
export function SongControls({ filters, onChange }: { filters: SongFilters; onChange: (filters: SongFilters) => void }) {
  const [text, setText] = useState(filters.search);

  useEffect(() => {
    if (text === filters.search) return;
    const timer = setTimeout(() => onChange({ ...filters, search: text }), 250);
    return () => clearTimeout(timer);
  }, [text, filters, onChange]);

  return (
    <div role="search" aria-label="Find songs" className="mt-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[160px] flex-1">
        <input
          type="search"
          aria-label="Search songs by title"
          placeholder="Search songs"
          value={text}
          maxLength={MAX_SEARCH_LENGTH}
          onChange={(event) => setText(event.target.value)}
          className="ms-input w-full"
        />
      </div>
      <select
        aria-label="Sort songs"
        value={filters.sort}
        onChange={(event) => onChange({ ...filters, sort: event.target.value as RecordingSort })}
        className="ms-input"
      >
        {RECORDING_SORTS.map((sort) => (
          <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>
        ))}
      </select>
      <select
        aria-label="Fits a sheet of this many octaves or fewer"
        value={filters.maxOctaves}
        onChange={(event) => onChange({ ...filters, maxOctaves: Number(event.target.value) })}
        className="ms-input"
      >
        <option value={0}>Any size</option>
        {OCTAVE_CHOICES.map((octaves) => (
          <option key={octaves} value={octaves}>{octaves} {octaves === 1 ? "octave" : "octaves"} or fewer</option>
        ))}
      </select>
      <button
        type="button"
        aria-pressed={filters.favoritesOnly}
        className={`ms-key px-3 py-2 text-[14px] ${filters.favoritesOnly ? "ms-key-primary" : ""}`}
        onClick={() => onChange({ ...filters, favoritesOnly: !filters.favoritesOnly })}
      >
        Favorites only
      </button>
    </div>
  );
}
