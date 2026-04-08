/**
 * ZollTool — Swiss Customs Declaration Tool
 * app.js
 *
 * Vanilla JS, no dependencies.
 * Works via file:// protocol.
 */

'use strict';

/* =========================================================
   HS CODE DATABASE
   ========================================================= */
const HS_CODES = [
  { code: '4911.91.00', desc: 'Art prints, posters, pictures',                   rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '4909.00.00', desc: 'Printed postcards, greeting cards',                rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '4910.00.00', desc: 'Calendars, printed',                               rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '4901.99.00', desc: 'Books, brochures, pamphlets',                      rate: 2.6, vatRate: 2.6, permit: 0 },
  { code: '4820.10.00', desc: 'Notebooks, albums, planners',                      rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '3919.90.00', desc: 'Stickers, self-adhesive plastic labels',           rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '4821.10.00', desc: 'Self-adhesive paper labels',                       rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '4202.22.00', desc: 'Handbags, tote bags (outer surface textile)',      rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '4202.22.10', desc: 'Handbags (outer surface leather)',                 rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '4202.32.00', desc: 'Wallets, purses, key pouches',                    rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '4202.92.00', desc: 'Other bags and cases',                             rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '7117.19.00', desc: 'Imitation jewellery, enamel pins, badges',        rate: 8.1, vatRate: 8.1, permit: 2 },
  { code: '3926.90.00', desc: 'Other plastic articles, keychains, figures',      rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '3926.40.00', desc: 'Statuettes, decorative articles of plastic',      rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '4016.92.00', desc: 'Floor coverings and mats of rubber, desk mats',   rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '6109.10.00', desc: 'T-shirts, singlets of cotton',                    rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '6109.90.00', desc: 'T-shirts, singlets of other textile',             rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '9503.00.00', desc: 'Toys, puzzles, games',                            rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '6301.40.00', desc: 'Blankets and throws',                             rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '6912.00.00', desc: 'Ceramic tableware, mugs',                         rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '6913.90.00', desc: 'Ceramic statuettes and ornaments',                rate: 8.1, vatRate: 8.1, permit: 0 },
  { code: '8306.29.00', desc: 'Statuettes, trophies, medals of base metal',      rate: 8.1, vatRate: 8.1, permit: 0 },
];

