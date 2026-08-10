const SPREADSHEET_ID = '1txdAgCo8ki7gFdFtElL4GA2g_e6VzHzz7qEIuhUCY7A';
const SHEET_NAME = 'Listings';
const API_VERSION = '2026-08-03.1';
const RULE_TABS = ['Keyword_Rules', 'Project_Master', 'Project_Aliases', 'Room_Type_Rules', 'Pet_Rules', 'Extraction_Config'];
const AUX_HEADERS = {
  Review_Queue: ['Created At', 'Status', 'Post Type', 'Project Raw', 'Project ID', 'Confidence', 'Conflict', 'Source URL', 'Source Text', 'Evidence JSON', 'Extraction JSON'],
  Import_Log: ['Created At', 'Level', 'Action', 'Post ID', 'Source URL', 'Message', 'Details JSON'],
  Project_Aliases: ['Alias', 'Normalized Alias', 'Project ID', 'Status', 'Created At']
};
const HEADERS = [
  'Date', 'Project', 'Price', 'Bedrooms', 'Room Type', 'Pet',
  'Location', 'Owner Name', 'Phone', 'Facebook Link', 'Post Text', 'Note'
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (payload.action === 'upsert_lead') {
      return upsertLead(spreadsheet, payload);
    }
    if (payload.action === 'append_record' && AUX_HEADERS[payload.sheet]) {
      return appendRecord(spreadsheet, payload.sheet, payload.row || {});
    }
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);

    ensureListingsSheet(sheet);
    removeBlankDataRows(sheet);

    const inputs = Array.isArray(payload.rows) ? payload.rows.slice(0, 100) : [payload];
    const existing = existingKeys(sheet);
    const accepted = [];
    let skipped = 0;
    inputs.forEach(function (input) {
      const link = safeText(input['Facebook Link']);
      const propertyId = propertyIdFromNote(safeText(input.Note));
      const sourceId = sourceIdFromNote(safeText(input.Note));
      if ((link && existing.links[link]) || (propertyId && existing.propertyIds[propertyId]) || (sourceId && existing.sourceIds[sourceId])) {
        skipped += 1;
        return;
      }
      if (link) existing.links[link] = true;
      if (propertyId) existing.propertyIds[propertyId] = true;
      if (sourceId) existing.sourceIds[sourceId] = true;
      accepted.push(HEADERS.map(function (header) { return safeText(input[header]); }));
    });
    const targetRow = Math.max(2, sheet.getLastRow() + 1);
    if (accepted.length) sheet.getRange(targetRow, 1, accepted.length, HEADERS.length).setNumberFormat('@').setValues(accepted);
    ensureFilter(sheet);
    return jsonResponse({ success: true, version: API_VERSION, row: accepted.length ? targetRow : null, added: accepted.length, skipped: skipped });
  } catch (error) {
    return jsonResponse({ success: false, error: String(error && error.message || error) });
  } finally {
    try { lock.releaseLock(); } catch (_) { /* lock was not acquired */ }
  }
}

function upsertLead(spreadsheet, payload) {
  const name = 'Leads';
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const required = Array.isArray(payload.headers) ? payload.headers : [];
  const existingHeaders = sheet.getLastRow() ? sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getDisplayValues()[0] : [];
  const headers = existingHeaders.slice();
  required.forEach(function (header) {
    if (headers.indexOf(header) !== -1) return;
    headers.push(header);
    sheet.getRange(1, headers.length).setValue(header).setFontWeight('bold');
  });
  if (!headers.length) throw new Error('ไม่พบหัวตาราง Leads');
  sheet.setFrozenRows(1);

  const sourceColumn = headers.indexOf('Source Post URL');
  const sourceUrl = safeText((payload.row || {})['Source Post URL']);
  let duplicateRow = 0;
  if (sourceColumn >= 0 && sourceUrl && sheet.getLastRow() >= 2) {
    const urls = sheet.getRange(2, sourceColumn + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let i = 0; i < urls.length; i += 1) if (String(urls[i][0] || '').trim() === sourceUrl) { duplicateRow = i + 2; break; }
  }
  if (duplicateRow && payload.updateDuplicate !== true) return jsonResponse({ success: true, duplicate: true, updated: false, row: duplicateRow });
  const targetRow = duplicateRow || Math.max(2, sheet.getLastRow() + 1);
  // Write only managed lead columns. Existing custom/formula columns keep
  // their values when a duplicate row is updated.
  required.forEach(function (header) {
    const column = headers.indexOf(header) + 1;
    if (column > 0) sheet.getRange(targetRow, column).setNumberFormat('@').setValue(safeText((payload.row || {})[header]));
  });
  return jsonResponse({ success: true, duplicate: Boolean(duplicateRow), updated: Boolean(duplicateRow), row: targetRow });
}

function appendRecord(spreadsheet, name, row) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const headers = AUX_HEADERS[name];
  if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#4338ca').setFontColor('#ffffff');
  const values = headers.map(function (header) { return safeText(row[header]); });
  const target = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(target, 1, 1, headers.length).setNumberFormat('@').setValues([values]);
  return jsonResponse({ success: true, version: API_VERSION, sheet: name, row: target });
}

