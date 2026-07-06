/** 22 scheduled languages of India + English (interface default). */
export declare const APP_LOCALES: readonly [{
    readonly code: "en";
    readonly native: "English";
    readonly english: "English";
}, {
    readonly code: "as";
    readonly native: "অসমীয়া";
    readonly english: "Assamese";
}, {
    readonly code: "bn";
    readonly native: "বাংলা";
    readonly english: "Bengali";
}, {
    readonly code: "brx";
    readonly native: "बड़ो";
    readonly english: "Bodo";
}, {
    readonly code: "doi";
    readonly native: "डोगरी";
    readonly english: "Dogri";
}, {
    readonly code: "gu";
    readonly native: "ગુજરાતી";
    readonly english: "Gujarati";
}, {
    readonly code: "hi";
    readonly native: "हिन्दी";
    readonly english: "Hindi";
}, {
    readonly code: "kn";
    readonly native: "ಕನ್ನಡ";
    readonly english: "Kannada";
}, {
    readonly code: "ks";
    readonly native: "کٲشُر";
    readonly english: "Kashmiri";
}, {
    readonly code: "kok";
    readonly native: "कोंकणी";
    readonly english: "Konkani";
}, {
    readonly code: "mai";
    readonly native: "मैथिली";
    readonly english: "Maithili";
}, {
    readonly code: "ml";
    readonly native: "മലയാളം";
    readonly english: "Malayalam";
}, {
    readonly code: "mni";
    readonly native: "মৈতৈলোন্";
    readonly english: "Manipuri";
}, {
    readonly code: "mr";
    readonly native: "मराठी";
    readonly english: "Marathi";
}, {
    readonly code: "ne";
    readonly native: "नेपाली";
    readonly english: "Nepali";
}, {
    readonly code: "or";
    readonly native: "ଓଡ଼ିଆ";
    readonly english: "Odia";
}, {
    readonly code: "pa";
    readonly native: "ਪੰਜਾਬੀ";
    readonly english: "Punjabi";
}, {
    readonly code: "sa";
    readonly native: "संस्कृतम्";
    readonly english: "Sanskrit";
}, {
    readonly code: "sat";
    readonly native: "ᱥᱟᱱᱛᱟᱲᱤ";
    readonly english: "Santali";
}, {
    readonly code: "sd";
    readonly native: "سنڌي";
    readonly english: "Sindhi";
}, {
    readonly code: "ta";
    readonly native: "தமிழ்";
    readonly english: "Tamil";
}, {
    readonly code: "te";
    readonly native: "తెలుగు";
    readonly english: "Telugu";
}, {
    readonly code: "ur";
    readonly native: "اردو";
    readonly english: "Urdu";
}];
export type AppLocale = (typeof APP_LOCALES)[number]['code'];
export declare const APP_LOCALE_CODES: AppLocale[];
export declare function getLocaleLabel(code: AppLocale, inEnglish?: boolean): string;
