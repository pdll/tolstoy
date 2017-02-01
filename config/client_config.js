// sometimes it's impossible to use html tags to style coin name, hence usage of _UPPERCASE modifier
export const APP_NAME = 'БМ Платформа' // 'Steemit'
// sometimes APP_NAME is written in non-latin characters, but they are needed for technical purposes
// ie. "Голос" > "Golos"
export const APP_NAME_LATIN = 'BM Platform' // 'Steemit'
export const APP_NAME_UPPERCASE = 'BM PLATFORM' // 'STEEMIT'
export const APP_ICON = 'bmplatform' // 'steem'
export const APP_URL = 'feed.molodost.bz' // 'steemit.com'
export const LIQUID_TOKEN = 'Голос' // 'Steem'
// sometimes it's impossible to use html tags to style coin name, hence usage of _UPPERCASE modifier
export const LIQUID_TOKEN_UPPERCASE = 'ГОЛОС' // 'STEEM'
export const VESTING_TOKEN = 'Сила Голоса' // 'Steem Power'
export const INVEST_TOKEN_UPPERCASE = 'СИЛА ГОЛОСА' // 'STEEM POWER'
export const INVEST_TOKEN_SHORT = 'СГ' // 'SP'
export const DEBT_TOKEN = 'Золотой' // 'STEEM DOLLAR'
// export const DEBT_TOKEN_UPPERCASE = 'Golos Backed Gold' // 'STEEM DOLLAR'
export const CURRENCY_SIGN = '₽≈' // '$'
export const WIKI_URL = 'https://wiki.golos.io/'
export const LANDING_PAGE_URL = 'https://golos.io/ico'
export const TERMS_OF_SERVICE_URL = 'https://golos.io/legal/terms_of_service.pdf'
export const PRIVACY_POLICY_URL = 'https://golos.io/ru--konfidenczialxnostx/@golos/politika-konfidencialnosti'
export const WHITEPAPER_URL = 'https://golos.io/ru--golos/@golos/golos-russkoyazychnaya-socialno-mediinaya-blokchein-platforma'


// these are dealing with asset types, not displaying to client, rather sending data over websocket
export const LIQUID_TICKER = 'GOLOS'
export const VEST_TICKER = 'GESTS'
export const DEBT_TICKER = 'GBG'
export const DEBT_TOKEN_SHORT = 'GBG' // 'SD'

// application users
export const DEFAULT_LANGUAGE = 'ru' // 'en' // used on application internationalization bootstrap
export const DEFAULT_CURRENCY = 'руб'
export const ALLOWED_CURRENCIES = ['руб', 'гр.', 'BYN', '$', '€', 'CNY', 'GEL', 'KZT']
export const FRACTION_DIGITS = 0 // default amount of decimal digits
export const FRACTION_DIGITS_MARKET = 3 // accurate amount of deciaml digits (example: used in market)

// meta info
export const TWITTER_HANDLE = '@molodost_bz'
export const SHARE_IMAGE = 'http://molodost.bz/thumb/960_328_2/img/bbm/bitva_bm.jpg'
export const TWITTER_SHARE_IMAGE = 'http://molodost.bz/thumb/960_328_2/img/bbm/bitva_bm.jpg'
export const SITE_DESCRIPTION = 'Платформа БМ для достижения финансового результата в автоматическом режиме.'

// various
export const SUPPORT_EMAIL = 'gqkish@gmail.com'
export const SEGMENT_ANALYTICS_KEY = 'F7tldQJxt491gXYqDGi5TkTT4wFpSPps'
export const FIRST_DATE = new Date(Date.UTC(2016, 7, 1)); //1 september

export const POLK_OSIPOV = '@bm-bmtasks'
export const POLK_DASHKIEV = '@bmdfef8c9b77aa'