const COUNTRIES = [
  { code: 'AF', name: 'Afghanistan' },
  { code: 'AL', name: 'Albania' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'AD', name: 'Andorra' },
  { code: 'AO', name: 'Angola' },
  { code: 'AG', name: 'Antigua and Barbuda' },
  { code: 'AR', name: 'Argentina' },
  { code: 'AM', name: 'Armenia' },
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'AZ', name: 'Azerbaijan' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BB', name: 'Barbados' },
  { code: 'BY', name: 'Belarus' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BZ', name: 'Belize' },
  { code: 'BJ', name: 'Benin' },
  { code: 'BT', name: 'Bhutan' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'BA', name: 'Bosnia and Herzegovina' },
  { code: 'BW', name: 'Botswana' },
  { code: 'BR', name: 'Brazil' },
  { code: 'BN', name: 'Brunei' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' },
  { code: 'CV', name: 'Cabo Verde' },
  { code: 'KH', name: 'Cambodia' },
  { code: 'CM', name: 'Cameroon' },
  { code: 'CA', name: 'Canada' },
  { code: 'CF', name: 'Central African Republic' },
  { code: 'TD', name: 'Chad' },
  { code: 'CL', name: 'Chile' },
  { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' },
  { code: 'KM', name: 'Comoros' },
  { code: 'CG', name: 'Congo' },
  { code: 'CD', name: 'Congo (DR)' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'CI', name: 'Côte d\'Ivoire' },
  { code: 'HR', name: 'Croatia' },
  { code: 'CU', name: 'Cuba' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'DK', name: 'Denmark' },
  { code: 'DJ', name: 'Djibouti' },
  { code: 'DM', name: 'Dominica' },
  { code: 'DO', name: 'Dominican Republic' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'EG', name: 'Egypt' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'GQ', name: 'Equatorial Guinea' },
  { code: 'ER', name: 'Eritrea' },
  { code: 'EE', name: 'Estonia' },
  { code: 'SZ', name: 'Eswatini' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'FJ', name: 'Fiji' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GA', name: 'Gabon' },
  { code: 'GM', name: 'Gambia' },
  { code: 'GE', name: 'Georgia' },
  { code: 'DE', name: 'Germany' },
  { code: 'GH', name: 'Ghana' },
  { code: 'GR', name: 'Greece' },
  { code: 'GD', name: 'Grenada' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'GN', name: 'Guinea' },
  { code: 'GW', name: 'Guinea-Bissau' },
  { code: 'GY', name: 'Guyana' },
  { code: 'HT', name: 'Haiti' },
  { code: 'HN', name: 'Honduras' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IS', name: 'Iceland' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IR', name: 'Iran' },
  { code: 'IQ', name: 'Iraq' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'JP', name: 'Japan' },
  { code: 'JO', name: 'Jordan' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KI', name: 'Kiribati' },
  { code: 'KP', name: 'Korea (North)' },
  { code: 'KR', name: 'Korea (South)' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'KG', name: 'Kyrgyzstan' },
  { code: 'LA', name: 'Laos' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'LS', name: 'Lesotho' },
  { code: 'LR', name: 'Liberia' },
  { code: 'LY', name: 'Libya' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MG', name: 'Madagascar' },
  { code: 'MW', name: 'Malawi' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MV', name: 'Maldives' },
  { code: 'ML', name: 'Mali' },
  { code: 'MT', name: 'Malta' },
  { code: 'MH', name: 'Marshall Islands' },
  { code: 'MR', name: 'Mauritania' },
  { code: 'MU', name: 'Mauritius' },
  { code: 'MX', name: 'Mexico' },
  { code: 'FM', name: 'Micronesia' },
  { code: 'MD', name: 'Moldova' },
  { code: 'MC', name: 'Monaco' },
  { code: 'MN', name: 'Mongolia' },
  { code: 'ME', name: 'Montenegro' },
  { code: 'MA', name: 'Morocco' },
  { code: 'MZ', name: 'Mozambique' },
  { code: 'MM', name: 'Myanmar' },
  { code: 'NA', name: 'Namibia' },
  { code: 'NR', name: 'Nauru' },
  { code: 'NP', name: 'Nepal' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'NE', name: 'Niger' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'MK', name: 'North Macedonia' },
  { code: 'NO', name: 'Norway' },
  { code: 'OM', name: 'Oman' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PW', name: 'Palau' },
  { code: 'PS', name: 'Palestine' },
  { code: 'PA', name: 'Panama' },
  { code: 'PG', name: 'Papua New Guinea' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' },
  { code: 'RO', name: 'Romania' },
  { code: 'RU', name: 'Russia' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'KN', name: 'Saint Kitts and Nevis' },
  { code: 'LC', name: 'Saint Lucia' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines' },
  { code: 'WS', name: 'Samoa' },
  { code: 'SM', name: 'San Marino' },
  { code: 'ST', name: 'São Tomé and Príncipe' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SN', name: 'Senegal' },
  { code: 'RS', name: 'Serbia' },
  { code: 'SC', name: 'Seychelles' },
  { code: 'SL', name: 'Sierra Leone' },
  { code: 'SG', name: 'Singapore' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'SB', name: 'Solomon Islands' },
  { code: 'SO', name: 'Somalia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'SS', name: 'South Sudan' },
  { code: 'ES', name: 'Spain' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SD', name: 'Sudan' },
  { code: 'SR', name: 'Suriname' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SY', name: 'Syria' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TJ', name: 'Tajikistan' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TL', name: 'Timor-Leste' },
  { code: 'TG', name: 'Togo' },
  { code: 'TO', name: 'Tonga' },
  { code: 'TT', name: 'Trinidad and Tobago' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'TR', name: 'Turkey' },
  { code: 'TM', name: 'Turkmenistan' },
  { code: 'TV', name: 'Tuvalu' },
  { code: 'UG', name: 'Uganda' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'UZ', name: 'Uzbekistan' },
  { code: 'VU', name: 'Vanuatu' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'YE', name: 'Yemen' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ZW', name: 'Zimbabwe' },
];

// Build lookup maps from COUNTRIES
const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map(c => [c.code, c.name]));
const COUNTRY_CODES = Object.fromEntries(
  COUNTRIES.flatMap(c => [
    [c.name.toLowerCase(), c.code],
    [c.code.toLowerCase(), c.code],
  ])
);

/* =========================================================
   STATE
   ========================================================= */
const DEFAULT_STATE = {
  meta: {
    event:           '',
    eventDateStart:  '',
    eventDateEnd:    '',
    eventLocation:   '',
    companyCode:     '',
    lrp:             '',
    documentNumber:  1,
    venueName:       '',
    venueStreet:     '',
    venuePostcode:   '',
    venueCity:       '',
    venueTIN:        'CHE222251936',
  },
  artist: {
    companyName:     '',
    fullName:        '',
    street:          '',
    postCodeCity:    '',
    countryOfOrigin: '',
    phone:           '',
    email:           '',
  },
  edec: {
    transportMode:          '3',
    transportationType:     '1',
    transportationCountry:    '',
    transportationNumber:     '',
    flightNumber:             '',
    registrationPostcode:     '',
    importerCountry:          'CH',
  },
  form1174: {
    groupMode: 'auto',    // 'auto' | 'manual'
    assignments: [],      // parallel array to state.products: 1=group1, 2=group2, 0=unassigned(→group2)
  },
  products: [],
};

let state = deepClone(DEFAULT_STATE);
let fpStart = null, fpEnd = null;

// UUID helper (works in file:// context)
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* =========================================================
   PERSISTENCE
   ========================================================= */
const STORAGE_KEY = 'zolltool_state_v1';

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Storage might not be available on some file:// contexts
    console.warn('LocalStorage not available:', e);
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge carefully to handle schema changes
      state = {
        meta:     Object.assign({}, DEFAULT_STATE.meta,     parsed.meta     || {}),
        artist:   Object.assign({}, DEFAULT_STATE.artist,   parsed.artist   || {}),
        edec:     Object.assign({}, DEFAULT_STATE.edec,     parsed.edec     || {}),
        products: Array.isArray(parsed.products) ? parsed.products : [],
        form1174: Object.assign({}, DEFAULT_STATE.form1174, parsed.form1174 || {}),
      };
      if (!Array.isArray(state.form1174.assignments)) state.form1174.assignments = [];
      // Ensure fields added in later schema versions are never left empty
      if (!state.meta.venueTIN) state.meta.venueTIN = DEFAULT_STATE.meta.venueTIN;
    }
  } catch (e) {
    console.warn('Could not restore from localStorage:', e);
  }
}

/* =========================================================
   DOM HELPERS
   ========================================================= */
function $(sel, ctx) { return (ctx || document).querySelector(sel); }
function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') { node.className = v; }
      else if (k === 'data') { Object.entries(v).forEach(([dk, dv]) => node.dataset[dk] = dv); }
      else if (k.startsWith('on')) { node.addEventListener(k.slice(2), v); }
      else { node.setAttribute(k, v); }
    });
  }
  children.forEach(child => {
    if (child == null) return;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  });
  return node;
}

/* =========================================================
   FORMATTING
   ========================================================= */
function fmtEventDates(start, end) {
  // Returns e.g. "14. – 16.05.2026" from ISO date strings
  if (!start) return '';
  const s = new Date(start + 'T00:00:00');
  const d1 = s.getDate();
  const mm = String(s.getMonth() + 1).padStart(2, '0');
  const yyyy = s.getFullYear();
  if (!end) return `${d1}.${mm}.${yyyy}`;
  const e = new Date(end + 'T00:00:00');
  const d2 = e.getDate();
  return `${d1}. \u2013 ${d2}.${mm}.${yyyy}`;
}

function fmtWeight(grams) {
  if (grams == null || grams === '' || isNaN(grams)) return '—';
  const kg = grams / 1000;
  if (kg < 0.001) return grams + ' g';
  return formatNum(kg, 3).replace('.', ',') + ' kg';
}

function fmtWeightKg(kg) {
  if (kg == null || isNaN(kg) || kg === 0) return '0 kg';
  return formatNum(kg, 2).replace('.', ',') + ' kg';
}

function fmtCHF(val) {
  if (val == null || isNaN(val)) return '—';
  return 'CHF ' + formatNum(val, 2);
}

function formatNum(n, decimals) {
  return parseFloat(n).toFixed(decimals);
}

function floorN(value, decimals) {
  if (value == null || isNaN(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.floor(parseFloat(value) * factor) / factor;
}

function fmtRate(r) {
  if (r == null || r === '' || isNaN(r)) return '—';
  return parseFloat(r).toFixed(1) + '%';
}

/* =========================================================
   CALCULATIONS
   ========================================================= */
function calcProduct(p) {
  const amount = p.amount || 0;

  // Weight: round to nearest gram first to eliminate floating-point noise, then convert to kg
  const totalWeightKg = Math.round(amount * (p.weightG || 0)) / 1000;

  // Value: round to whole CHF — the total is the authoritative number
  let totalValue = p.totalValueCHF != null ? Math.round(parseFloat(p.totalValueCHF)) : null;
  if (totalValue == null && p.price != null && p.price !== '') {
    totalValue = Math.round(parseFloat(p.price) * amount);
  }

  // Effective per-unit values derived from the rounded totals (not from raw stored inputs)
  const effectiveUnitPrice   = (totalValue != null && amount > 0) ? totalValue / amount : null;
  const effectiveUnitWeightG = amount > 0 ? (totalWeightKg * 1000) / amount : (p.weightG || 0);

  const soldWeightKg = (p.soldQty || 0) * (p.weightG || 0) / 1000;

  return { totalWeightKg, totalValue, effectiveUnitPrice, effectiveUnitWeightG, soldWeightKg };
}

function calcTotals() {
  let totalAmount = 0, totalWeightKg = 0, totalValue = 0;
  let totalSoldQty = 0, totalSoldVal = 0, totalSoldVat = 0, totalSoldWeight = 0;
  let totalImportVat = 0;
  const byTariffRate = {}; // { '8.1': { value, soldVal }, ... }

  state.products.forEach(p => {
    const c = calcProduct(p);
    totalAmount    += (p.amount || 0);
    totalWeightKg  += c.totalWeightKg;
    if (c.totalValue != null) totalValue += c.totalValue;
    totalSoldQty   += (p.soldQty || 0);
    totalSoldVal   += (p.soldValue || 0);
    totalSoldVat   += floorN((p.soldValue || 0) * ((p.vatRate || 0) / 100), 2);
    totalSoldWeight += c.soldWeightKg;
    if (c.totalValue != null) totalImportVat += floorN(c.totalValue * ((p.vatRate || 0) / 100), 2);

    // Accumulate per tariff rate
    const rateKey = p.tariffRate != null ? String(parseFloat(p.tariffRate)) : '?';
    if (!byTariffRate[rateKey]) byTariffRate[rateKey] = { value: 0, soldVal: 0 };
    if (c.totalValue != null) byTariffRate[rateKey].value   += c.totalValue;
    byTariffRate[rateKey].soldVal += (p.soldValue || 0);
  });

  return { totalAmount, totalWeightKg, totalValue, totalImportVat, totalSoldQty, totalSoldVal, totalSoldVat, totalSoldWeight, byTariffRate };
}

/* =========================================================
   COLLAPSIBLE SECTIONS
   ========================================================= */
function initCollapsibles() {
  $$('.collapsible-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.dataset.target;
      const body = document.getElementById(targetId);
      const chevronId = 'chevron-' + targetId.replace('-body', '');
      const chevron = document.getElementById(chevronId);
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      if (chevron) chevron.classList.toggle('open', !isOpen);
    });
  });
}

function updateSectionSummaries() {
  // Event summary
  const m = state.meta;
  const datesStr = fmtEventDates(m.eventDateStart, m.eventDateEnd);
  const eventParts = [m.event, datesStr, m.eventLocation].filter(Boolean);
  const eventSummary = document.getElementById('event-summary');
  if (eventSummary) {
    eventSummary.textContent = eventParts.length
      ? eventParts.join(' · ')
      : 'Click to expand';
  }

  // Artist summary
  const a = state.artist;
  const artistParts = [a.fullName || a.companyName, a.countryOfOrigin].filter(Boolean);
  const artistSummary = document.getElementById('artist-summary');
  if (artistSummary) {
    artistSummary.textContent = artistParts.length
      ? artistParts.join(' · ')
      : 'Click to expand';
  }

  // E-dec summary
  const edecSummary = document.getElementById('edec-summary');
  if (edecSummary) {
    const hasSoldItems = state.products.some(p => (p.soldQty || 0) > 0);
    const hasTransport = state.edec.transportationNumber;
    if (hasSoldItems && hasTransport) {
      edecSummary.textContent = 'Ready to generate XML';
      edecSummary.style.color = '#1a7a3e';
    } else if (hasSoldItems) {
      edecSummary.textContent = 'Sold quantities entered — complete transport & importer info';
      edecSummary.style.color = '';
    } else {
      edecSummary.textContent = 'Complete after the event — enter sold quantities first';
      edecSummary.style.color = '';
    }
  }
}

/* =========================================================
   FORM FIELD BINDING
   ========================================================= */
function bindFormFields() {
  $$('[data-key]').forEach(input => {
    const key = input.dataset.key;
    const [section, field] = key.split('.');

    // Set initial value
    if (state[section] && state[section][field] != null) {
      input.value = state[section][field];
    }

    // Listen for changes — use both 'input' and 'change' to cover inputs and selects
    const handler = () => {
      if (!state[section]) state[section] = {};
      state[section][field] = input.value;
      updateSectionSummaries();
      saveToStorage();
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
}

/* =========================================================
   PRODUCT TABLE RENDERING
   ========================================================= */
function renderTable() {
  const tbody = document.getElementById('products-tbody');
  const emptyState = document.getElementById('empty-state');

  tbody.innerHTML = '';

  if (state.products.length === 0) {
    emptyState.classList.add('visible');
  } else {
    emptyState.classList.remove('visible');

    state.products.forEach((p, idx) => {
      const row = buildProductRow(p, idx);
      tbody.appendChild(row);
    });
  }

  renderTotals();
  if (document.getElementById('group-auto-info')) render1174GroupUI();
}

function buildProductRow(p, idx) {
  const c = calcProduct(p);
  const tr = document.createElement('tr');
  tr.dataset.id = p.id;

  // Helper to make a TD
  const td = (cls, content) => {
    const cell = document.createElement('td');
    if (cls) cell.className = cls;
    if (content instanceof Node) {
      cell.appendChild(content);
    } else if (content != null) {
      cell.textContent = content;
    }
    return cell;
  };

  // Drag handle
  const handleCell = document.createElement('td');
  handleCell.className = 'col-handle';
  handleCell.innerHTML = '<span class="drag-handle" title="Drag to reorder">&#8942;</span>';
  tr.insertBefore(handleCell, tr.firstChild);
  tr.draggable = true;

  // # — row number
  tr.appendChild(td('col-num', idx + 1));

  // Title
  const titleCell = document.createElement('td');
  titleCell.className = 'col-title';
  titleCell.textContent = p.title || '—';
  tr.appendChild(titleCell);

  // For Sale badge
  const saleBadge = document.createElement('span');
  saleBadge.className = p.forSale ? 'badge badge-sale' : 'badge badge-nosale';
  saleBadge.textContent = p.forSale ? 'For Sale' : 'Not For Sale';
  const saleCell = document.createElement('td');
  saleCell.className = 'col-sale';
  saleCell.appendChild(saleBadge);
  tr.appendChild(saleCell);

  // Type
  tr.appendChild(td('col-type', p.type || '—'));

  // Amount
  const amtCell = document.createElement('td');
  amtCell.className = 'col-amount';
  amtCell.style.textAlign = 'right';
  amtCell.textContent = p.amount != null ? p.amount.toLocaleString() : '—';
  tr.appendChild(amtCell);

  // Unit weight
  const uwCell = document.createElement('td');
  uwCell.className = 'col-weight';
  uwCell.style.textAlign = 'right';
  uwCell.textContent = p.weightG != null ? p.weightG + ' g' : '—';
  tr.appendChild(uwCell);

  // Total weight
  const twCell = document.createElement('td');
  twCell.className = 'col-totalweight';
  twCell.style.textAlign = 'right';
  twCell.textContent = fmtWeightKg(c.totalWeightKg);
  tr.appendChild(twCell);

  // Unit price
  const priceCell = document.createElement('td');
  priceCell.className = 'col-price';
  priceCell.style.textAlign = 'right';
  if (p.priceNote) {
    const note = document.createElement('span');
    note.className = 'price-note';
    note.textContent = p.priceNote;
    priceCell.appendChild(note);
  } else if (c.effectiveUnitPrice != null) {
    // Show per-unit derived from rounded total so it stays consistent with the total column
    priceCell.textContent = 'CHF ' + formatNum(floorN(c.effectiveUnitPrice, 2), 2);
  } else {
    priceCell.textContent = '—';
  }
  tr.appendChild(priceCell);

  // Total value CHF — already a whole CHF from calcProduct
  const valCell = document.createElement('td');
  valCell.className = 'col-totalval';
  valCell.style.textAlign = 'right';
  if (c.totalValue != null) {
    valCell.textContent = 'CHF ' + c.totalValue;
  } else {
    valCell.textContent = '—';
  }
  tr.appendChild(valCell);

  // Tariff No.
  const tariffCell = document.createElement('td');
  tariffCell.className = 'col-tariff';
  if (p.tariffNo) {
    const span = document.createElement('span');
    span.className = 'tariff-code';
    span.textContent = p.tariffNo;
    tariffCell.appendChild(span);
  } else {
    tariffCell.textContent = '—';
  }
  tr.appendChild(tariffCell);

  // Tariff Rate
  const trCell = document.createElement('td');
  trCell.className = 'col-tariffrate';
  trCell.style.textAlign = 'right';
  trCell.textContent = fmtRate(p.tariffRate);
  tr.appendChild(trCell);

  // VAT Rate
  const vatCell = document.createElement('td');
  vatCell.className = 'col-vat';
  vatCell.style.textAlign = 'right';
  vatCell.textContent = fmtRate(p.vatRate);
  tr.appendChild(vatCell);

  // Origin Country
  const effectiveOrigin = (p.originCountry && p.originCountry.trim())
    ? p.originCountry.trim().toUpperCase()
    : countryToCode(state.artist.countryOfOrigin) || '—';
  tr.appendChild(td('col-origin', effectiveOrigin));

  // --- Sold columns ---
  // Sold Qty (editable)
  const soldQtyCell = document.createElement('td');
  soldQtyCell.className = 'col-soldqty sold-col-start';
  soldQtyCell.style.textAlign = 'right';
  const soldQtyInput = document.createElement('input');
  soldQtyInput.type = 'number';
  soldQtyInput.className = 'sold-input';
  soldQtyInput.min = '0';
  soldQtyInput.step = '1';
  soldQtyInput.value = p.soldQty != null ? p.soldQty : 0;
  soldQtyInput.addEventListener('change', () => {
    updateProductField(p.id, 'soldQty', parseFloat(soldQtyInput.value) || 0);
  });
  soldQtyCell.appendChild(soldQtyInput);
  tr.appendChild(soldQtyCell);

  // Sold Value (editable)
  const soldValCell = document.createElement('td');
  soldValCell.className = 'col-soldval';
  soldValCell.style.textAlign = 'right';
  const soldValInput = document.createElement('input');
  soldValInput.type = 'number';
  soldValInput.className = 'sold-input';
  soldValInput.min = '0';
  soldValInput.step = '0.01';
  soldValInput.value = p.soldValue != null ? formatNum(p.soldValue, 2) : '0.00';
  soldValInput.addEventListener('change', () => {
    updateProductField(p.id, 'soldValue', parseFloat(soldValInput.value) || 0);
  });
  soldValCell.appendChild(soldValInput);
  tr.appendChild(soldValCell);

  // Sold VAT (derived, read-only)
  const soldVatCell = document.createElement('td');
  soldVatCell.className = 'col-soldvat';
  soldVatCell.style.textAlign = 'right';
  soldVatCell.textContent = formatNum(floorN((p.soldValue || 0) * ((p.vatRate || 0) / 100), 2), 2);
  tr.appendChild(soldVatCell);

  // Sold Weight (derived, read-only display)
  const soldWtCell = document.createElement('td');
  soldWtCell.className = 'col-soldweight';
  soldWtCell.style.textAlign = 'right';
  soldWtCell.textContent = fmtWeightKg(c.soldWeightKg);
  tr.appendChild(soldWtCell);

  // Actions
  const actionsCell = document.createElement('td');
  actionsCell.className = 'col-actions';
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'row-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost btn-sm';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => openEditModal(p.id));

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger btn-sm';
  delBtn.textContent = 'Del';
  delBtn.addEventListener('click', () => deleteProduct(p.id));

  actionsDiv.appendChild(editBtn);
  actionsDiv.appendChild(delBtn);
  actionsCell.appendChild(actionsDiv);
  tr.appendChild(actionsCell);

  return tr;
}

function renderTotals() {
  const t = calcTotals();
  document.getElementById('total-amount').textContent    = t.totalAmount.toLocaleString();
  document.getElementById('total-weight').textContent    = fmtWeightKg(t.totalWeightKg);
  document.getElementById('total-soldqty').textContent   = t.totalSoldQty.toLocaleString();
  document.getElementById('total-soldval').textContent   = 'CHF ' + Math.floor(t.totalSoldVal);
  document.getElementById('total-soldvat').textContent   = formatNum(t.totalSoldVat, 2);
  document.getElementById('total-soldweight').textContent = fmtWeightKg(t.totalSoldWeight);
  const vatEstEl = document.getElementById('vat-estimate-total');
  if (vatEstEl) vatEstEl.textContent = 'CHF ' + formatNum(t.totalImportVat, 2);
  const vatEstSoldEl = document.getElementById('vat-estimate-sold');
  if (vatEstSoldEl) vatEstSoldEl.textContent = 'CHF ' + formatNum(t.totalSoldVat, 2);

  // Total value: show overall total + per-rate breakdown + import VAT estimate
  const totalValEl = document.getElementById('total-value');
  const rateKeys = Object.keys(t.byTariffRate).sort((a, b) => parseFloat(a) - parseFloat(b));
  const vatLine = `<div class="total-vat-est">est. VAT CHF ${formatNum(t.totalImportVat, 2)}</div>`;
  if (rateKeys.length > 1) {
    const lines = rateKeys.map(r => {
      const rateLabel = r === '?' ? '?' : parseFloat(r).toFixed(1) + '%';
      return `<div class="total-by-rate">${rateLabel} · CHF ${Math.floor(t.byTariffRate[r].value)}</div>`;
    }).join('');
    totalValEl.innerHTML = `<div class="total-main">CHF ${Math.floor(t.totalValue)}</div>${lines}`;
  } else {
    totalValEl.innerHTML = `<div class="total-main">CHF ${Math.floor(t.totalValue)}</div>`;
  }
}

function updateProductField(id, field, value) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  product[field] = value;
  saveToStorage();
  renderTotals();
  updateSectionSummaries();
  // Re-render derived cells for this row
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) {
    const c = calcProduct(product);
    const soldWtCell = tr.querySelector('.col-soldweight');
    if (soldWtCell) soldWtCell.textContent = fmtWeightKg(c.soldWeightKg);
    const soldVatCell = tr.querySelector('.col-soldvat');
    if (soldVatCell) soldVatCell.textContent = formatNum(floorN((product.soldValue || 0) * ((product.vatRate || 0) / 100), 2), 2);
  }
}

/* =========================================================
   PRODUCT CRUD
   ========================================================= */
function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  state.products = state.products.filter(p => p.id !== id);
  saveToStorage();
  renderTable();
}

function addProduct(productData) {
  const product = Object.assign(
    {
      id:          uuid(),
      title:       '',
      forSale:     true,
      type:        '',
      amount:      0,
      weightG:     0,
      price:       null,
      priceNote:   '',
      totalValueCHF: null,
      tariffNo:      '',
      tariffRate:    8.1,
      vatRate:       8.1,
      packagingType: 'CT',
      soldQty:       0,
      soldValue:   0,
      soldVAT:     0,
    },
    productData
  );
  state.products.push(product);
  saveToStorage();
  renderTable();
}

function updateProduct(id, productData) {
  const idx = state.products.findIndex(p => p.id === id);
  if (idx === -1) return;
  state.products[idx] = Object.assign({}, state.products[idx], productData);
  saveToStorage();
  renderTable();
}

/* =========================================================
   MODAL
   ========================================================= */
let editingProductId = null;
let hsDropdownFocusIdx = -1;
let hsFilteredList = [];

function openAddModal() {
  editingProductId = null;
  document.getElementById('modal-title').textContent = 'Add Product';
  resetModalForm();
  showModal();
}

function openEditModal(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  document.getElementById('modal-title').textContent = 'Edit Product';
  populateModalForm(p);
  showModal();
}

function showModal() {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('m-title').focus();
  updateModalPreview();
}

function hideModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  closeHsDropdown();
  editingProductId = null;
}

function resetModalForm() {
  document.getElementById('m-title').value       = '';
  document.getElementById('m-type').value        = '';
  document.getElementById('m-amount').value      = '';
  document.getElementById('m-weight').value      = '';
  document.getElementById('m-price').value       = '';
  document.getElementById('m-pricenote').value   = '';
  document.getElementById('m-hscode-input').value = '';
  document.getElementById('m-tariffrate').value  = '';
  document.getElementById('m-vatrate').value     = '8.1';
  document.getElementById('m-origin').value      = '';
  document.getElementById('hs-desc-hint').textContent = '';
  document.getElementById('m-totalweight').value = '';
  document.getElementById('m-totalvalue').value  = '';
  document.getElementById('m-packaging').value   = 'CT';
  const vatHint = document.getElementById('vat-hint');
  if (vatHint) { vatHint.textContent = 'Standard rate'; vatHint.style.color = ''; }
  // Reset radio
  document.querySelector('input[name="m-forsale"][value="true"]').checked = true;
  updateModalPreview();
}

function populateModalForm(p) {
  document.getElementById('m-title').value        = p.title        || '';
  document.getElementById('m-type').value         = p.type         || '';
  document.getElementById('m-amount').value       = p.amount       != null ? p.amount  : '';
  document.getElementById('m-weight').value       = p.weightG      != null ? p.weightG : '';
  document.getElementById('m-price').value        = p.price        != null ? p.price   : '';
  document.getElementById('m-pricenote').value    = p.priceNote    || '';
  document.getElementById('m-hscode-input').value = p.tariffNo     || '';
  document.getElementById('m-tariffrate').value   = p.tariffRate   != null ? p.tariffRate : '';
  document.getElementById('m-vatrate').value      = p.vatRate      != null ? p.vatRate    : '8.1';
  document.getElementById('m-origin').value       = p.originCountry || '';

  // Show HS description hint if code is known
  if (p.tariffNo) {
    const entry = HS_CODES.find(h => h.code === p.tariffNo);
    document.getElementById('hs-desc-hint').textContent = entry ? entry.desc : '';
  } else {
    document.getElementById('hs-desc-hint').textContent = '';
  }

  // Radio
  const forSaleVal = p.forSale ? 'true' : 'false';
  const radioEl = document.querySelector(`input[name="m-forsale"][value="${forSaleVal}"]`);
  if (radioEl) radioEl.checked = true;

  // Populate derived total weight
  if (p.weightG != null && p.amount != null && p.amount > 0) {
    document.getElementById('m-totalweight').value = parseFloat((p.weightG * p.amount / 1000).toFixed(4));
  } else {
    document.getElementById('m-totalweight').value = '';
  }
  // Populate derived total value
  const derivedTotal = p.totalValueCHF != null ? p.totalValueCHF
    : (p.price != null && p.amount != null ? p.price * p.amount : null);
  document.getElementById('m-totalvalue').value = derivedTotal != null ? parseFloat(derivedTotal).toFixed(2) : '';
  // Packaging
  document.getElementById('m-packaging').value = p.packagingType || 'CT';
  // VAT hint
  updateVatHint();

  updateModalPreview();
}

function collectModalForm() {
  const title      = document.getElementById('m-title').value.trim();
  const type       = document.getElementById('m-type').value.trim();
  const forSale    = document.querySelector('input[name="m-forsale"]:checked').value === 'true';
  const amountStr  = document.getElementById('m-amount').value;
  const weightStr  = document.getElementById('m-weight').value;
  const priceStr   = document.getElementById('m-price').value;
  const priceNote  = document.getElementById('m-pricenote').value.trim();
  const tariffNo   = document.getElementById('m-hscode-input').value.trim();
  const tariffRate = document.getElementById('m-tariffrate').value;
  const vatRate    = document.getElementById('m-vatrate').value;
  const packagingType  = document.getElementById('m-packaging').value || 'CT';
  const originCountry  = document.getElementById('m-origin').value.trim().toUpperCase();

  const amount  = amountStr  !== '' ? parseFloat(amountStr)  : null;
  const weightG = weightStr  !== '' ? parseFloat(weightStr)  : null;
  const price   = priceStr   !== '' ? parseFloat(priceStr)   : null;

  // Read totalValueCHF directly from the total-value field to preserve what the user entered.
  // syncValueFromPerItem keeps this field in sync when the user edits per-item price,
  // so we never need to recompute price × amount here (which would lose precision on total/amount divisions).
  const totalValueStr = document.getElementById('m-totalvalue').value.trim();
  const totalValueCHF = totalValueStr !== '' ? parseFloat(totalValueStr) : null;

  return {
    title,
    type,
    forSale,
    amount:       amount  != null ? amount  : 0,
    weightG:      weightG != null ? weightG : 0,
    price,
    priceNote,
    totalValueCHF,
    tariffNo,
    tariffRate:    tariffRate !== '' ? parseFloat(tariffRate) : null,
    vatRate:       vatRate    !== '' ? parseFloat(vatRate)    : 8.1,
    packagingType,
    originCountry,
  };
}

function validateModalForm() {
  const title  = document.getElementById('m-title').value.trim();
  const amount = document.getElementById('m-amount').value;
  if (!title) {
    showToast('Please enter a product title.', 'error');
    document.getElementById('m-title').focus();
    return false;
  }
  if (amount === '' || isNaN(parseFloat(amount))) {
    showToast('Please enter a valid amount.', 'error');
    document.getElementById('m-amount').focus();
    return false;
  }
  return true;
}

function saveModal() {
  if (!validateModalForm()) return;
  const data = collectModalForm();
  if (editingProductId) {
    updateProduct(editingProductId, data);
  } else {
    addProduct(data);
  }
  hideModal();
  showToast(editingProductId ? 'Product updated.' : 'Product added.', 'success');
}

/* =========================================================
   BIDIRECTIONAL WEIGHT / VALUE SYNC
   ========================================================= */
let _syncLock = false;

function syncWeightFromPerItem() {
  if (_syncLock) return;
  const amount = parseFloat(document.getElementById('m-amount').value) || 0;
  const wg     = parseFloat(document.getElementById('m-weight').value);
  if (!isNaN(wg) && amount > 0) {
    _syncLock = true;
    document.getElementById('m-totalweight').value = parseFloat((wg * amount / 1000).toFixed(4));
    _syncLock = false;
  }
}

function syncWeightFromTotal() {
  if (_syncLock) return;
  const amount = parseFloat(document.getElementById('m-amount').value) || 0;
  const twkg   = parseFloat(document.getElementById('m-totalweight').value);
  if (!isNaN(twkg) && amount > 0) {
    _syncLock = true;
    document.getElementById('m-weight').value = parseFloat((twkg * 1000 / amount).toFixed(2));
    _syncLock = false;
  }
}

function syncValueFromPerItem() {
  if (_syncLock) return;
  const amount = parseFloat(document.getElementById('m-amount').value) || 0;
  const price  = parseFloat(document.getElementById('m-price').value);
  if (!isNaN(price) && amount > 0) {
    _syncLock = true;
    document.getElementById('m-totalvalue').value = parseFloat((price * amount).toFixed(2));
    _syncLock = false;
  }
}

function syncValueFromTotal() {
  if (_syncLock) return;
  const amount = parseFloat(document.getElementById('m-amount').value) || 0;
  const total  = parseFloat(document.getElementById('m-totalvalue').value);
  if (!isNaN(total) && amount > 0) {
    _syncLock = true;
    document.getElementById('m-price').value = parseFloat((total / amount).toFixed(4));
    _syncLock = false;
  }
}

function updateModalPreview() {
  const amount    = parseFloat(document.getElementById('m-amount').value)  || 0;
  const weightG   = parseFloat(document.getElementById('m-weight').value);
  const price     = parseFloat(document.getElementById('m-price').value);
  const priceNote = document.getElementById('m-pricenote').value.trim();

  const totalWeightKg = (!isNaN(weightG) && amount > 0) ? (amount * weightG) / 1000 : null;
  const weightEl = document.getElementById('preview-weight');
  const valueEl  = document.getElementById('preview-value');

  weightEl.textContent = (totalWeightKg != null && totalWeightKg > 0)
    ? fmtWeightKg(totalWeightKg) : '— kg';

  if (!isNaN(price) && price >= 0 && amount > 0) {
    valueEl.textContent = fmtCHF(price * amount);
  } else if (priceNote) {
    valueEl.textContent = priceNote;
  } else {
    valueEl.textContent = 'CHF —';
  }
}

/* =========================================================
   HS CODE COMBOBOX
   ========================================================= */
function initHsCombobox() {
  const input    = document.getElementById('m-hscode-input');
  const dropdown = document.getElementById('hs-dropdown');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      closeHsDropdown();
      document.getElementById('hs-desc-hint').textContent = '';
      return;
    }

    hsFilteredList = HS_CODES.filter(h =>
      h.code.toLowerCase().includes(q) ||
      h.desc.toLowerCase().includes(q)
    );

    if (hsFilteredList.length === 0) {
      closeHsDropdown();
      document.getElementById('hs-desc-hint').textContent = '';
      return;
    }

    renderHsDropdown(hsFilteredList);
    dropdown.style.display = 'block';
    hsDropdownFocusIdx = -1;
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.hs-option');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      hsDropdownFocusIdx = Math.min(hsDropdownFocusIdx + 1, items.length - 1);
      updateHsFocus(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hsDropdownFocusIdx = Math.max(hsDropdownFocusIdx - 1, 0);
      updateHsFocus(items);
    } else if (e.key === 'Enter' && hsDropdownFocusIdx >= 0) {
      e.preventDefault();
      selectHsCode(hsFilteredList[hsDropdownFocusIdx]);
    } else if (e.key === 'Escape') {
      closeHsDropdown();
    }
  });

  input.addEventListener('blur', (e) => {
    // Delay to allow click on dropdown item
    setTimeout(() => {
      if (!dropdown.contains(document.activeElement)) {
        closeHsDropdown();
      }
    }, 150);
  });
}

/* =========================================================
   COUNTRY PICKER
   ========================================================= */
function initCountryPicker(inputEl, opts = {}) {
  const showName = !!opts.showName; // if true, display full country name instead of code

  // Wrap in a relative-positioned container
  const wrapper = document.createElement('div');
  wrapper.className = 'country-picker';
  inputEl.parentNode.insertBefore(wrapper, inputEl);
  wrapper.appendChild(inputEl);

  const dropdown = document.createElement('div');
  dropdown.className = 'country-dropdown';
  dropdown.style.display = 'none';
  wrapper.appendChild(dropdown);

  function renderDropdown(query) {
    const q = query.trim().toLowerCase();
    const matches = q
      ? COUNTRIES.filter(c =>
          c.code.toLowerCase().startsWith(q) ||
          c.name.toLowerCase().includes(q)
        )
      : COUNTRIES;

    dropdown.innerHTML = '';
    matches.slice(0, 80).forEach(c => {
      const item = document.createElement('div');
      item.className = 'country-item';
      item.innerHTML = `<span class="cp-code">${c.code}</span><span class="cp-name">${c.name}</span>`;
      item.addEventListener('mousedown', e => {
        e.preventDefault(); // keep focus on input
        inputEl.value = showName ? c.name : c.code;
        inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        dropdown.style.display = 'none';
      });
      dropdown.appendChild(item);
    });

    dropdown.style.display = matches.length ? 'block' : 'none';
  }

  inputEl.addEventListener('focus', () => renderDropdown(inputEl.value));
  inputEl.addEventListener('input', () => renderDropdown(inputEl.value));
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dropdown.style.display = 'none'; inputEl.blur(); }
  });
  inputEl.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 160);
    const val = inputEl.value.trim();
    const code = COUNTRY_BY_CODE[val.toUpperCase()] ? val.toUpperCase() : null;
    const byName = COUNTRIES.find(c => c.name.toLowerCase() === val.toLowerCase());
    if (showName) {
      // Normalise to full name
      if (code) {
        // user typed a code like "DE" — expand to name
        inputEl.value = COUNTRY_BY_CODE[code];
        inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (byName) {
        inputEl.value = byName.name;
        inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      // Normalise to uppercase code
      if (code) {
        inputEl.value = code;
        inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (byName) {
        inputEl.value = byName.code;
        inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });
}

function renderHsDropdown(list) {
  const dropdown = document.getElementById('hs-dropdown');
  dropdown.innerHTML = '';
  list.forEach((h, i) => {
    const opt = document.createElement('div');
    opt.className = 'hs-option';
    opt.dataset.idx = i;

    const codeSpan = document.createElement('span');
    codeSpan.className = 'hs-code';
    codeSpan.textContent = h.code;

    const descSpan = document.createElement('span');
    descSpan.className = 'hs-desc';
    descSpan.textContent = h.desc;

    const rateSpan = document.createElement('span');
    rateSpan.className = 'hs-rate';
    rateSpan.textContent = h.rate + '%';

    opt.appendChild(codeSpan);
    opt.appendChild(descSpan);
    opt.appendChild(rateSpan);

    opt.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur
      selectHsCode(h);
    });

    dropdown.appendChild(opt);
  });
}

