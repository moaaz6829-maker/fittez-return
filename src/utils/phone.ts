import { parsePhoneNumberFromString, CountryCode } from "libphonenumber-js";

/**
 * Section 4 + finalized decision "INTERNATIONAL PHONE NUMBERS":
 *
 * - Egyptian numbers: 01XXXXXXXXX / 201XXXXXXXXX / +201XXXXXXXXX (with
 *   spaces/hyphens/parentheses) must all normalize to the same canonical
 *   E.164 value: +201XXXXXXXXX.
 * - Non-Egyptian numbers must NEVER be coerced into an Egyptian number.
 *   They are normalized to their own E.164 form using their real country
 *   code, defaulting the parse hint to Egypt only as a last resort for
 *   ambiguous local-format input (i.e. no leading + and no country code).
 */

export interface PhoneNormalizationResult {
  ok: boolean;
  e164?: string; // canonical form, e.g. +201001234567 or +971501234567
  country?: CountryCode;
  raw: string;
}

export function normalizePhoneNumber(rawInput: string): PhoneNormalizationResult {
  const raw = rawInput ?? "";

  // Strip spaces, hyphens, parentheses. Keep leading + and digits only.
  const cleaned = raw.replace(/[\s\-()]/g, "");

  if (!cleaned) {
    return { ok: false, raw };
  }

  // Case 1: already has an explicit country code (+...).
  if (cleaned.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(cleaned);
    if (parsed?.isValid()) {
      return { ok: true, e164: parsed.number, country: parsed.country, raw };
    }
    return { ok: false, raw };
  }

  // Case 2: Egyptian local mobile format, e.g. 01001234567 (11 digits, starts with 01)
  if (/^01\d{9}$/.test(cleaned)) {
    const parsed = parsePhoneNumberFromString(cleaned, "EG" as CountryCode);
    if (parsed?.isValid()) {
      return { ok: true, e164: parsed.number, country: "EG", raw };
    }
  }

  // Case 3: Egyptian number without leading zero but with country code
  // digits only, e.g. 201001234567 (no +).
  if (/^201\d{9}$/.test(cleaned)) {
    const parsed = parsePhoneNumberFromString(`+${cleaned}`);
    if (parsed?.isValid()) {
      return { ok: true, e164: parsed.number, country: parsed.country, raw };
    }
  }

  // Case 4: bare national-format digits for some other country was
  // provided without a + or country code. We do NOT guess a foreign
  // country here (that would risk silently misparsing a valid Egyptian
  // number as something else, or vice versa) -- treat as invalid and let
  // the caller surface a validation error asking for the full number.
  return { ok: false, raw };
}

/**
 * Two phone numbers are considered the same customer identity if their
 * normalized E.164 forms match exactly. Never compares raw strings.
 */
export function phoneNumbersMatch(a: string, b: string): boolean {
  const na = normalizePhoneNumber(a);
  const nb = normalizePhoneNumber(b);
  if (!na.ok || !nb.ok) return false;
  return na.e164 === nb.e164;
}
