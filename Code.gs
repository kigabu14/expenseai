// ============================================================
// ExpenseAI — Google Apps Script API
// วิธีใช้: Extensions > Apps Script > วางโค้ดนี้ > Deploy > New deployment
// ============================================================

const SHEET_NAME = "expenses";
const HEADERS = [
  "id","voucherNo","date","vendor","description","category","categoryLabel",
  "group","paymentMethod","amount","tax_amount","net","reference","notes",
  "paid","billFileName","createdAt","updatedAt"
];

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  // Allow CORS from any origin (Netlify)
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const method = e.parameter.method || (e.postData ? "POST" : "GET");
    const action = e.parameter.action || "list";

    let result;
    if (action === "list")   result = listExpenses(e);
    else if (action === "add")    result = addExpense(e);
    else if (action === "update") result = updateExpense(e);
    else if (action === "delete") result = deleteExpense(e);
    else if (action === "bulk")   result = bulkAdd(e);
    else if (action === "summary") result = getSummary(e);
    else result = { error: "Unknown action" };

    output.setContent(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    output.setContent(JSON.stringify({ ok: false, error: err.message }));
  }

  return output;
}

// ── Sheet helpers ────────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setBackground("#0f172a");
    headerRange.setFontColor("white");
    headerRange.setFontWeight("bold");
    sheet.setFrozenRows(1);
    // Set column widths
    sheet.setColumnWidth(3, 100);  // date
    sheet.setColumnWidth(4, 180);  // vendor
    sheet.setColumnWidth(5, 220);  // description
    sheet.setColumnWidth(10, 100); // amount
  }
  return sheet;
}

function rowToObj(row) {
  const obj = {};
  HEADERS.forEach((h, i) => obj[h] = row[i]);
  obj.amount     = parseFloat(obj.amount)     || 0;
  obj.tax_amount = parseFloat(obj.tax_amount) || 0;
  obj.net        = parseFloat(obj.net)        || 0;
  obj.paid       = obj.paid === "TRUE" || obj.paid === true;
  return obj;
}

function objToRow(obj) {
  return HEADERS.map(h => {
    if (h === "paid") return obj[h] ? "TRUE" : "FALSE";
    return obj[h] !== undefined ? obj[h] : "";
  });
}

// ── CRUD ─────────────────────────────────────────────────────
function listExpenses(e) {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return { expenses: [] };

  let expenses = data.slice(1).map(rowToObj);

  // Filter by period
  const period = e.parameter.period;
  if (period && period !== "all") {
    const now = new Date();
    expenses = expenses.filter(exp => {
      if (!exp.date) return false;
      const d = new Date(exp.date);
      if (period === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      if (period === "year")  return d.getFullYear() === now.getFullYear();
      if (period === "week")  { const w = new Date(now); w.setDate(now.getDate()-7); return d >= w; }
      return true;
    });
  }

  expenses.sort((a, b) => new Date(b.date||0) - new Date(a.date||0));
  return { expenses, count: expenses.length };
}

function addExpense(e) {
  const sheet = getSheet();
  const body  = JSON.parse(e.postData.contents);
  const now   = new Date().toISOString();

  const expense = {
    ...body,
    id:        body.id || Utilities.getUuid(),
    createdAt: now,
    updatedAt: now,
    net:       (parseFloat(body.amount)||0) - (parseFloat(body.tax_amount)||0),
  };

  sheet.appendRow(objToRow(expense));

  // Color row by group
  const lastRow = sheet.getLastRow();
  if (expense.group === "goods") {
    sheet.getRange(lastRow, 1, 1, HEADERS.length).setBackground("#eff6ff");
  } else {
    sheet.getRange(lastRow, 1, 1, HEADERS.length).setBackground("#fefce8");
  }

  return { expense };
}

function bulkAdd(e) {
  const sheet    = getSheet();
  const body     = JSON.parse(e.postData.contents);
  const expenses = body.expenses || [];
  const now      = new Date().toISOString();
  const added    = [];

  expenses.forEach(exp => {
    const expense = {
      ...exp,
      id:        exp.id || Utilities.getUuid(),
      createdAt: now,
      updatedAt: now,
      net:       (parseFloat(exp.amount)||0) - (parseFloat(exp.tax_amount)||0),
    };
    sheet.appendRow(objToRow(expense));
    added.push(expense);

    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, HEADERS.length)
      .setBackground(expense.group === "goods" ? "#eff6ff" : "#fefce8");
  });

  return { added: added.length, expenses: added };
}

function updateExpense(e) {
  const sheet  = getSheet();
  const body   = JSON.parse(e.postData.contents);
  const data   = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.id) {
      const existing = rowToObj(data[i]);
      const updated  = {
        ...existing, ...body,
        updatedAt: new Date().toISOString(),
        net: (parseFloat(body.amount || existing.amount)||0) - (parseFloat(body.tax_amount || existing.tax_amount)||0),
      };
      sheet.getRange(i+1, 1, 1, HEADERS.length).setValues([objToRow(updated)]);
      return { expense: updated };
    }
  }
  throw new Error("ไม่พบรายการ id: " + body.id);
}

function deleteExpense(e) {
  const sheet = getSheet();
  const id    = e.parameter.id;
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { deleted: id };
    }
  }
  throw new Error("ไม่พบรายการ id: " + id);
}

function getSummary(e) {
  const { expenses } = listExpenses(e);
  const total  = expenses.reduce((s, ex) => s + ex.amount, 0);
  const goods  = expenses.filter(ex => ex.group === "goods").reduce((s, ex) => s + ex.amount, 0);
  const exp    = expenses.filter(ex => ex.group === "expense").reduce((s, ex) => s + ex.amount, 0);
  const paid   = expenses.filter(ex => ex.paid).length;
  const unpaid = expenses.filter(ex => !ex.paid).length;

  // By category
  const byCat = {};
  expenses.forEach(ex => {
    if (!byCat[ex.category]) byCat[ex.category] = { amount: 0, count: 0, label: ex.categoryLabel };
    byCat[ex.category].amount += ex.amount;
    byCat[ex.category].count++;
  });

  return { total, goods, expense: exp, paid, unpaid, count: expenses.length, byCat };
}