function existingKeys(sheet) {
  const keys = { links: {}, propertyIds: {}, sourceIds: {} };
  if (sheet.getLastRow() < 2) return keys;
  const values = sheet.getRange(2, 10, sheet.getLastRow() - 1, 3).getDisplayValues();
  values.forEach(function (row) {
    const link = String(row[0] || '').trim();
    const propertyId = propertyIdFromNote(String(row[2] || ''));
    const sourceId = sourceIdFromNote(String(row[2] || ''));
    if (link) keys.links[link] = true;
    if (propertyId) keys.propertyIds[propertyId] = true;
    if (sourceId) keys.sourceIds[sourceId] = true;
  });
  return keys;
}

function sourceIdFromNote(note) {
  const match = String(note || '').match(/Source ID:\s*([^|\s]+)/i);
  return match ? match[1] : '';
}

function propertyIdFromNote(note) {
  const match = String(note || '').match(/property\s+#(\d+)/i);
  return match ? match[1] : '';
}

function removeBlankDataRows(sheet) {
  if (sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getDisplayValues();
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index].every(function (value) { return !String(value || '').trim(); })) sheet.deleteRow(index + 2);
  }
}

function ensureListingsSheet(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  const currentHeader = headerRange.getDisplayValues()[0];
  if (currentHeader.every(function (value) { return !value; })) {
    headerRange
      .setNumberFormat('@')
      .setValues([HEADERS])
      .setFontWeight('bold')
      .setFontColor('#ffffff')
      .setBackground('#4338ca')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(3, 110);
    sheet.setColumnWidths(4, 3, 105);
    sheet.setColumnWidth(7, 180);
    sheet.setColumnWidths(8, 2, 140);
    sheet.setColumnWidth(10, 260);
    sheet.setColumnWidth(11, 420);
    sheet.setColumnWidth(12, 260);
  }
}

function ensureFilter(sheet) {
  if (sheet.getFilter()) return;
  const rowCount = Math.max(2, sheet.getLastRow());
  sheet.getRange(1, 1, rowCount, HEADERS.length).createFilter();
}

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'rules') {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const tabs = {};
      RULE_TABS.forEach(function (name) {
        const sheet = spreadsheet.getSheetByName(name);
        tabs[name] = !sheet || !sheet.getLastRow() ? [] : sheet.getRange(1, 1, sheet.getLastRow(), Math.max(1, sheet.getLastColumn())).getDisplayValues();
      });
      return jsonResponse({ success: true, version: API_VERSION, tabs: tabs });
    }
    if (e && e.parameter && e.parameter.action === 'list') {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = spreadsheet.getSheetByName(SHEET_NAME);
      if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ success: true, rows: [], total: 0, page: 1, pages: 1 });
      const query = String(e.parameter.q || '').trim().toLowerCase();
      const pageSize = Math.min(100, Math.max(10, Number(e.parameter.pageSize) || 30));
      const requestedPage = Math.max(1, Number(e.parameter.page) || 1);
      const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getDisplayValues();
      let filtered = query ? values.filter(function (row) { return row.join(' ').toLowerCase().indexOf(query) !== -1; }) : values;
      const bedrooms = String(e.parameter.bedrooms || '').trim();
      const minPrice = parsePrice(e.parameter.minPrice);
      const maxPrice = parsePrice(e.parameter.maxPrice);
      if (bedrooms) filtered = filtered.filter(function (row) { return String(row[3] || '').trim().toLowerCase() === bedrooms.toLowerCase(); });
      if (minPrice !== null) filtered = filtered.filter(function (row) { const price = parsePrice(row[2]); return price !== null && price >= minPrice; });
      if (maxPrice !== null) filtered = filtered.filter(function (row) { const price = parsePrice(row[2]); return price !== null && price <= maxPrice; });
      const priceSort = String(e.parameter.priceSort || '');
      if (priceSort === 'asc' || priceSort === 'desc') filtered.sort(function (a, b) {
        const left = parsePrice(a[2]); const right = parsePrice(b[2]);
        if (left === null) return 1; if (right === null) return -1;
        return priceSort === 'asc' ? left - right : right - left;
      });
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const page = Math.min(requestedPage, pages);
      const rows = filtered.slice((page - 1) * pageSize, page * pageSize).map(function (row, index) {
        const item = { _row: (page - 1) * pageSize + index + 2 };
        HEADERS.forEach(function (header, column) { item[header] = row[column] || ''; });
        return item;
      });
      return jsonResponse({ success: true, version: API_VERSION, rows: rows, total: filtered.length, page: page, pages: pages });
    }
    return jsonResponse({ success: true, version: API_VERSION, service: 'Duke Estate Listings', sheet: SHEET_NAME });
  } catch (error) {
    return jsonResponse({ success: false, error: String(error && error.message || error) });
  }
}

function parsePrice(value) {
  const text = String(value == null ? '' : value).replace(/,/g, '');
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function safeText(value) {
  const text = value == null ? '' : String(value).slice(0, 20000);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function jsonResponse(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
