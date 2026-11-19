/**
 * One toast shown by `<Toaster />`. The kit keeps no toast state of its own: the app owns the list
 * (e.g. in an atom), passes it in, and removes a message when the toaster emits `dismiss`.
 */
export interface ToastMessage {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly variant?: "default" | "destructive";
  /** Milliseconds before the toast closes by itself; falls back to the toaster's `duration`. */
  readonly duration?: number;
  /**
   * One action on the toast, such as `Undo`: a button with this label. The toaster emits
   * `action` with the toast's id when it is pressed, and then `dismiss`.
   */
  readonly action?: string;
}
