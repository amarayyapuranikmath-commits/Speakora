import type { EnglishLevel } from './types'

export const LEVELS: { value: EnglishLevel; label: string; description: string }[] = [
  { value: 'A1', label: 'A1 · Beginner', description: 'I know basic words and simple phrases.' },
  { value: 'A2', label: 'A2 · Elementary', description: 'I can handle simple everyday conversations.' },
  { value: 'B1', label: 'B1 · Intermediate', description: 'I can talk about familiar topics, with some pauses.' },
  { value: 'B2', label: 'B2 · Upper intermediate', description: 'I can speak fairly fluently on many topics.' },
  { value: 'C1', label: 'C1 · Advanced', description: 'I can express myself fluently and precisely.' },
  { value: 'C2', label: 'C2 · Proficient', description: 'I speak with near-native ease.' },
]

export const LEVEL_LABEL: Record<EnglishLevel, string> = Object.fromEntries(
  LEVELS.map((l) => [l.value, l.label]),
) as Record<EnglishLevel, string>

export const GOALS: { value: string; label: string }[] = [
  { value: 'fluency', label: 'Speak more fluently' },
  { value: 'confidence', label: 'Build confidence' },
  { value: 'interviews', label: 'Prepare for interviews' },
  { value: 'work', label: 'Use English at work' },
  { value: 'travel', label: 'Travel' },
  { value: 'exams', label: 'Prepare for an exam' },
  { value: 'pronunciation', label: 'Improve pronunciation' },
  { value: 'vocabulary', label: 'Expand vocabulary' },
]

const COUNTRY_CODES =
  'AF AL DZ AD AO AR AM AU AT AZ BS BH BD BY BE BZ BJ BT BO BA BW BR BN BG BF BI KH CM CA CV CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MR MU MX MD MC MN ME MA MZ MM NA NP NL NZ NI NE NG MK NO OM PK PS PA PG PY PE PH PL PT PR QA RO RU RW SA SN RS SG SK SI SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TT TN TR TM UG UA AE GB US UY UZ VE VN YE ZM ZW'.split(
    ' ',
  )

const LANGUAGE_CODES =
  'ar bn zh cs da nl en fil fi fr de el gu he hi hu id it ja kn ko ms ml mr ne no fa pl pt pa ro ru sr si es sw sv ta te th tr uk ur vi'.split(
    ' ',
  )

function displayNames(type: 'region' | 'language', codes: string[]) {
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames(['en'], { type })
  } catch {
    // fall through: show the code itself
  }
  return codes
    .map((code) => ({ value: code, label: names?.of(code) ?? code }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export const COUNTRIES = displayNames('region', COUNTRY_CODES)
export const LANGUAGES = displayNames('language', LANGUAGE_CODES)

export function countryName(code: string | null | undefined): string {
  if (!code) return ''
  return COUNTRIES.find((c) => c.value === code.toUpperCase())?.label ?? code
}

export function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
}

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}
