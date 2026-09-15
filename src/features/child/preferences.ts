export const EYE_CARE_STORAGE_KEY = 'family-learning-app:eye-care';
export const EYE_CARE_EVENT = 'family-learning-app:eye-care-change';

export function readEyeCarePreference(): boolean {
  return window.localStorage.getItem(EYE_CARE_STORAGE_KEY) === 'true';
}

export function writeEyeCarePreference(enabled: boolean): void {
  window.localStorage.setItem(EYE_CARE_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event(EYE_CARE_EVENT));
}
