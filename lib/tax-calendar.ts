/**
 * The one rule every tax door on the dashboard follows (owner's TAX-7 answer):
 * "wait" from 30 days before the date, "stop" from 7 days before and once it
 * has passed. The Juneau sales-tax door (lib/sales-tax taxReminder) uses it
 * today; the federal-estimate and property-return doors use it too, so the
 * doors never drift apart. No imports: callers count the days themselves.
 *
 * Which date a door counts to is the caller's call, and each one says so: the
 * sales-tax door counts to the OFFICIAL due date (the city counts the day it
 * receives a return, so the weekend grace day is named, never aimed at).
 */

export type ReminderEdge = 'wait' | 'stop'

/** A door appears this many days before its date… */
export const REMINDER_WAIT_DAYS = 30
/** …and turns red this many days before it, staying red once the date has passed. */
export const REMINDER_STOP_DAYS = 7

/**
 * The door's edge for `daysLeft` (whole days from today to the date the door
 * counts to; negative once it has passed), or null while it is further out
 * than REMINDER_WAIT_DAYS and the door stays away.
 */
export function reminderEdge(daysLeft: number): ReminderEdge | null {
  if (daysLeft > REMINDER_WAIT_DAYS) return null
  return daysLeft <= REMINDER_STOP_DAYS ? 'stop' : 'wait'
}
