import chatWorkspaceBackground from '../../../../assets/ui-pic.png'

/**
 * The chat canvas is intentionally separate from the thread so messages,
 * dialogs, and the composer can remain interactive above the supplied artwork.
 */
export function Backdrop() {
  return (
    <div
      aria-hidden
      className="maliang-chat-backdrop pointer-events-none absolute inset-0 -z-10"
      style={{ backgroundImage: `url(${chatWorkspaceBackground})` }}
    />
  )
}