function updateHsFocus(items) {
  items.forEach((item, i) => {
    item.classList.toggle('focused', i === hsDropdownFocusIdx);
  });
  if (hsDropdownFocusIdx >= 0 && items[hsDropdownFocusIdx]) {
    items[hsDropdownFocusIdx].scrollIntoView({ block: 'nearest' });
  }
}

function updateVatHint() {
  const vatVal = parseFloat(document.getElementById('m-vatrate').value);
  const hint = document.getElementById('vat-hint');
  if (!hint) return;
  if (vatVal <= 2.6) {
    hint.textContent = 'Reduced rate (printed books/brochures)';
    hint.style.color = '#1a7a3e';
  } else {
    hint.textContent = 'Standard rate';
    hint.style.color = '';
  }
}

function selectHsCode(h) {
  document.getElementById('m-hscode-input').value = h.code;
  document.getElementById('m-tariffrate').value   = h.rate;
  document.getElementById('m-vatrate').value       = h.vatRate != null ? h.vatRate : 8.1;
  document.getElementById('hs-desc-hint').textContent = h.desc;
  updateVatHint();
  closeHsDropdown();
  updateModalPreview();
}

function closeHsDropdown() {
  const dropdown = document.getElementById('hs-dropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
  hsDropdownFocusIdx = -1;
  hsFilteredList = [];
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const combobox = document.getElementById('hs-combobox');
  if (combobox && !combobox.contains(e.target)) {
    closeHsDropdown();
  }
});

