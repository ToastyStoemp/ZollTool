/**
 * Predefined event/venue presets offered in the "create event" form
 * (see EventsView.vue). Selecting one pre-fills name, dates, currency and
 * venue fields. Empty for now — add entries as the recurring events are known.
 */

export interface EventPresetVenue {
  street?: string;
  postcode?: string;
  city?: string;
  country?: string;
  /** Tax identification number of the venue/organiser. */
  tin?: string;
}

export interface EventPreset {
  /** Stable id, used as the dropdown option value. */
  id: string;
  name: string;
  dateStart?: string;
  dateEnd?: string;
  currency: string;
  venue: EventPresetVenue;
}

export const EVENT_PRESETS: EventPreset[] = [];
