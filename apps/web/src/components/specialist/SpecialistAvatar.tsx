/**
 * A specialist's photo, with a letter-tile fallback — shared by the profile
 * header, circle mentor strips and the experts list so an avatar looks the
 * same everywhere. Photos are provider-supplied (identity layer `photoUrl`),
 * uploaded to the BFF's uploads volume, so they're same-origin URLs.
 */
export default function SpecialistAvatar({
  label,
  photoUrl,
  size = 32,
  rounded = "rounded-xl",
}: {
  label: string;
  photoUrl?: string;
  size?: number;
  rounded?: string;
}) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={label}
        width={size}
        height={size}
        className={`${rounded} shrink-0 object-cover`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${rounded} grid shrink-0 place-items-center font-extrabold`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.42)),
        background: "var(--color-accent-soft)",
        color: "var(--color-accent)",
        fontFamily: "var(--font-display)",
      }}
    >
      {label.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
