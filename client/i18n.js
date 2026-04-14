const LANGS = { sv, en };
const FALLBACK = 'sv';

let currentLang = FALLBACK;

// Translate a key, with optional positional substitutions t('key', val0, val1)
function t(key, ...args) {
    const str = LANGS[currentLang]?.[key] ?? LANGS[FALLBACK]?.[key] ?? key;
    return args.reduce((s, v, i) => s.replace(`{${i}}`, v), str);
}

// Return the months array for the current language
function tMonths() {
    return LANGS[currentLang]?.months ?? LANGS[FALLBACK].months;
}

function setLanguage(lang) {
    if (!LANGS[lang]) return;
    currentLang = lang;
    localStorage.setItem('lang', lang);
    applyStaticTranslations();
    if (typeof onLanguageChange === 'function') onLanguageChange();
}

function getCurrentLang() {
    return currentLang;
}

// Apply translations to elements with data-i18n attribute
function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
}

// Detect language: localStorage → browser → fallback
function detectLanguage() {
    const stored = localStorage.getItem('lang');
    if (stored && LANGS[stored]) return stored;
    const browser = (navigator.language || '').split('-')[0].toLowerCase();
    return LANGS[browser] ? browser : FALLBACK;
}

// Resolve a multilingual field (object or plain string) to the current language
function localize(field) {
    if (!field) return '';
    if (typeof field === 'string') return field;
    return field[currentLang] ?? field[FALLBACK] ?? Object.values(field)[0] ?? '';
}

// Init — call once after DOM is ready
function initI18n() {
    currentLang = detectLanguage();
    applyStaticTranslations();

    const picker = document.getElementById('langPicker');
    if (picker) {
        picker.value = currentLang;
        picker.addEventListener('change', () => setLanguage(picker.value));
    }
}
