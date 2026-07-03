/** 22 scheduled languages of India + English (interface default). */
export const APP_LOCALES = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'as', native: 'অসমীয়া', english: 'Assamese' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali' },
  { code: 'brx', native: 'बड़ो', english: 'Bodo' },
  { code: 'doi', native: 'डोगरी', english: 'Dogri' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ks', native: 'کٲشُر', english: 'Kashmiri' },
  { code: 'kok', native: 'कोंकणी', english: 'Konkani' },
  { code: 'mai', native: 'मैथिली', english: 'Maithili' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam' },
  { code: 'mni', native: 'মৈতৈলোন্', english: 'Manipuri' },
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'ne', native: 'नेपाली', english: 'Nepali' },
  { code: 'or', native: 'ଓଡ଼ିଆ', english: 'Odia' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
  { code: 'sa', native: 'संस्कृतम्', english: 'Sanskrit' },
  { code: 'sat', native: 'ᱥᱟᱱᱛᱟᱲᱤ', english: 'Santali' },
  { code: 'sd', native: 'سنڌي', english: 'Sindhi' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'ur', native: 'اردو', english: 'Urdu' },
] as const;

export type AppLocale = (typeof APP_LOCALES)[number]['code'];

export const APP_LOCALE_CODES: AppLocale[] = APP_LOCALES.map((l) => l.code);

export function getLocaleLabel(code: AppLocale, inEnglish = false): string {
  const item = APP_LOCALES.find((l) => l.code === code);
  if (!item) return code;
  return inEnglish ? item.english : item.native;
}