/* =========================================================
   SAVE / LOAD JSON
   ========================================================= */
function saveJSON() {
  const filename = buildFilename();
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  showToast('JSON saved: ' + filename, 'success');
}

function buildFilename() {
  const event  = state.meta.event  || 'ZollTool';
  const artist = state.artist.companyName || state.artist.fullName || '';
  const date   = new Date().toISOString().slice(0, 10);
  const parts  = [event, artist, date].filter(Boolean).join('_');
  return parts.replace(/[^a-zA-Z0-9_\-\.]/g, '_') + '.json';
}

function loadJSON() {
  document.getElementById('file-input').click();
}

function handleFileLoad(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const parsed = JSON.parse(evt.target.result);
      state = {
        meta:     Object.assign({}, DEFAULT_STATE.meta,     parsed.meta     || {}),
        artist:   Object.assign({}, DEFAULT_STATE.artist,   parsed.artist   || {}),
        edec:     Object.assign({}, DEFAULT_STATE.edec,     parsed.edec     || {}),
        products: Array.isArray(parsed.products) ? parsed.products : [],
        form1174: Object.assign({}, DEFAULT_STATE.form1174, parsed.form1174 || {}),
      };
      if (!Array.isArray(state.form1174.assignments)) state.form1174.assignments = [];
      if (!state.meta.venueTIN) state.meta.venueTIN = DEFAULT_STATE.meta.venueTIN;
      saveToStorage();
      syncFormFields();
      updateSectionSummaries();
      renderTable();
      showToast('Loaded: ' + file.name, 'success');
    } catch (err) {
      showToast('Invalid JSON file.', 'error');
      console.error(err);
    }
    // Reset so same file can be loaded again
    e.target.value = '';
  };
  reader.readAsText(file);
}

// Sync form inputs to state (after load)
function syncFormFields() {
  $$('[data-key]').forEach(input => {
    const key = input.dataset.key;
    const [section, field] = key.split('.');
    if (state[section] && state[section][field] != null) {
      input.value = state[section][field];
    } else {
      input.value = '';
    }
  });
  // Sync flatpickr instances (second arg false = no onChange callback)
  if (fpStart) fpStart.setDate(state.meta.eventDateStart || null, false);
  if (fpEnd)   fpEnd.setDate(state.meta.eventDateEnd   || null, false);
  // Sync doc-number select
  const docNumEl = document.getElementById('doc-number');
  if (docNumEl && state.meta.documentNumber) docNumEl.value = String(state.meta.documentNumber);
  autoGenerateLRP();
}

/* =========================================================
   LRP CODE GENERATION
   ========================================================= */
function parseDateFromEventDates(str) {
  if (!str) return null;
  // "14. – 16.05.2026" → month=5, year=2026
  let m = str.match(/(\d{2})\.(20\d{2})/);
  if (m) return { month: parseInt(m[1], 10), year: parseInt(m[2], 10) };
  // "14-16 May 2026" or "14–16 May 2026"
  const monthNames = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  m = str.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*(20\d{2})/i);
  if (m) return { month: monthNames[m[1].toLowerCase().slice(0,3)], year: parseInt(m[2], 10) };
  // "2026-05" or just year
  m = str.match(/\b(20\d{2})-(\d{2})\b/);
  if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  m = str.match(/\b(20\d{2})\b/);
  if (m) return { year: parseInt(m[1], 10), month: null };
  return null;
}

function computeLRP(docNum) {
  const originCC = countryToCode(state.artist.countryOfOrigin) || 'XX';
  const code     = (state.meta.companyCode || '').toUpperCase() || 'XX';
  const now      = new Date();
  let year  = now.getFullYear();
  let month = now.getMonth() + 1;
  if (state.meta.eventDateStart) {
    const d = new Date(state.meta.eventDateStart + 'T00:00:00');
    year  = d.getFullYear();
    month = d.getMonth() + 1;
  }
  const mm  = String(month).padStart(2, '0');
  const nnn = String(docNum).padStart(3, '0');
  return `${originCC}CH_${code}_${year}_${mm}_${nnn}`;
}

function autoGenerateLRP() {
  const docEl  = document.getElementById('doc-number');
  const docNum = docEl ? (parseInt(docEl.value, 10) || 1) : (state.meta.documentNumber || 1);
  const lrp    = computeLRP(docNum);
  const lrpEl  = document.getElementById('event-lrp');
  if (lrpEl) lrpEl.value = lrp;
  state.meta.lrp = lrp;
  state.meta.documentNumber = docNum;
  saveToStorage();
  updateSectionSummaries();
}

/* =========================================================
   PRINT / PDF EXPORT — AUXILIARY DOCUMENT
   ========================================================= */
