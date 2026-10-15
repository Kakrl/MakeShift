"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  loadOrCreateProfile,
  saveProfile,
  isValidDisplayName,
  PROFILE_CHANGE_EVENT,
  type DeviceProfile,
} from "../../lib/deviceProfile";
import { RECORDING_LIMITS } from "../../lib/recordings";

/**
 * The name shown on songs you share. It reads as one line until you edit
 * it; the share forms use and update the same profile.
 */
export default function DeviceProfilePanel() {
  const [initial] = useState(() => loadOrCreateProfile());
  const [profile, setProfile] = useState(initial.profile);
  const [name, setName] = useState(initial.profile.displayName);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(
    initial.result.ok
      ? ""
      : "Your device profile could not be saved. Try saving your name again.",
  );
  const [error, setError] = useState(!initial.result.ok);

  // Sharing a song with a new name updates this line as well.
  useEffect(() => {
    const changed = (event: Event) => {
      const next = (event as CustomEvent<DeviceProfile>).detail;
      setProfile(next);
      setName(next.displayName);
    };
    window.addEventListener(PROFILE_CHANGE_EVENT, changed);
    return () => window.removeEventListener(PROFILE_CHANGE_EVENT, changed);
  }, []);

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = { ...profile, displayName: name.trim() };
    const result = saveProfile(next);
    setError(!result.ok);
    if (!result.ok) {
      setMessage("Your profile could not be saved. Try again.");
      return;
    }
    setProfile(result.profile);
    setName(result.profile.displayName);
    setEditing(false);
    setMessage("Sharing name saved.");
  }

  function cancel() {
    setName(profile.displayName);
    setEditing(false);
  }

  return (
    <section aria-labelledby="profile-heading" className="mb-6 w-full text-ink">
      <h2 id="profile-heading" className="ms-label mb-1.5">
        Sharing name
      </h2>
      {editing ? (
        <form onSubmit={handleSave} className="ms-rise">
          <label htmlFor="display-name" className="sr-only">
            Display name
          </label>
          <input
            id="display-name"
            value={name}
            maxLength={RECORDING_LIMITS.authorNameLength.max}
            placeholder="First name or nickname"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                cancel();
              }
            }}
            aria-describedby="display-name-help"
            autoComplete="nickname"
            className="ms-input w-full"
            autoFocus
          />
          <p id="display-name-help" className="mt-1.5 text-[13px] text-ink-muted">
            Shown on songs you share. Don&apos;t use your full name.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="submit"
              disabled={!isValidDisplayName(name)}
              aria-label="Save sharing name"
              className="ms-key ms-key-primary flex-1 px-3 py-2 text-[14px]"
            >
              Save
            </button>
            <button type="button" className="ms-key flex-1 px-3 py-2 text-[14px]" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-[13px] text-ink-muted">
            {profile.displayName ? (
              <>
                Sharing as{" "}
                <span className="font-medium text-ink break-words">{profile.displayName}</span>
              </>
            ) : (
              "Not set yet"
            )}
          </p>
          <button
            type="button"
            className="ms-key ms-key-ghost -mr-2 shrink-0 px-2 py-1 text-[13px]"
            onClick={() => {
              setMessage("");
              setEditing(true);
            }}
          >
            {profile.displayName ? "Edit" : "Set name"}
          </button>
        </div>
      )}
      {message && (
        <p
          role={error ? "alert" : "status"}
          // Success is read out only; the line above already shows the name.
          className={error ? "mt-1.5 text-[13px] text-danger" : "sr-only"}
        >
          {message}
        </p>
      )}
    </section>
  );
}
