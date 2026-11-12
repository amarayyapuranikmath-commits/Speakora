// Static lists: Hermes on Android does not ship Intl.DisplayNames or Intl.supportedValuesOf.
import type { EnglishLevel } from './types'

export const LEVELS: { value: EnglishLevel; label: string; description: string }[] = [
  { value: 'A1', label: 'A1 · Beginner', description: 'Basic words and simple phrases.' },
  { value: 'A2', label: 'A2 · Elementary', description: 'Simple everyday conversations.' },
  { value: 'B1', label: 'B1 · Intermediate', description: 'Familiar topics, with some pauses.' },
  { value: 'B2', label: 'B2 · Upper intermediate', description: 'Fairly fluent on many topics.' },
  { value: 'C1', label: 'C1 · Advanced', description: 'Fluent and precise.' },
  { value: 'C2', label: 'C2 · Proficient', description: 'Near-native ease.' },
]
export const LEVEL_LABEL = Object.fromEntries(LEVELS.map((l) => [l.value, l.label])) as Record<EnglishLevel, string>

export const GOALS = [
  { value: 'fluency', label: 'Speak more fluently' },
  { value: 'confidence', label: 'Build confidence' },
  { value: 'interviews', label: 'Prepare for interviews' },
  { value: 'work', label: 'Use English at work' },
  { value: 'travel', label: 'Travel' },
  { value: 'exams', label: 'Prepare for an exam' },
  { value: 'pronunciation', label: 'Improve pronunciation' },
  { value: 'vocabulary', label: 'Expand vocabulary' },
]

const C = (code: string, name: string) => ({ value: code, label: name })
export const COUNTRIES = [
  C('AF', 'Afghanistan'), C('AL', 'Albania'), C('DZ', 'Algeria'), C('AR', 'Argentina'), C('AM', 'Armenia'), C('AU', 'Australia'), C('AT', 'Austria'),
  C('AZ', 'Azerbaijan'), C('BH', 'Bahrain'), C('BD', 'Bangladesh'), C('BY', 'Belarus'), C('BE', 'Belgium'), C('BO', 'Bolivia'), C('BA', 'Bosnia and Herzegovina'),
  C('BR', 'Brazil'), C('BG', 'Bulgaria'), C('KH', 'Cambodia'), C('CM', 'Cameroon'), C('CA', 'Canada'), C('CL', 'Chile'), C('CN', 'China'), C('CO', 'Colombia'),
  C('CR', 'Costa Rica'), C('HR', 'Croatia'), C('CU', 'Cuba'), C('CY', 'Cyprus'), C('CZ', 'Czechia'), C('DK', 'Denmark'), C('DO', 'Dominican Republic'),
  C('EC', 'Ecuador'), C('EG', 'Egypt'), C('SV', 'El Salvador'), C('EE', 'Estonia'), C('ET', 'Ethiopia'), C('FI', 'Finland'), C('FR', 'France'), C('GE', 'Georgia'),
  C('DE', 'Germany'), C('GH', 'Ghana'), C('GR', 'Greece'), C('GT', 'Guatemala'), C('HN', 'Honduras'), C('HK', 'Hong Kong'), C('HU', 'Hungary'), C('IS', 'Iceland'),
  C('IN', 'India'), C('ID', 'Indonesia'), C('IR', 'Iran'), C('IQ', 'Iraq'), C('IE', 'Ireland'), C('IL', 'Israel'), C('IT', 'Italy'), C('JM', 'Jamaica'),
  C('JP', 'Japan'), C('JO', 'Jordan'), C('KZ', 'Kazakhstan'), C('KE', 'Kenya'), C('KW', 'Kuwait'), C('KG', 'Kyrgyzstan'), C('LV', 'Latvia'), C('LB', 'Lebanon'),
  C('LT', 'Lithuania'), C('LU', 'Luxembourg'), C('MY', 'Malaysia'), C('MT', 'Malta'), C('MX', 'Mexico'), C('MD', 'Moldova'), C('MA', 'Morocco'), C('MM', 'Myanmar'),
  C('NP', 'Nepal'), C('NL', 'Netherlands'), C('NZ', 'New Zealand'), C('NI', 'Nicaragua'), C('NG', 'Nigeria'), C('MK', 'North Macedonia'), C('NO', 'Norway'),
  C('OM', 'Oman'), C('PK', 'Pakistan'), C('PS', 'Palestine'), C('PA', 'Panama'), C('PY', 'Paraguay'), C('PE', 'Peru'), C('PH', 'Philippines'), C('PL', 'Poland'),
  C('PT', 'Portugal'), C('PR', 'Puerto Rico'), C('QA', 'Qatar'), C('RO', 'Romania'), C('RU', 'Russia'), C('SA', 'Saudi Arabia'), C('SN', 'Senegal'), C('RS', 'Serbia'),
  C('SG', 'Singapore'), C('SK', 'Slovakia'), C('SI', 'Slovenia'), C('ZA', 'South Africa'), C('KR', 'South Korea'), C('ES', 'Spain'), C('LK', 'Sri Lanka'),
  C('SE', 'Sweden'), C('CH', 'Switzerland'), C('SY', 'Syria'), C('TW', 'Taiwan'), C('TZ', 'Tanzania'), C('TH', 'Thailand'), C('TN', 'Tunisia'), C('TR', 'Türkiye'),
  C('UG', 'Uganda'), C('UA', 'Ukraine'), C('AE', 'United Arab Emirates'), C('GB', 'United Kingdom'), C('US', 'United States'), C('UY', 'Uruguay'),
  C('UZ', 'Uzbekistan'), C('VE', 'Venezuela'), C('VN', 'Vietnam'), C('YE', 'Yemen'), C('ZM', 'Zambia'), C('ZW', 'Zimbabwe'),
]
export const countryName = (code?: string | null) => (code ? COUNTRIES.find((c) => c.value === code.toUpperCase())?.label ?? code : '')

