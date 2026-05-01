const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONTRACTS_SPREADSHEET_ID = '1Mo52GlsrZw_lcsGFZd_zgnfPIYIMubQb_vikZshtcjE';
const SPECIALISTS_SPREADSHEET_ID = '1_8eGCtwKewGrrCvLebGRGaXxyHOXrgXRZe6Ajtxh2Rk';

const FRONTEND_SRC = path.resolve(__dirname, '../../../frontend/src');

// --- HTTP fetch with redirect following ------------------------------------ //

function fetchText(url, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchText(next, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sheetCsvUrl(spreadsheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
}

// --- CSV parser ------------------------------------------------------------ //

function parseRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseRow(lines[0]).map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
  );
  return lines.slice(1).map((line) => {
    const vals = parseRow(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim(); });
    return row;
  });
}

// --- Row mappers ----------------------------------------------------------- //

function get(row, ...keys) {
  for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
  return '';
}

function num(row, ...keys) {
  const v = parseInt(get(row, ...keys) || '0', 10);
  return Number.isNaN(v) ? 0 : v;
}

function mapContractRow(row) {
  // Support both plain headers and the txt-prefixed headers used in the design spreadsheet
  const title = get(row, 'txttitle', 'title', 'contract', 'contract_title', 'name');
  if (!title) return null;

  const card = {
    copies: num(row, 'copies') || 1,
    title,
    coins: num(row, 'txtmoney', 'coins', 'coin', 'money'),
    renown: parseInt(get(row, 'txtrenown', 'renown') || '0', 10) || 0,
    region: get(row, 'txtregion', 'region').toLowerCase(),
    type: get(row, 'txttype', 'type', 'contract_type').toLowerCase(),
    cardNumber: num(row, 'txtcardnumber', 'card_number', 'cardnumber', 'card', 'number', 'no', '#', 'id'),
    requirements: {
      melee: num(row, 'txtmelee', 'melee', 'melee_req'),
      ranged: num(row, 'txtranged', 'ranged', 'ranged_req'),
      mounted: num(row, 'txtmounted', 'mounted', 'mounted_req'),
    },
    tier: (get(row, 'txttier', 'tier') || 'A').toUpperCase(),
  };

  const effect = get(row, 'txtmuster', 'completion_effect', 'completioneffect', 'completion_effects', 'effect', 'on_completion');
  if (effect) card.completionEffect = effect;

  return card;
}

function mapSpecialistRow(row) {
  // Support both plain headers and the txt-prefixed headers used in the design spreadsheet
  const name = get(row, 'txtcardname', 'name', 'specialist', 'specialist_name');
  if (!name) return null;

  return {
    name,
    tier: (get(row, 'txttier', 'tier') || 'A').toUpperCase(),
    copies: num(row, 'copies') || 1,
    cost: num(row, 'txtcost', 'cost'),
    condition: get(row, 'txtcondition', 'condition', 'type'),
    effect: get(row, 'txteffect', 'effect', 'description', 'ability'),
  };
}

// --- File writers ---------------------------------------------------------- //

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function writeContractsFile(spreadsheetId, cards) {
  const sync = {
    spreadsheetId,
    sourceUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/`,
    syncedAt: todayString(),
  };
  const content = `export const CONTRACT_DATA_SYNC = ${JSON.stringify(sync, null, 2)};\n\nexport const CONTRACT_CARDS = ${JSON.stringify(cards, null, 2)};\n`;
  fs.writeFileSync(path.join(FRONTEND_SRC, 'contractsData.js'), content, 'utf8');
}

function writeSpecialistsFile(spreadsheetId, cards) {
  const sync = {
    spreadsheetId,
    sourceUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/`,
    syncedAt: todayString(),
  };
  const content = `export const SPECIALIST_DATA_SYNC = ${JSON.stringify(sync, null, 2)};\n\nexport const SPECIALIST_CARDS = ${JSON.stringify(cards, null, 2)};\n`;
  fs.writeFileSync(path.join(FRONTEND_SRC, 'specialistsData.js'), content, 'utf8');
}

// --- Controllers ----------------------------------------------------------- //

async function syncContracts(req, res) {
  try {
    const csv = await fetchText(sheetCsvUrl(CONTRACTS_SPREADSHEET_ID));
    const rows = parseCsv(csv);
    const cards = rows.map(mapContractRow).filter(Boolean);
    if (cards.length === 0) {
      return res.status(422).json({ success: false, error: 'No contract rows parsed — check spreadsheet column headers.' });
    }
    writeContractsFile(CONTRACTS_SPREADSHEET_ID, cards);
    res.json({ success: true, count: cards.length, syncedAt: todayString() });
  } catch (err) {
    console.error('syncContracts error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function syncSpecialists(req, res) {
  try {
    const csv = await fetchText(sheetCsvUrl(SPECIALISTS_SPREADSHEET_ID));
    const rows = parseCsv(csv);
    const cards = rows.map(mapSpecialistRow).filter(Boolean);
    if (cards.length === 0) {
      return res.status(422).json({ success: false, error: 'No specialist rows parsed — check spreadsheet column headers.' });
    }
    writeSpecialistsFile(SPECIALISTS_SPREADSHEET_ID, cards);
    res.json({ success: true, count: cards.length, syncedAt: todayString() });
  } catch (err) {
    console.error('syncSpecialists error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { syncContracts, syncSpecialists };
