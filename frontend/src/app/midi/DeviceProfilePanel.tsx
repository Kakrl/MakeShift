"use client";
import { useState, type FormEvent } from "react";
import {
  loadOrCreateProfile,
  saveProfile,
  isValidDisplayName,
} from "../../lib/deviceProfile";
import { RECORDING_LIMITS } from "../../lib/recordings";

export default function DeviceProfilePanel() {
  const [initial] = useState(() => loadOrCreateProfile());
  const [profile, setProfile] = useState(initial.profile);
  const [name, setName] = useState(initial.profile.displayName);
  const [message, setMessage] = useState(
    initial.result.ok
      ? ""
      : "Your device profile could not be saved. Try saving your name again.",
  );
  const [error, setError] = useState(!initial.result.ok);

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = { ...profile, displayName: name.trim() };
    const result = saveProfile(next);
    setError(!result.ok);
    if (!result.ok) {
      setMessage("Your profile could not be saved. Try again.");
      return;
    }
    setProfile(next);
    setName(next.displayName);
    setMessage("Sharing name saved.");
  }

  return (
    <section aria-labelledby="profile-heading" className="w-full text-ink">
      <h2 id="profile-heading" className="font-medium">
        Sharing name
      </h2>
      <p className="text-sm">Choose the name shown on recordings you upload.</p>
      <form onSubmit={handleSave}>
        <label htmlFor="display-name">Display name</label>
        <input
          id="display-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby="display-name-help"
          className="w-full border border-control-border bg-white text-ink"
        />
        <p id="display-name-help" className="text-sm">
          1-{RECORDING_LIMITS.authorNameLength.max} characters.
        </p>
        <button
          type="submit"
          disabled={!isValidDisplayName(name)}
          className="underline"
        >
          Save sharing name
        </button>
      </form>
      {message && (
        <p
          role={error ? "alert" : "status"}
          className={error ? "text-danger" : "text-ink"}
        >
          {message}
        </p>
      )}
    </section>
  );
}