function printGoodsList(docNum) {
  const m   = state.meta;
  const a   = state.artist;
  const lrp = computeLRP(docNum);

  const docTitles = {
    1: 'Auxiliary Document for the Customs Declaration — Import',
    2: 'Auxiliary Document for the Customs Declaration — Sold Goods',
    3: 'Return Goods List — Re-export Declaration',
  };

  const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; padding: 12mm; }
  .doc-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6mm; }
  .doc-top-left .doc-title { font-size: 10pt; font-weight: bold; text-transform: uppercase; }
  .doc-top-left .doc-subtitle { font-size: 8pt; color: #444; margin-top: 2px; }
  .doc-top-right { text-align: right; }
  .doc-top-right .event-name { font-size: 11pt; font-weight: bold; }
  .doc-top-right .lrp { font-size: 8pt; margin-top: 3px; }
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  .info-table td { padding: 2px 6px; font-size: 8pt; border: 1px solid #ccc; }
  .info-table td.lbl { font-weight: bold; background: #f4f4f4; width: 130px; font-size: 7.5pt; }
  .section-title { font-weight: bold; font-size: 9pt; margin: 4mm 0 2mm 0; border-bottom: 1.5px solid #000; padding-bottom: 1mm; }
  table.goods { width: 100%; border-collapse: collapse; font-size: 7pt; }
  table.goods th { background: #e8e8e8; border: 1px solid #aaa; padding: 3px 4px; text-align: left; font-size: 6.5pt; font-weight: bold; white-space: nowrap; }
  table.goods td { border: 1px solid #ccc; padding: 2px 4px; vertical-align: middle; }
  table.goods tr:nth-child(even) td { background: #fafafa; }
  table.goods tfoot td { background: #e8e8e8; font-weight: bold; border: 1px solid #aaa; padding: 3px 4px; }
  .r { text-align: right; } .c { text-align: center; }
  .mono { font-family: 'Courier New', monospace; font-size: 6.5pt; }
  .sold-head { border-left: 2px solid #666 !important; }
  td.sold-first { border-left: 2px solid #888; }
  .signature-section { margin-top: 8mm; }
  .signature-box { border: 1px solid #000; width: 80mm; height: 22mm; margin-top: 2mm; }
  @media print { body { padding: 0; } @page { size: A4 landscape; margin: 12mm; } }`;

  const header = `<div class="doc-top">
  <div class="doc-top-left">
    <div class="doc-title">${esc(docTitles[docNum] || docTitles[1])}</div>
    <div class="doc-subtitle">${esc(fmtEventDates(m.eventDateStart, m.eventDateEnd))}${m.eventLocation ? ', ' + esc(m.eventLocation) : ''}</div>
  </div>
  <div class="doc-top-right">
    <div class="event-name">${esc(m.event || '')}</div>
    <div class="lrp">LRP: ${esc(lrp || '—')}</div>
  </div>
</div>
<table class="info-table">
  <tr><td class="lbl">Artist / Company Name</td><td>${esc(a.companyName || '')}</td>
      <td class="lbl">Name &amp; Surname</td><td>${esc(a.fullName || '')}</td></tr>
  <tr><td class="lbl">Street &amp; House Number</td><td>${esc(a.street || '')}</td>
      <td class="lbl">Postcode &amp; City</td><td>${esc(a.postCodeCity || '')}</td></tr>
  <tr><td class="lbl">Country of Origin</td><td>${esc(a.countryOfOrigin || '')}</td>
      <td class="lbl">Phone / Mobile</td><td>${esc(a.phone || '')}</td></tr>
  <tr><td class="lbl">Email</td><td colspan="3">${esc(a.email || '')}</td></tr>
</table>`;

  let tableHtml = '';

  if (docNum === 1) {
    // ── IMPORT: no sold columns ──
    let totAmt = 0, totWkg = 0, totVal = 0;
    const rows = state.products.map((p, i) => {
      const c = calcProduct(p);
      const pd = p.priceNote || (c.effectiveUnitPrice != null ? 'CHF ' + formatNum(floorN(c.effectiveUnitPrice, 2), 2) : '—');
      const tv = c.totalValue != null ? 'CHF ' + c.totalValue : '—';
      const pOrig = (p.originCountry && p.originCountry.trim()) ? p.originCountry.trim().toUpperCase() : (countryToCode(a.countryOfOrigin) || '');
      totAmt += (p.amount || 0); totWkg += c.totalWeightKg;
      if (c.totalValue != null) totVal += c.totalValue;
      return `<tr><td class="c">${i+1}</td><td>${esc(p.title||'')}</td>
        <td>${p.forSale?'For Sale':'Not For Sale'}</td><td>${esc(p.type||'')}</td>
        <td class="r">${p.amount??''}</td><td class="r">${p.weightG!=null?p.weightG+' g':''}</td>
        <td class="r">${fmtWeightKg(c.totalWeightKg)}</td><td class="r">${esc(pd)}</td>
        <td class="r">${tv}</td><td class="r">${esc(p.tariffNo||'')}</td>
        <td class="r">${p.tariffRate!=null?p.tariffRate+'%':''}</td>
        <td class="r">${p.vatRate!=null?p.vatRate+'%':''}</td>
        <td class="c">${esc(pOrig)}</td></tr>`;
    }).join('');
    tableHtml = `<div class="section-title">List of goods</div>
<table class="goods"><thead><tr>
  <th>#</th><th>Title</th><th>For Sale / Not For Sale</th><th>Type</th>
  <th class="r">Amount</th><th class="r">Variant Weight</th><th class="r">Total Weight</th>
  <th class="r">Variant Price</th><th class="r">Total Value (CHF)</th>
  <th class="r">Tariff no.</th><th class="r">Tariff Rate</th><th class="r">VAT Rate</th><th class="c">Origin</th>
</tr></thead><tbody>${rows}</tbody><tfoot><tr>
  <td colspan="4" style="text-align:right">TOTALS</td>
  <td class="r">${totAmt}</td><td></td><td class="r">${fmtWeightKg(totWkg)}</td><td></td>
  <td class="r" style="color:#c00">CHF ${Math.floor(totVal)}</td><td colspan="4"></td>
</tr></tfoot></table>`;

  } else if (docNum === 2) {
    // ── SOLD: only sold goods ──
    let totSQ=0,totSV=0,totSWkg=0;
    let rowNum = 0;
    const rows = state.products.map(p => {
      if (!(p.soldQty > 0)) return '';
      rowNum++;
      const c = calcProduct(p);
      const rowSV  = floorN(p.soldValue || 0, 2);
      totSQ+=(p.soldQty||0); totSV+=rowSV;
      totSWkg+=c.soldWeightKg;
      return `<tr><td class="c">${rowNum}</td><td>${esc(p.title||'')}</td><td>${esc(p.type||'')}</td>
        <td class="r">${esc(p.tariffNo||'')}</td>
        <td class="r">${p.soldQty||0}</td>
        <td class="r">CHF ${formatNum(rowSV,2)}</td>
        <td class="r">${fmtWeightKg(c.soldWeightKg)}</td></tr>`;
    }).filter(r => r).join('');
    const emptyRow = rows ? '' : `<tr><td colspan="7" style="text-align:center;color:#888;padding:8px">No sold quantities entered</td></tr>`;
    tableHtml = `<div class="section-title">List of goods sold</div>
<table class="goods"><thead><tr>
  <th>#</th><th>Title</th><th>Type</th>
  <th class="r">Tariff no.</th>
  <th class="r">Qty Sold</th><th class="r">Value Sold (CHF)</th>
  <th class="r">Sold Weight</th>
</tr></thead><tbody>${rows}${emptyRow}</tbody><tfoot><tr>
  <td colspan="4" style="text-align:right">TOTALS</td>
  <td class="r">${totSQ}</td>
  <td class="r">CHF ${formatNum(floorN(totSV,2),2)}</td>
  <td class="r">${fmtWeightKg(totSWkg)}</td>
</tr></tfoot></table>`;

  } else {
    // ── EXPORT/RETURN: unsold items going back (original qty − sold qty) ──
    let totRetQty=0, totRetWkg=0, totRetVal=0;
    let rowNum = 0;
    const rows = state.products.map(p => {
      const retQty = (p.amount||0) - (p.soldQty||0);
      if (retQty <= 0) return '';
      rowNum++;
      const c = calcProduct(p);
      const retWkg = Math.round(retQty * (p.weightG||0)) / 1000;
      const retVal = c.effectiveUnitPrice != null ? Math.round(c.effectiveUnitPrice * retQty) : null;
      totRetQty += retQty; totRetWkg += retWkg;
      if (retVal != null) totRetVal += retVal;
      const pd = p.priceNote || (c.effectiveUnitPrice != null ? 'CHF ' + formatNum(floorN(c.effectiveUnitPrice, 2), 2) : '—');
      const retValStr = retVal != null ? 'CHF ' + retVal : '—';
      const pOrig = (p.originCountry && p.originCountry.trim()) ? p.originCountry.trim().toUpperCase() : (countryToCode(a.countryOfOrigin) || '');
      return `<tr><td class="c">${rowNum}</td><td>${esc(p.title||'')}</td><td>${esc(p.type||'')}</td>
        <td class="r">${p.amount??''}</td><td class="r">${p.soldQty||0}</td>
        <td class="r"><strong>${retQty}</strong></td>
        <td class="r">${p.weightG!=null?p.weightG+' g':''}</td>
        <td class="r">${fmtWeightKg(retWkg)}</td>
        <td class="r">${esc(pd)}</td>
        <td class="r">${retValStr}</td>
        <td class="r">${esc(p.tariffNo||'')}</td>
        <td class="r">${p.tariffRate!=null?p.tariffRate+'%':''}</td>
        <td class="r">${p.vatRate!=null?p.vatRate+'%':''}</td>
        <td class="c">${esc(pOrig)}</td></tr>`;
    }).filter(r => r).join('');
    const emptyRow = rows ? '' : `<tr><td colspan="14" style="text-align:center;color:#888;padding:8px">All items sold — no return goods</td></tr>`;
    tableHtml = `<div class="section-title">Return goods list (re-export)</div>
<table class="goods"><thead><tr>
  <th>#</th><th>Title</th><th>Type</th>
  <th class="r">Original Qty</th><th class="r">Sold Qty</th><th class="r">Return Qty</th>
  <th class="r">Unit Weight</th><th class="r">Return Weight</th>
  <th class="r">Unit Price</th><th class="r">Return Value (CHF)</th>
  <th class="r">Tariff no.</th><th class="r">Tariff Rate</th><th class="r">VAT Rate</th><th class="c">Origin</th>
</tr></thead><tbody>${rows}${emptyRow}</tbody><tfoot><tr>
  <td colspan="5" style="text-align:right">TOTALS</td>
  <td class="r"><strong>${totRetQty}</strong></td><td></td>
  <td class="r">${fmtWeightKg(totRetWkg)}</td><td></td>
  <td class="r" style="color:#c00">CHF ${Math.floor(totRetVal)}</td><td colspan="4"></td>
</tr></tfoot></table>`;
  }

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${esc(docTitles[docNum])} — ${esc(m.event || 'ZollTool')}</title>
<style>${CSS}</style></head><body>
${header}
${tableHtml}
<div class="signature-section"><strong>Date and Signature</strong><div class="signature-box"></div></div>
<script>window.onload=function(){window.print();};<\/script>
</body></html>`;

  const win = window.open('', '_blank', 'width=1200,height=800');
  if (!win) { showToast('Pop-up blocked — allow pop-ups and try again.', 'error'); return; }
  win.document.write(html);
  win.document.close();
}

/* =========================================================
   11.74 GOODS GROUPING — COMPUTE / RENDER / INIT
   ========================================================= */
function compute1174Groups() {
  // ensure assignments array is in sync
  const asn = state.form1174.assignments;
  while (asn.length < state.products.length) asn.push(0);
  if (asn.length > state.products.length) asn.length = state.products.length;

  function makeGroup(products) {
    let tariffNo = '—', maxVal = -1;
    const g = { tariffNo: '—', qty: 0, weightKg: 0, value: 0 };
    products.forEach(p => {
      const c = calcProduct(p);
      g.qty      += (p.amount || 0);
      g.weightKg += c.totalWeightKg;
      if (c.totalValue != null) g.value += c.totalValue;
      if (c.totalValue != null && c.totalValue > maxVal && p.tariffNo) {
        maxVal = c.totalValue; tariffNo = p.tariffNo;
      }
    });
    g.tariffNo = tariffNo;
    return g;
  }

  if (state.form1174.groupMode === 'manual') {
    const g1prods = state.products.filter((_, i) => asn[i] === 1);
    const g2prods = state.products.filter((_, i) => asn[i] !== 1);
    const g1 = makeGroup(g1prods);
    const g2 = makeGroup(g2prods);
    return { g1, g2, hasG2: g2.qty > 0 };
  }

  // auto mode
  const groups = {};
  state.products.forEach(p => {
    const key = (p.tariffNo || '').trim() || '—';
    if (!groups[key]) groups[key] = { tariffNo: key, qty: 0, weightKg: 0, value: 0 };
    const c = calcProduct(p);
    groups[key].qty      += (p.amount || 0);
    groups[key].weightKg += c.totalWeightKg;
    if (c.totalValue != null) groups[key].value += c.totalValue;
  });
  const sorted = Object.values(groups).sort((a, b) => b.value - a.value);
  const g1 = sorted[0] || { tariffNo: '—', qty: 0, weightKg: 0, value: 0 };
  const g2base = sorted[1] || null;
  const g2 = sorted.slice(1).reduce((acc, g) => {
    acc.qty += g.qty; acc.weightKg += g.weightKg; acc.value += g.value; return acc;
  }, { tariffNo: g2base ? g2base.tariffNo : '—', qty: 0, weightKg: 0, value: 0 });
  return { g1, g2, hasG2: g2.qty > 0 };
}

function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render1174GroupUI() {
  if (!state.form1174) return;

  // sync mode select
  const modeEl = document.getElementById('group-mode-select');
  if (modeEl) modeEl.value = state.form1174.groupMode;

  const manualUI = document.getElementById('group-manual-ui');
  const autoInfo = document.getElementById('group-auto-info');
  if (!manualUI || !autoInfo) return;

  if (state.form1174.groupMode === 'manual') {
    manualUI.style.display = '';
    autoInfo.style.display = 'none';
    renderManual1174Cards();
  } else {
    manualUI.style.display = 'none';
    autoInfo.style.display = '';
    renderAuto1174Info();
  }
  updateSectionSummaries(); // refresh section header
}

function renderManual1174Cards() {
  // ensure assignments in sync
  const asn = state.form1174.assignments;
  while (asn.length < state.products.length) asn.push(0);
  if (asn.length > state.products.length) asn.length = state.products.length;

  [1, 2, 0].forEach(groupNum => {
    const zone = document.getElementById(`group-drop-${groupNum}`);
    if (!zone) return;
    zone.innerHTML = '';
    state.products.forEach((p, i) => {
      if ((asn[i] || 0) !== groupNum) return;
      const c = calcProduct(p);
      const val = c.totalValue != null ? Math.floor(c.totalValue) : 0;
      const card = document.createElement('div');
      card.className = 'g-card';
      card.draggable = true;
      card.dataset.idx = String(i);
      card.innerHTML = `<span class="g-card-handle">&#8942;&#8942;</span>
        <span class="g-card-title">${escHtml(p.title || '(untitled)')}</span>
        <span class="g-card-hs">${escHtml(p.tariffNo || '—')}</span>
        <span class="g-card-val">CHF ${val}</span>`;
      zone.appendChild(card);
    });
  });
  update1174GroupSummaries();
}

function update1174GroupSummaries() {
  [1, 2].forEach(groupNum => {
    const summaryEl = document.getElementById(`group-summary-${groupNum}`);
    if (!summaryEl) return;
    const asn = state.form1174.assignments;
    const inGroup = state.products.filter((_, i) => (asn[i] || 0) === groupNum);
    let qty = 0, val = 0;
    inGroup.forEach(p => {
      qty += (p.amount || 0);
      const c = calcProduct(p);
      if (c.totalValue != null) val += c.totalValue;
    });
    summaryEl.textContent = `${inGroup.length} product${inGroup.length !== 1 ? 's' : ''} · ${qty} items · CHF ${Math.floor(val)}`;
  });
}

function renderAuto1174Info() {
  const el = document.getElementById('group-auto-info');
  if (!el) return;
  const { g1, g2, hasG2 } = compute1174Groups();

  // show which products land in each group
  const groups = {};
  state.products.forEach(p => {
    const key = (p.tariffNo || '').trim() || '—';
    if (!groups[key]) groups[key] = { tariffNo: key, products: [], value: 0 };
    const c = calcProduct(p);
    groups[key].products.push(p);
    if (c.totalValue != null) groups[key].value += c.totalValue;
  });
  const sorted = Object.values(groups).sort((a, b) => b.value - a.value);
  const g1group = sorted[0];
  const g2groups = sorted.slice(1);

  function renderGroup(label, group, products) {
    const items = products.map(p => {
      const c = calcProduct(p);
      const val = c.totalValue != null ? Math.floor(c.totalValue) : 0;
      return `<div class="g-auto-item"><span class="g-card-title">${escHtml(p.title || '(untitled)')}</span>
        <span class="g-card-hs">${escHtml(p.tariffNo || '—')}</span>
        <span class="g-card-val">CHF ${val}</span></div>`;
    }).join('');
    return `<div class="group-auto-col">
      <div class="group-col-header"><span class="group-col-title">${label}</span>
        <span class="group-col-summary">HS: ${escHtml(group ? group.tariffNo : '—')}</span></div>
      <div class="g-auto-list">${items || '<div class="g-auto-empty">No products</div>'}</div>
    </div>`;
  }

  const g2allProducts = g2groups.flatMap(g => g.products);
  el.innerHTML = `<div class="group-auto-preview">
    ${g1group ? renderGroup('Group 1', g1group, g1group.products) : ''}
    ${hasG2 ? renderGroup('Group 2', sorted[1], g2allProducts) : ''}
  </div>`;
}

function init1174GroupUI() {
  const modeEl = document.getElementById('group-mode-select');
  if (!modeEl) return;

  modeEl.addEventListener('change', () => {
    state.form1174.groupMode = modeEl.value;
    if (modeEl.value === 'manual') {
      // initialise assignments from auto grouping
      const asn = state.form1174.assignments;
      while (asn.length < state.products.length) asn.push(0);
      if (asn.length > state.products.length) asn.length = state.products.length;

      const groups = {};
      state.products.forEach((p, i) => {
        const key = (p.tariffNo || '').trim() || '—';
        if (!groups[key]) groups[key] = { indices: [], value: 0 };
        const c = calcProduct(p);
        groups[key].indices.push(i);
        if (c.totalValue != null) groups[key].value += c.totalValue;
      });
      const sorted = Object.values(groups).sort((a, b) => b.value - a.value);
      if (sorted[0]) sorted[0].indices.forEach(i => { asn[i] = 1; });
      sorted.slice(1).forEach(g => g.indices.forEach(i => { asn[i] = 2; }));
    }
    saveToStorage();
    render1174GroupUI();
  });

  // Drag-and-drop on the three drop zones
  const container = document.getElementById('group-manual-ui');
  if (!container) return;

  let dragIdx = null;

  container.addEventListener('dragstart', e => {
    const card = e.target.closest('.g-card');
    if (!card) return;
    dragIdx = parseInt(card.dataset.idx, 10);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', e => {
    const card = e.target.closest('.g-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.group-drop-zone').forEach(z => z.classList.remove('drag-over'));
    dragIdx = null;
  });

  container.addEventListener('dragover', e => {
    const zone = e.target.closest('.group-drop-zone');
    if (!zone) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.group-drop-zone').forEach(z => z.classList.remove('drag-over'));
    zone.classList.add('drag-over');
  });

  container.addEventListener('dragleave', e => {
    const zone = e.target.closest('.group-drop-zone');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });

  container.addEventListener('drop', e => {
    const zone = e.target.closest('.group-drop-zone');
    if (!zone || dragIdx === null) return;
    e.preventDefault();
    zone.classList.remove('drag-over');
    const newGroup = parseInt(zone.dataset.group, 10);
    state.form1174.assignments[dragIdx] = newGroup;
    saveToStorage();
    renderManual1174Cards();
  });
}

/* =========================================================
   PRINT / PDF EXPORT — FORMULAR 11.74 PREVIEW
   ========================================================= */
function print1174() {
  const m = state.meta;
  const a = state.artist;
  const e = state.edec;

  // ── Data preparation ──
  const artistCC          = countryToCode(a.countryOfOrigin) || '';
  const artistCountryName = COUNTRY_BY_CODE[artistCC] || artistCC;
  const senderBlock       = [a.companyName, a.fullName, a.street, a.postCodeCity, artistCountryName]
                              .filter(Boolean).join('\n');
  const venueLines        = [m.event, m.venueStreet,
                              [m.venuePostcode, m.venueCity].filter(Boolean).join(' '), 'Switzerland']
                              .filter(Boolean).join('\n');

  const vehicleCC    = (e.transportationCountry || '').trim().toUpperCase();
  const transportMode = (e.transportMode || '3');
  const isAir        = transportMode === '4';
  const flightNumber = (e.flightNumber || '').trim();

  // VTS code per transport mode
  const VTS_CODE = { '1':'80', '2':'20', '3':'30', '4':'40', '5':'50', '9':'90' };
  const vtsCode  = VTS_CODE[transportMode] || '30';

  // Country: vehicle CC for road; artist CC for air, rail, and all other modes
  const field5CC       = transportMode === '3' ? (vehicleCC || artistCC) : artistCC;
  // Postal code: always the event/venue postal code
  const field5PostCode = (m.venuePostcode || '').trim() || '______';
  const field5Value    = `${vtsCode} ${field5CC || '______'} ${field5PostCode}`;

  // ── Product grouping ──
  const { g1, g2, hasG2 } = compute1174Groups();

  const allTitles = state.products.map(p => p.title).filter(Boolean).join(', ');
  const today     = new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // ── Helpers ──
  const fv  = (v, warn = false) => v
    ? `<span class="fv${warn ? ' warn' : ''}">${esc(v)}</span>`
    : `<span class="ev">——</span>`;
  const fvP = v => v ? `<span class="fv pre">${esc(v)}</span>` : `<span class="ev">——</span>`;

  function cellHead(num, label) {
    return `<div class="ch"><span class="cn">${esc(num)}</span><span class="cl">${esc(label)}</span></div>`;
  }

  function gtCell(val, align = '') {
    const s = align ? ` style="text-align:${align}"` : '';
    return val ? `<td${s}><span class="gfv">${esc(val)}</span></td>` : `<td${s}></td>`;
  }

  function gtDescRow(rowNum, f16, f17) {
    return `<tr>
      <td class="rn">${rowNum}</td>
      ${gtCell(f16)}
      ${gtCell(f17)}
    </tr>`;
  }

  function gtNumRow(rowNum, f20, f22, f23, f24, f25) {
    return `<tr>
      <td class="rn">${rowNum}</td>
      <td></td><td></td>
      ${gtCell(f20, 'center')}
      <td></td>
      ${gtCell(f22, 'right')}
      ${gtCell(f23, 'center')}
      ${gtCell(f24, 'right')}
      ${gtCell(f25, 'right')}
      <td></td><td></td>
    </tr>`;
  }

  // ── CSS ──
  const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 6.5pt; color: #000; background: #b0b0b0; }

.print-bar {
  background: #222; color: #fff; padding: 7px 14px; font-size: 10pt;
  display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 9;
}
.print-bar button {
  background: #1a6ecc; color: #fff; border: none; padding: 5px 16px;
  font-size: 10pt; cursor: pointer; border-radius: 3px; font-weight: bold;
}
.print-bar .hint { font-size: 7.5pt; color: #aaa; }

.page {
  width: 210mm; min-height: 297mm; margin: 8mm auto;
  background: #fff; display: flex; border: 1px solid #444;
}

/* ── Side strips ── */
.strip {
  width: 13mm; background: #f2b0a6; flex-shrink: 0;
  display: flex; flex-direction: column; align-items: center;
  padding: 3mm 1mm; position: relative; overflow: hidden;
}
.strip-a { font-size: 18pt; font-weight: bold; color: #000; line-height: 1; flex-shrink: 0; }
.strip-title {
  font-size: 4.5pt; color: #000; writing-mode: vertical-rl;
  transform: rotate(180deg); margin-top: 4mm; line-height: 1.5;
  white-space: nowrap; flex-shrink: 0;
}
.strip-r .strip-a { margin-top: auto; }

/* ── Form body ── */
.fb { flex: 1; display: flex; flex-direction: column; border-left: 0.5px solid #666; border-right: 0.5px solid #666; }

/* ── Cell base ── */
.cell { border: 0.5px solid #666; padding: 1.2mm 1.5mm; position: relative; min-height: 10mm; }
.ch { display: flex; align-items: baseline; gap: 1.5mm; margin-bottom: 1mm; }
.cn { font-size: 5.5pt; font-weight: bold; color: #444; white-space: nowrap; flex-shrink: 0; }
.cl { font-size: 4.8pt; color: #555; line-height: 1.3; }
.cv { font-size: 7pt; line-height: 1.5; }

/* Pre-filled values */
.fv     { font-weight: bold; color: #003ab5; }
.fv.pre { white-space: pre-wrap; }
.fv.warn { font-weight: bold; color: #cc0000; }
.ev     { color: #bbb; font-style: italic; }
.warn-note { font-size: 5pt; color: #cc0000; font-style: italic; margin-top: 1mm; }

/* ── Header row ── */
.hdr { display: flex; border-bottom: 0.5px solid #666; align-items: stretch; }
.hdr-admin { flex: 0 0 auto; padding: 1.5mm 2mm; font-size: 4.8pt; line-height: 1.5; border-right: 0.5px solid #666; }
.hdr-copy  { flex: 1; padding: 1.5mm 2mm; font-size: 5pt; display: flex; align-items: flex-end; }
.hdr-num   { flex: 0 0 auto; padding: 1.5mm 3mm; border-left: 0.5px solid #666; text-align: right; }
.form-number { font-size: 22pt; font-weight: bold; line-height: 1; }
.form-ref    { font-size: 4.5pt; color: #666; }

/* ── Top section (fields 1-13) ── */
.top { display: flex; border-bottom: 0.5px solid #666; }
.lc  { flex: 0 0 56%; border-right: 0.5px solid #666; display: flex; flex-direction: column; }
.lc .cell { border: none; border-bottom: 0.5px solid #666; flex: 1; }
.lc .cell:last-child { border-bottom: none; }

.rc { flex: 1; display: flex; flex-direction: column; }
.rc .cell { border: none; border-bottom: 0.5px solid #666; }
.rc .cell:last-child { border-bottom: none; flex: 1; }
.rc-top { display: flex; border-bottom: 0.5px solid #666; }
.rc-top .cell { border: none; flex: 1; }
.rc-top .cell:first-child { border-right: 0.5px solid #666; }

/* ── Field 4/5 / 14/15 section ── */
.mid { display: flex; border-bottom: 0.5px solid #666; }
.ml { flex: 0 0 56%; border-right: 0.5px solid #666; display: flex; flex-direction: column; }
.ml .cell { border: none; border-bottom: 0.5px solid #666; }
.ml .cell:last-child { border-bottom: none; flex: 1; }
.mr { flex: 1; display: flex; flex-direction: column; }
.mr .cell { border: none; border-bottom: 0.5px solid #666; }
.mr .cell:last-child { border-bottom: none; flex: 1; }

.cb-row { display: flex; gap: 3mm; flex-wrap: wrap; margin: 1mm 0; }
.cb { display: inline-flex; align-items: center; gap: 1mm; font-size: 5pt; color: #333; }
.cb-box { width: 3mm; height: 3mm; border: 0.5px solid #555; display: inline-block; flex-shrink: 0; }
.f4sub { font-size: 5pt; color: #555; margin-top: 1mm; line-height: 1.7; }

/* ── Goods table ── */
.gt-wrap { border-bottom: 0.5px solid #666; }
table.gt {
  width: 100%; border-collapse: collapse; font-size: 5pt; table-layout: fixed;
}
table.gt th, table.gt td {
  border: 0.5px solid #666; padding: 0.8mm 1mm; vertical-align: top;
}
table.gt th { font-weight: bold; font-size: 4.8pt; line-height: 1.3; background: #fff; }
table.gt td { height: 16mm; vertical-align: top; }
td.rn    { text-align: center; font-size: 8pt; font-weight: bold; vertical-align: top; padding-top: 1.5mm; }
.gfv     { font-weight: bold; color: #003ab5; font-size: 5.5pt; white-space: pre-wrap; }
.th-hint { display: block; font-size: 4pt; color: #c00; font-weight: normal; margin-top: 1mm; line-height: 1.3; }

/* Description table (16 + 17) column widths */
col.d-rn { width: 3%; }
col.d-16 { width: 14%; }
/* col.d-17 fills remaining */

/* Numeric table (18–27) column widths — must total 100% */
col.n-rn { width: 3%; }
col.n-18 { width: 5%; }
col.n-19 { width: 5%; }
col.n-20 { width: 15%; }
col.n-21 { width: 6%; }
col.n-22 { width: 12%; }
col.n-23 { width: 11%; }
col.n-24 { width: 13%; }
col.n-25 { width: 15%; }
col.n-26 { width: 7.5%; }
col.n-27 { width: 7.5%; }

/* ── Bottom section ── */
.bot { display: flex; flex: 1; }
.bl  { flex: 0 0 56%; border-right: 0.5px solid #666; display: flex; flex-direction: column; }
.bl .cell { border: none; border-bottom: 0.5px solid #666; }
.bl .cell:last-child { border-bottom: none; flex: 1; }
.br  { flex: 1; display: flex; flex-direction: column; }
.br .cell { border: none; border-bottom: 0.5px solid #666; }
.br .cell:last-child { border-bottom: none; flex: 1; }

/* Horizontal field: label left, value right */
.hfield { display: flex; align-items: center; gap: 2mm; }
.hfield-label { flex: 1; }
.hfield-value { flex: 0 0 auto; font-size: 8pt; font-weight: bold; color: #003ab5;
                border-left: 0.5px solid #ccc; padding-left: 2mm; min-width: 10mm; text-align: center; }

.sig-line { border-bottom: 0.5px solid #888; min-height: 10mm; margin-top: 1.5mm; }
.sig-note { font-size: 4.8pt; color: #cc0000; font-style: italic; margin-top: 0.8mm; }
.subtotal-label { font-size: 4.8pt; color: #555; margin: 1.5mm 0 0.5mm 0; }

@media print {
  .print-bar { display: none; }
  body { background: #fff; }
  .page { margin: 0; border: none; box-shadow: none; }
  @page { size: A4 portrait; margin: 0mm; }
}`;

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<title>Formular 11.74 — ${esc(m.event || 'ZollTool')}</title>
<style>${CSS}</style></head><body>

<div class="print-bar">
  <button onclick="window.print()">🖨&nbsp; Print / Save as PDF</button>
  <span class="hint">Pre-filled values shown in <strong style="color:#6699ee">bold blue</strong> &nbsp;·&nbsp; Verify all fields before signing &nbsp;·&nbsp; ${esc(m.event || '')} &nbsp;·&nbsp; Generated ${today}</span>
</div>

<div class="page">

  <!-- Left pink strip -->
  <div class="strip">
    <div class="strip-a">A</div>
    <div class="strip-title">Vorübergehende Verwendung mit hinterlegtem Betrag · Admission temporaire à montant déposé · Ammissione temporanea con importo depositato</div>
  </div>

  <!-- Form body -->
  <div class="fb">

    <!-- Header -->
    <div class="hdr">
      <div class="hdr-admin">
        Eidgenössische Zollverwaltung EZV<br>
        Administration fédérale des douanes AFD<br>
        Amministrazione federale delle dogane AFD
      </div>
      <div class="hdr-copy">Kopie für / Copie pour / Copia per &nbsp;→</div>
      <div class="hdr-num">
        <div class="form-number">11.74</div>
        <div class="form-ref">606.000.11.74</div>
      </div>
    </div>

    <!-- Fields 1–13 -->
    <div class="top">
      <div class="lc">
        <div class="cell">
          ${cellHead('1', 'Versender / Expéditeur / Speditore')}
          <div class="cv">${fvP(senderBlock)}</div>
        </div>
        <div class="cell">
          ${cellHead('2', 'Eigentümer der Ware / Propriétaire de la marchandise / Proprietario della merce')}
          <div class="cv">${fvP(senderBlock)}</div>
        </div>
        <div class="cell">
          ${cellHead('3', 'Empfänger/Importeur / Destinataire/Importateur / Destinatario/Importatore')}
          <div class="cv">${fvP(venueLines)}</div>
        </div>
      </div>
      <div class="rc">
        <div class="rc-top">
          <div class="cell">
            ${cellHead('6', 'Vordokument / Document précédent / Documento precedente')}
            <div class="cv">${isAir && flightNumber ? fv(flightNumber) : '<span style="font-size:5pt;color:#888">Nr. / No / N. ___________</span>'}</div>
          </div>
          <div class="cell">
            ${cellHead('7', 'Konto-Nr. / Compte No / Conto N.')}
            <div class="cv"><span class="ev">——</span></div>
          </div>
        </div>
        <div class="cell" style="min-height:7mm">
          ${cellHead('8', 'Einfuhr / Import. / Import')}
          <div class="cv">
            <span class="cb"><span class="cb-box"></span> Einfuhr / Import. / Import</span>
            &nbsp;&nbsp;
            <span class="cb"><span class="cb-box"></span> Ausfuhr / Export. / Esport.</span>
          </div>
        </div>
        <div class="cell" style="min-height:7mm">
          ${cellHead('9', 'Verfalldatum / Echéance / Scadenza')}
          <div class="cv"><span class="ev">——</span></div>
        </div>
        <div class="cell hfield" style="min-height:7mm">
          <div class="hfield-label">${cellHead('10', 'Ursprungsland / Pays d\'origine / Paese d\'origine')}</div>
          <div class="hfield-value">${fv(artistCC)}</div>
        </div>
        <div class="cell hfield" style="min-height:7mm">
          <div class="hfield-label">${cellHead('11', 'Land der vorübergehenden Bestimmung / Pays de destination temporaire / Paese di destinazione temporanea')}</div>
          <div class="hfield-value">${fv('CH')}</div>
        </div>
        <div class="cell hfield" style="min-height:7mm">
          <div class="hfield-label">${cellHead('12', 'Land der endgültigen Bestimmung / Pays de destination définitive / Paese di destinazione definitiva')}</div>
          <div class="hfield-value">${fv(artistCC)}</div>
        </div>
        <div class="cell">
          ${cellHead('13', 'Verwendungszweck der Ware / Emploi de la marchandise / Scopo d\'impiego della merce')}
          <div class="cv"><span class="ev">——</span></div>
        </div>
      </div>
    </div>

    <!-- Field 4 / 5 + 14 / 15 -->
    <div class="mid">
      <div class="ml">
        <div class="cell">
          ${cellHead('4', 'Präferenzbehandlung / Régime préférentiel / Trattamento preferenziale')}
          <div class="cb-row">
            <span class="cb"><span class="cb-box"></span> Europäische Freihandelszone / Zone européenne de libre-échange / Zona europea di libero scambio</span>
          </div>
          <div class="cb-row">
            <span class="cb"><span class="cb-box"></span> Allgemeines Präferenzsystem / Système généralisé de préférences / Sistema generale di preferenze</span>
          </div>
          <div class="f4sub">
            WVB/UZ Nr. _________ vom / CCM/CO No _________ du / CCM/CO N. _________ del
          </div>
        </div>
        <div class="cell">
          ${cellHead('5', 'VTS/SMT · Immat. Land / Pays d\'immatr. / Paese d\'immatr. · PLZ/NPA/CAP')}
          <div style="display:flex;gap:2mm;align-items:flex-start;margin-top:1mm">
            <div style="flex:0 0 auto;border-right:0.5px solid #ccc;padding-right:2mm">
              <div style="font-size:4pt;color:#666;margin-bottom:0.5mm">VTS/SMT</div>
              <span class="fv">[${esc(vtsCode)}]</span>
            </div>
            <div style="flex:0 0 auto;border-right:0.5px solid #ccc;padding-right:2mm">
              <div style="font-size:4pt;color:#666;margin-bottom:0.5mm">Immat. Land / Pays / Paese</div>
              <span class="fv">${esc(field5CC || '______')}</span>
            </div>
            <div style="flex:0 0 auto">
              <div style="font-size:4pt;color:#666;margin-bottom:0.5mm">PLZ/NPA/CAP</div>
              <span class="fv">${esc(field5PostCode)}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="mr">
        <div class="cell" style="min-height:8mm">
          ${cellHead('14', 'Mietgeschäft / Location / Locazione')}
          <div class="cv">
            <span class="cb"><span class="cb-box"></span> ja / oui / sì</span>
            &nbsp;&nbsp;
            <span class="cb"><span class="cb-box"></span> nein / non / no</span>
          </div>
        </div>
        <div class="cell">
          ${cellHead('15', 'Abschlusszollstelle / Bureau de douane d\'apurement / Ufficio doganale della conclusione')}
          <div class="cv"><span class="ev">——</span></div>
        </div>
      </div>
    </div>

    <!-- Goods table: 16 + 17 (description) -->
    <div class="gt-wrap" style="border-bottom:none">
      <table class="gt">
        <colgroup>
          <col class="d-rn"><col class="d-16"><!-- d-17 fills rest -->
        </colgroup>
        <thead><tr>
          <th></th>
          <th>16 Zeichen, Nr., Anzahl, Verpackung<br>Marque, no, nombre, emballage<br>Marca, n., quantità, imballaggio</th>
          <th>17 Genaue Warenbezeichnung (Material, Typ, Nummern, etc.), die eine Identifikation der Ware sicherstellt<br>Désignation exacte de la marchandise (matière, type, numéros, etc.) garantissant son identification<br>Designazione esatta della merce (materiale, tipo, numeri, ecc.), che garantisce l'identificazione della merce</th>
        </tr></thead>
        <tbody>
          ${gtDescRow(1, 'see attached list', allTitles || '—')}
          ${hasG2 ? gtDescRow(2, '', '') : ''}
        </tbody>
      </table>
    </div>

    <!-- Goods table: 18–27 (numeric columns) -->
    <div class="gt-wrap">
      <table class="gt">
        <colgroup>
          <col class="n-rn"><col class="n-18"><col class="n-19"><col class="n-20">
          <col class="n-21"><col class="n-22"><col class="n-23">
          <col class="n-24"><col class="n-25"><col class="n-26"><col class="n-27">
        </colgroup>
        <thead><tr>
          <th></th>
          <th>18<br>NHW<br>MNC<br><span class="th-hint">Statistical goods code — leave blank if unknown</span></th>
          <th>19<br>VC<br>CT<br><span class="th-hint">Mode of transport carrier code — leave blank</span></th>
          <th>20 Tarif-Nr.<br>No de tarif<br>Voce di tariffa<br><span class="th-hint">HS tariff number of the goods</span></th>
          <th>21<br>Schlüssel<br>Clé<br>N.conv.<br><span class="th-hint">Quantity unit/conversion key — leave blank</span></th>
          <th>22 Eigenmasse<br>Masse nette<br>Massa netta<br><span class="th-hint">Net weight in kg (without packaging)</span></th>
          <th>23 Zusatzmenge<br>Unités suppl.<br>Unità suppl.<br><span class="th-hint">Total number of individual items</span></th>
          <th>24 Rohmasse<br>Masse brute<br>Massa lorda<br><span class="th-hint">Gross weight in kg (incl. packaging)</span></th>
          <th>25 Stat. Wert in CHF<br>Valeur stat. CHF<br>Valore stat. CHF<br><span class="th-hint">Total value in CHF (numbers only, no currency symbol)</span></th>
          <th>26 Ansatz<br>Taux<br>Aliquota<br><span class="th-hint">Duty rate in % — customs fills this in</span></th>
          <th>27 Betrag<br>Montant<br>Importo<br><span class="th-hint">Duty amount in CHF — customs fills this in</span></th>
        </tr></thead>
        <tbody>
          ${gtNumRow(1,
              g1.tariffNo !== '—' ? g1.tariffNo : '',
              String(Math.round(g1.weightKg)),
              String(g1.qty),
              String(Math.round(g1.weightKg)),
              String(Math.floor(g1.value)))}
          ${hasG2 ? gtNumRow(2,
              g2.tariffNo !== '—' ? g2.tariffNo : '',
              String(Math.round(g2.weightKg)),
              String(g2.qty),
              String(Math.round(g2.weightKg)),
              String(Math.floor(g2.value))) : ''}
        </tbody>
      </table>
    </div>

    <!-- Bottom: 28–31 + 32 -->
    <div class="bot">
      <div class="bl">
        <div class="cell" style="min-height:8mm">
          ${cellHead('28', 'Verwender der Ware / Utilisateur de la marchandise / Utilizzatore della merce')}
          <div class="cv"><span class="ev">——</span></div>
        </div>
        <div class="cell" style="min-height:8mm">
          ${cellHead('29', 'MWST-Nr. / No TVA / N. IVA &nbsp;&nbsp; MWST-Code / Code-TVA / Codice-IVA')}
          <div class="cv"><span class="ev">——</span></div>
        </div>
        <div class="cell" style="min-height:8mm">
          ${cellHead('30', 'Bewilligung usw. / Permis, etc. / Permesso, ecc.')}
          <div class="cv"><span class="ev">——</span></div>
        </div>
        <div class="cell">
          ${cellHead('31', 'Ort/Datum · Lieu/date · Luogo/data &nbsp;&nbsp; Der Anmelder / Le déclarant / Il dichiarante &nbsp;&nbsp; Ref. / Réf. / Rif.')}
          <div style="display:flex;gap:4mm;margin-top:1mm">
            <div style="flex:0 0 auto">
              <div style="font-size:4.8pt;color:#555">Ort/Datum</div>
              <div class="fv" style="font-size:7pt">${esc(today)}</div>
            </div>
            <div style="flex:1">
              <div style="font-size:4.8pt;color:#555">Der Anmelder / Le déclarant / Il dichiarante</div>
              <div class="fv" style="font-size:7pt">${esc(a.fullName || '—')}</div>
              <div class="sig-note">→ Recommended: person paying the customs deposit</div>
            </div>
            <div style="flex:1">
              <div style="font-size:4.8pt;color:#555">Unterschrift / Signature / Firma</div>
              <div class="sig-line"></div>
              <div class="sig-note">→ Recommended: person paying the customs deposit</div>
            </div>
          </div>
        </div>
      </div>
      <div class="br">
        <div class="cell" style="min-height:14mm">
          ${cellHead('32', 'Zollabgaben / Droits de douane / Tributi doganali')}
          <div class="cv"><span class="ev">——</span></div>
        </div>
        <div class="cell">
          <div class="subtotal-label">Subtotal / Total int. / Subtotale</div>
          <div class="cv"><span class="ev">——</span></div>
          <div class="subtotal-label">Einfuhrabgaben / Redevances d'entrée / Diritti d'entrata</div>
          <div class="cv"><span class="ev">——</span></div>
          <div class="subtotal-label">Annahme / Acceptation / Accettazione</div>
          <div class="cv"><span class="ev">——</span></div>
        </div>
      </div>
    </div>

  </div>

  <!-- Right pink strip -->
  <div class="strip strip-r">
    <div class="strip-a">A</div>
  </div>

</div>
</body></html>`;

  const win = window.open('', '_blank', 'width=960,height=1000');
  if (!win) { showToast('Pop-up blocked — allow pop-ups and try again.', 'error'); return; }
  win.document.write(html);
  win.document.close();
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* =========================================================
   HELPER FUNCTIONS FOR E-DEC
   ========================================================= */
function countryToCode(name) {
  if (!name) return '';
  const trimmed = name.trim();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  const code = COUNTRY_CODES[trimmed.toLowerCase()];
  if (code) return code;
  return trimmed.toUpperCase().slice(0, 2);
}

function parsePostCodeCity(str) {
  if (!str) return { postCode: '', city: '' };
  const match = str.match(/^(\S+)\s+(.+)$/);
  if (match) return { postCode: match[1], city: match[2] };
  return { postCode: '', city: str };
}

function toEdecHsCode(code) {
  if (!code) return '';
  // "4911.91.00" → "4911.9100"
  return code.replace(/^(\d{4})\.(\d{2})\.(\d{2})$/, '$1.$2$3');
}

function getPermitObligation(tariffNo) {
  if (!tariffNo) return 0;
  const hsEntry = HS_CODES.find(h => h.code === tariffNo);
  if (hsEntry) return hsEntry.permit || 0;
  if (tariffNo.startsWith('7117')) return 2;
  return 0;
}

function getVatCode(vatRate) {
  if (vatRate != null && parseFloat(vatRate) <= 2.7) return 2;
  return 1;
}

function escapeXml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* =========================================================
   GENERATE E-DEC XML
   ========================================================= */
function generateEdecXML() {
  const soldProducts = state.products.filter(p => (p.soldQty || 0) > 0);

  if (soldProducts.length === 0) {
    showToast('No products have sold quantities > 0. Enter sold quantities first.', 'error');
    return;
  }

  const e = state.edec;
  const a = state.artist;
  const dispatchCountry = countryToCode(a.countryOfOrigin);
  const declarantAddr   = parsePostCodeCity(a.postCodeCity);

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const createdDate = `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} `
                    + `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}.000 UTC`;

  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<EdecWeb version="4.0" createdDate="${escapeXml(createdDate)}">`);
  lines.push(`  <goodsDeclarationType>`);
  lines.push(`    <serviceType>1</serviceType>`);
  lines.push(`    <declarationType>1</declarationType>`);
  lines.push(`    <language>de</language>`);
  lines.push(`    <dispatchCountry>${escapeXml(dispatchCountry)}</dispatchCountry>`);
  lines.push(`    <transportMeans>`);
  lines.push(`      <transportMode>${escapeXml(e.transportMode || '3')}</transportMode>`);
  lines.push(`      <transportationType>${escapeXml(e.transportationType || '1')}</transportationType>`);
  lines.push(`      <transportationCountry>${escapeXml((e.transportationCountry || '').toUpperCase())}</transportationCountry>`);
  lines.push(`      <transportationNumber>${escapeXml(e.transportationNumber || '')}</transportationNumber>`);
  lines.push(`    </transportMeans>`);
  lines.push(`    <transportInContainer>0</transportInContainer>`);
  lines.push(`    <previousDocument/>`);

  const m = state.meta;

  // Importer
  lines.push(`    <importer>`);
  lines.push(`      <name>${escapeXml(m.venueName || '')}</name>`);
  lines.push(`      <addressSupplement1>${escapeXml('c/o ' + (m.event || ''))}</addressSupplement1>`);
  lines.push(`      <addressSupplement2>${escapeXml(m.venueStreet || '')}</addressSupplement2>`);
  lines.push(`      <postalCode>${escapeXml(m.venuePostcode || '')}</postalCode>`);
  lines.push(`      <city>${escapeXml(m.venueCity || '')}</city>`);
  lines.push(`      <country>CH</country>`);
  lines.push(`      <traderIdentificationNumber>${escapeXml(m.venueTIN || 'CHE222251936')}</traderIdentificationNumber>`);
  lines.push(`    </importer>`);

  // Consignee (same as importer)
  lines.push(`    <consignee>`);
  lines.push(`      <name>${escapeXml(m.venueName || '')}</name>`);
  lines.push(`      <addressSupplement1>${escapeXml('c/o ' + (m.event || ''))}</addressSupplement1>`);
  lines.push(`      <addressSupplement2>${escapeXml(m.venueStreet || '')}</addressSupplement2>`);
  lines.push(`      <postalCode>${escapeXml(m.venuePostcode || '')}</postalCode>`);
  lines.push(`      <city>${escapeXml(m.venueCity || '')}</city>`);
  lines.push(`      <country>CH</country>`);
  lines.push(`      <traderIdentificationNumber>${escapeXml(m.venueTIN || 'CHE222251936')}</traderIdentificationNumber>`);
  lines.push(`    </consignee>`);

  // Declarant (from artist info)
  lines.push(`    <declarant>`);
  lines.push(`      <traderIdentificationNumber></traderIdentificationNumber>`);
  lines.push(`      <name>${escapeXml(a.fullName || a.companyName || '')}</name>`);
  lines.push(`      <street>${escapeXml(a.street || '')}</street>`);
  lines.push(`      <postalCode>${escapeXml(declarantAddr.postCode)}</postalCode>`);
  lines.push(`      <city>${escapeXml(declarantAddr.city)}</city>`);
  lines.push(`      <country>${escapeXml(dispatchCountry)}</country>`);
  lines.push(`    </declarant>`);

  lines.push(`    <business>`);
  lines.push(`      <customsAccount>0</customsAccount>`);
  lines.push(`      <vatAccount>0</vatAccount>`);
  lines.push(`      <vatSuffix>0</vatSuffix>`);
  lines.push(`      <invoiceCurrencyType>1</invoiceCurrencyType>`);
  lines.push(`    </business>`);

  lines.push(`    <goodsItem>`);

  soldProducts.forEach((p, idx) => {
    const soldQty   = p.soldQty || 0;
    const weightKg  = parseFloat((soldQty * (p.weightG || 0) / 1000).toFixed(3));
    const permit    = getPermitObligation(p.tariffNo);
    const vatCode   = getVatCode(p.vatRate);
    const hsCode    = toEdecHsCode(p.tariffNo);
    const originCc  = (p.originCountry && p.originCountry.trim())
      ? p.originCountry.trim().toUpperCase()
      : dispatchCountry;

    // Statistical value: prefer soldValue if entered, else qty × unit price, else proportional from totalValue
    let statValue = 0;
    if (p.soldValue && p.soldValue > 0) {
      statValue = Math.floor(p.soldValue);
    } else if (p.price != null && p.price !== '') {
      statValue = Math.floor(soldQty * parseFloat(p.price));
    } else if (p.totalValueCHF != null && p.amount) {
      statValue = Math.floor((soldQty / p.amount) * parseFloat(p.totalValueCHF));
    }

    lines.push(`      <GoodsItemType>`);
    lines.push(`        <traderItemID>${idx}</traderItemID>`);
    lines.push(`        <description>${escapeXml(soldQty + ' ' + (p.title || ''))}</description>`);
    lines.push(`        <commodityCode>${escapeXml(hsCode)}</commodityCode>`);
    lines.push(`        <grossMass>${weightKg}</grossMass>`);
    lines.push(`        <netMass>${weightKg}</netMass>`);
    lines.push(`        <permitObligation>${permit}</permitObligation>`);
    lines.push(`        <nonCustomsLawObligation>${permit}</nonCustomsLawObligation>`);
    lines.push(`        <statistic>`);
    lines.push(`          <customsClearanceType>1</customsClearanceType>`);
    lines.push(`          <commercialGood>1</commercialGood>`);
    lines.push(`          <statisticalValue>${statValue}</statisticalValue>`);
    lines.push(`          <repair>0</repair>`);
    lines.push(`        </statistic>`);
    lines.push(`        <origin>`);
    lines.push(`          <originCountry>${escapeXml(originCc)}</originCountry>`);
    lines.push(`          <preference>0</preference>`);
    lines.push(`        </origin>`);
    const pkgType = p.packagingType || 'CT';
    if (pkgType === 'NE') {
      lines.push(`        <packaging>`);
      lines.push(`          <PackagingType>`);
      lines.push(`            <packagingType>NE</packagingType>`);
      lines.push(`            <quantity>0</quantity>`);
      lines.push(`          </PackagingType>`);
      lines.push(`        </packaging>`);
    } else {
      lines.push(`        <packaging>`);
      lines.push(`          <PackagingType>`);
      lines.push(`            <packagingType>${escapeXml(pkgType)}</packagingType>`);
      lines.push(`            <quantity>1</quantity>`);
      lines.push(`            <packagingReferenceNumber>1</packagingReferenceNumber>`);
      lines.push(`          </PackagingType>`);
      lines.push(`        </packaging>`);
    }
    lines.push(`        <valuation>`);
    lines.push(`          <netDuty>0</netDuty>`);
    lines.push(`          <vatValue>${statValue}</vatValue>`);
    lines.push(`          <vatCode>${vatCode}</vatCode>`);
    lines.push(`        </valuation>`);
    lines.push(`      </GoodsItemType>`);
  });

  lines.push(`    </goodsItem>`);
  lines.push(`  </goodsDeclarationType>`);
  lines.push(`</EdecWeb>`);

  const xmlString = lines.join('\n');

  const eventName = state.meta.event || 'ZollTool';
  const artist    = state.artist.companyName || state.artist.fullName || '';
  const dateStr   = new Date().toISOString().slice(0, 10);
  const filename  = [eventName, artist, 'edec', dateStr]
    .filter(Boolean).join('_')
    .replace(/[^a-zA-Z0-9_\-\.]/g, '_') + '.xml';

  const blob = new Blob([xmlString], { type: 'application/xml' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 100);
  showToast('E-dec XML exported: ' + filename, 'success');
}

/* =========================================================
   TOAST NOTIFICATIONS
   ========================================================= */
let toastTimer = null;

function showToast(message, type) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast' + (type ? ' ' + type : '');
  // Force reflow
  toast.offsetHeight; // eslint-disable-line no-unused-expressions
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2800);
}

/* =========================================================
   KEYBOARD SHORTCUTS
   ========================================================= */
document.addEventListener('keydown', (e) => {
  // ESC closes modal
  if (e.key === 'Escape') {
    const overlay = document.getElementById('modal-overlay');
    if (overlay && overlay.style.display !== 'none') {
      hideModal();
    }
  }
});

/* =========================================================
   DRAG AND DROP REORDERING
   ========================================================= */
function initDragDrop() {
  const tbody = document.getElementById('products-tbody');
  let dragSrcId = null;

  tbody.addEventListener('dragstart', e => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    dragSrcId = row.dataset.id;
    setTimeout(() => row.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
  });

  tbody.addEventListener('dragover', e => {
    e.preventDefault();
    const row = e.target.closest('tr[data-id]');
    if (!row || row.dataset.id === dragSrcId) return;
    tbody.querySelectorAll('tr.drag-over').forEach(r => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });

  tbody.addEventListener('drop', e => {
    e.preventDefault();
    const row = e.target.closest('tr[data-id]');
    const targetId = row ? row.dataset.id : null;
    if (!dragSrcId || !targetId || dragSrcId === targetId) return;
    const srcIdx = state.products.findIndex(p => p.id === dragSrcId);
    const tgtIdx = state.products.findIndex(p => p.id === targetId);
    const [moved] = state.products.splice(srcIdx, 1);
    state.products.splice(tgtIdx, 0, moved);
    saveToStorage();
    renderTable();
  });

  tbody.addEventListener('dragend', () => {
    tbody.querySelectorAll('tr').forEach(r => r.classList.remove('dragging', 'drag-over'));
    dragSrcId = null;
  });
}

/* =========================================================
   INIT
   ========================================================= */
function init() {
  loadFromStorage();

  initCollapsibles();
  bindFormFields();
  updateSectionSummaries();
  renderTable();
  initHsCombobox();

  // Drag-and-drop reordering
  initDragDrop();

  render1174GroupUI();
  init1174GroupUI();

  // Country pickers for persistent fields
  initCountryPicker(document.getElementById('artist-country'), { showName: true });
  initCountryPicker(document.getElementById('edec-transport-country'));

  // Show vehicle country + plate only for Road (mode 3); flight number only for Air (mode 4)
  const transportModeEl    = document.getElementById('edec-mode');
  const transportVehicleFields = [
    document.getElementById('edec-transport-country'),
    document.getElementById('edec-transport-number'),
  ].map(el => el && el.closest('.form-group')).filter(Boolean);
  const flightNumberGroup = document.getElementById('flight-number-group');

  function syncTransportFields() {
    const isRoad = transportModeEl.value === '3';
    const isAir  = transportModeEl.value === '4';
    transportVehicleFields.forEach(fg => { fg.style.display = isRoad ? '' : 'none'; });
    if (flightNumberGroup) flightNumberGroup.style.display = isAir ? '' : 'none';
  }

  transportModeEl.addEventListener('change', syncTransportFields);
  // Re-check when vehicle country or artist country changes
  const transportCountryEl = document.getElementById('edec-transport-country');
  syncTransportFields();

  // Modal country picker (modal DOM always present)
  initCountryPicker(document.getElementById('m-origin'));

  // Venue contact mirrors artist full name unless the user has overridden it
  function syncVenueContact() {
    const artistName  = state.artist.fullName || '';
    const venueEl     = document.getElementById('venue-contact');
    if (!venueEl) return;
    // Only sync when the field is blank or still matches the artist name
    if (!state.meta.venueName || state.meta.venueName === artistName) {
      state.meta.venueName = artistName;
      venueEl.value = artistName;
    }
  }
  syncVenueContact(); // apply on load
  const artistNameEl = document.getElementById('artist-name');
  if (artistNameEl) artistNameEl.addEventListener('input', syncVenueContact);

  // Header buttons
  document.getElementById('btn-save-json').addEventListener('click', saveJSON);
  document.getElementById('btn-load-json').addEventListener('click', loadJSON);
  document.getElementById('file-input').addEventListener('change', handleFileLoad);

  // Flatpickr date pickers
  if (typeof flatpickr !== 'undefined') {
    fpStart = flatpickr('#event-date-start', {
      dateFormat: 'Y-m-d',
      defaultDate: state.meta.eventDateStart || null,
      onChange: (_, dateStr) => {
        state.meta.eventDateStart = dateStr || '';
        saveToStorage();
        updateSectionSummaries();
        autoGenerateLRP();
      },
    });
    fpEnd = flatpickr('#event-date-end', {
      dateFormat: 'Y-m-d',
      defaultDate: state.meta.eventDateEnd || null,
      onChange: (_, dateStr) => {
        state.meta.eventDateEnd = dateStr || '';
        saveToStorage();
        updateSectionSummaries();
      },
    });
  }

  // Doc-number select — triggers LRP re-generation
  const docNumEl = document.getElementById('doc-number');
  if (state.meta.documentNumber) docNumEl.value = String(state.meta.documentNumber);
  docNumEl.addEventListener('change', (e) => {
    state.meta.documentNumber = parseInt(e.target.value, 10) || 1;
    saveToStorage();
    autoGenerateLRP();
  });

  // Company code + artist country trigger LRP re-generation
  ['company-code', 'artist-country'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', autoGenerateLRP);
  });

  // Update origin cells live when artist country changes
  document.getElementById('artist-country').addEventListener('change', () => {
    const defaultOrigin = countryToCode(state.artist.countryOfOrigin) || '—';
    document.querySelectorAll('#products-tbody tr[data-id]').forEach(tr => {
      const id = tr.dataset.id;
      const p = state.products.find(pr => pr.id === id);
      if (p && !p.originCountry) {
        const cell = tr.querySelector('.col-origin');
        if (cell) cell.textContent = defaultOrigin;
      }
    });
  });

  // Initial LRP generation
  autoGenerateLRP();

  // Export buttons — each passes its own doc number
  document.getElementById('btn-export-import').addEventListener('click', () => printGoodsList(1));
  document.getElementById('btn-export-sold').addEventListener('click',   () => printGoodsList(2));
  document.getElementById('btn-export-return').addEventListener('click', () => printGoodsList(3));
  document.getElementById('btn-print-1174').addEventListener('click', print1174);

  // Add product button
  document.getElementById('btn-add-product').addEventListener('click', openAddModal);

  // E-dec XML generation
  document.getElementById('btn-generate-edec').addEventListener('click', generateEdecXML);

  // Modal controls
  document.getElementById('modal-close').addEventListener('click', hideModal);
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
  document.getElementById('modal-save').addEventListener('click', saveModal);

  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) {
      hideModal();
    }
  });

  // Live preview inputs in modal
  ['m-amount', 'm-weight', 'm-price', 'm-pricenote', 'm-totalweight', 'm-totalvalue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateModalPreview);
  });

  // Bidirectional weight sync
  document.getElementById('m-weight').addEventListener('input', () => { syncWeightFromPerItem(); updateModalPreview(); });
  document.getElementById('m-totalweight').addEventListener('input', () => { syncWeightFromTotal(); updateModalPreview(); });
  document.getElementById('m-amount').addEventListener('input', () => { syncWeightFromPerItem(); syncValueFromPerItem(); updateModalPreview(); });

  // Bidirectional value sync
  document.getElementById('m-price').addEventListener('input', () => { syncValueFromPerItem(); updateModalPreview(); });
  document.getElementById('m-totalvalue').addEventListener('input', () => { syncValueFromTotal(); updateModalPreview(); });

  // VAT hint update when VAT rate manually changed
  document.getElementById('m-vatrate').addEventListener('input', updateVatHint);

  // Dark theme toggle — dark is the default unless user has explicitly chosen light
  const themeCb = document.getElementById('theme-toggle-cb');
  const savedTheme = localStorage.getItem('zolltool_theme');
  if (savedTheme !== 'light') {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeCb.checked = true;
  }
  themeCb.addEventListener('change', () => {
    if (themeCb.checked) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('zolltool_theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('zolltool_theme', 'light');
    }
  });
}

/* =========================================================
   DISCLAIMER MODAL
   ========================================================= */
const DISCLAIMER_KEY = 'zolltool_disclaimer_accepted';

function initDisclaimer() {
  const overlay = document.getElementById('disclaimer-overlay');
  const acceptBtn = document.getElementById('disclaimer-accept');
  const skipCb = document.getElementById('disclaimer-skip-cb');

  if (!overlay || !acceptBtn) return;

  if (localStorage.getItem(DISCLAIMER_KEY) !== '1') {
    overlay.style.display = 'flex';
  }

  acceptBtn.addEventListener('click', () => {
    if (skipCb && skipCb.checked) {
      localStorage.setItem(DISCLAIMER_KEY, '1');
    }
    overlay.style.display = 'none';
  });
}

/* =========================================================
   IFRAME HEIGHT BRIDGE
   Notifies a parent page (e.g. Shopify) of the document's full
   scroll height so the iframe can be resized to fit without its
   own scrollbar appearing.
   ========================================================= */
function initHeightBridge() {
  if (window.parent === window) return; // not inside an iframe
  function postHeight() {
    window.parent.postMessage(
      { type: 'zolltool-height', height: document.documentElement.scrollHeight },
      '*'
    );
  }
  // Fire on any size change (collapsibles opening, products added, etc.)
  new ResizeObserver(postHeight).observe(document.body);
  postHeight();
}

document.addEventListener('DOMContentLoaded', () => { init(); initDisclaimer(); initHeightBridge(); });
