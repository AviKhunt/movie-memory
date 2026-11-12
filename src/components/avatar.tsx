"use client";

import { useState } from "react";

type AvatarProps = {
  src: string | null;
  label: string; // used for the initial when there's no photo
};

// falls back to an initial if the photo is missing or fails to load
export function Avatar({ src, label }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const initial = label.trim().charAt(0).toUpperCase() || "?";

  if (!src || failed) {
    return (
      <div
        aria-hidden="true"
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-marquee font-display text-2xl font-semibold text-ink"
      >
        {initial}
      </div>
    );
  }

  return (
    // plain <img> so I don't have to allow-list google's image hosts
    // for next/image. it's a 64px avatar.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={64}
      height={64}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-16 w-16 shrink-0 rounded-full object-cover"
    />
  );
}