export const LANGUAGES = [
  C('ar', 'Arabic'), C('bn', 'Bengali'), C('zh', 'Chinese'), C('cs', 'Czech'), C('da', 'Danish'), C('nl', 'Dutch'), C('en', 'English'), C('fil', 'Filipino'),
  C('fi', 'Finnish'), C('fr', 'French'), C('de', 'German'), C('el', 'Greek'), C('gu', 'Gujarati'), C('he', 'Hebrew'), C('hi', 'Hindi'), C('hu', 'Hungarian'),
  C('id', 'Indonesian'), C('it', 'Italian'), C('ja', 'Japanese'), C('kn', 'Kannada'), C('ko', 'Korean'), C('ms', 'Malay'), C('ml', 'Malayalam'), C('mr', 'Marathi'),
  C('ne', 'Nepali'), C('no', 'Norwegian'), C('fa', 'Persian'), C('pl', 'Polish'), C('pt', 'Portuguese'), C('pa', 'Punjabi'), C('ro', 'Romanian'), C('ru', 'Russian'),
  C('sr', 'Serbian'), C('si', 'Sinhala'), C('es', 'Spanish'), C('sw', 'Swahili'), C('sv', 'Swedish'), C('ta', 'Tamil'), C('te', 'Telugu'), C('th', 'Thai'),
  C('tr', 'Turkish'), C('uk', 'Ukrainian'), C('ur', 'Urdu'), C('vi', 'Vietnamese'),
]

const ZONES = [
  'UTC', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Warsaw',
  'Europe/Athens', 'Europe/Istanbul', 'Europe/Kyiv', 'Europe/Moscow', 'Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Nairobi', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Tehran', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Ho_Chi_Minh', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Manila', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland', 'America/St_Johns',
  'America/Halifax', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Mexico_City',
  'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Pacific/Honolulu',
]

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** The device's own zone first, then a curated list: enough for everyone to pick a correct one. */
export function timeZones(): { value: string; label: string }[] {
  const own = detectTimeZone()
  const all = ZONES.includes(own) ? ZONES : [own, ...ZONES]
  return all.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))
}
