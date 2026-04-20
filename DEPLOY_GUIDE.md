# 🚀 คู่มือ Deploy ExpenseAI

## ภาพรวม Architecture

```
บิล/ใบเสร็จ (รูป/PDF)
      ↓
  Claude AI (วิเคราะห์)
      ↓
   ExpenseAI App  ←→  Google Sheets (เก็บข้อมูล)
  (Netlify host)
      ↓
  พิมพ์ PDF (ใบสำคัญจ่าย / ใบรับเงิน / รายงาน)
```

---

## ขั้นตอนที่ 1 — ตั้งค่า Google Sheets + Apps Script

### 1.1 สร้าง Google Spreadsheet
1. เปิด [Google Sheets](https://sheets.google.com) → **+ Blank**
2. ตั้งชื่อไฟล์ว่า `ExpenseAI Database`
3. จำ URL ของไฟล์ไว้ (ไม่ต้องทำอะไรในชีทตอนนี้ Apps Script จะสร้าง sheet ให้เอง)

### 1.2 เปิด Apps Script
1. ในไฟล์ Sheets → เมนู **Extensions → Apps Script**
2. จะเปิดหน้าต่าง Apps Script Editor

### 1.3 วางโค้ด
1. ลบโค้ดเดิมในไฟล์ `Code.gs` ทั้งหมด
2. วางโค้ดจากไฟล์ **`Code.gs`** ในโปรเจกต์นี้ทั้งหมด
3. กด **💾 Save** (Ctrl+S)

### 1.4 Deploy เป็น Web App
1. กด **Deploy → New deployment**
2. กดไอคอน ⚙️ เลือก **Web app**
3. ตั้งค่า:
   - Description: `ExpenseAI API`
   - Execute as: **Me**
   - Who has access: **Anyone** ⚠️ (ต้องเลือกนี้เพื่อให้ Netlify เรียกได้)
4. กด **Deploy**
5. กด **Authorize access** → เลือก Google account → Allow
6. **คัดลอก Web app URL** เก็บไว้ (หน้าตาประมาณ `https://script.google.com/macros/s/AKfy.../exec`)

### 1.5 ทดสอบ API
เปิด URL นี้ในเบราว์เซอร์:
```
https://script.google.com/macros/s/YOUR_ID/exec?action=list
```
ถ้าได้ `{"ok":true,"expenses":[],"count":0}` แสดงว่า API ทำงานถูกต้อง ✅

---

## ขั้นตอนที่ 2 — ตั้งค่าโปรเจกต์ในเครื่อง

### 2.1 ต้องมี Node.js
ตรวจสอบด้วยคำสั่ง:
```bash
node --version   # ต้องเป็น v18 ขึ้นไป
npm --version
```
ถ้าไม่มี ดาวน์โหลดที่ [nodejs.org](https://nodejs.org)

### 2.2 ดาวน์โหลดโปรเจกต์
แตกไฟล์ `expenseai.zip` แล้วเปิด terminal ในโฟลเดอร์นั้น

### 2.3 ติดตั้ง dependencies
```bash
npm install
```

### 2.4 สร้างไฟล์ .env
```bash
# คัดลอก .env.example เป็น .env
cp .env.example .env
```
แก้ไขไฟล์ `.env`:
```env
VITE_SHEET_API=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```
แทน `YOUR_SCRIPT_ID` ด้วย ID จริงจากขั้นตอน 1.4

### 2.5 ทดสอบในเครื่อง
```bash
npm run dev
```
เปิด `http://localhost:5173` ใน browser

---

## ขั้นตอนที่ 3 — Deploy ขึ้น Netlify

### วิธีที่ 1: Drag & Drop (ง่ายที่สุด) ⭐

1. Build โปรเจกต์:
```bash
npm run build
```
2. จะได้โฟลเดอร์ `dist/`
3. เปิด [netlify.com](https://netlify.com) → Login
4. ไปที่ **Sites → Add new site → Deploy manually**
5. **ลาก โฟลเดอร์ `dist`** วางในกล่อง
6. รอ deploy → ได้ URL เช่น `https://expenseai-xxx.netlify.app`

### วิธีที่ 2: เชื่อม GitHub (แนะนำถ้ามี repo)

1. Push โค้ดขึ้น GitHub
2. Netlify → **Import from Git → GitHub**
3. เลือก repo
4. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. **Environment variables** → เพิ่ม:
   - Key: `VITE_SHEET_API`
   - Value: URL จากขั้นตอน 1.4
6. กด **Deploy**

### ตั้งค่า Environment Variable ใน Netlify
ถ้า drag & drop ต้องตั้งหลัง deploy:
1. Site → **Site configuration → Environment variables**
2. Add: `VITE_SHEET_API = https://script.google.com/macros/s/.../exec`
3. **Trigger deploy ใหม่** (Deploys → Trigger deploy)

---

## ขั้นตอนที่ 4 — ทดสอบระบบ

1. เปิด URL Netlify
2. กด **📤 อัพโหลด AI** → ลองอัพรูปบิล
3. ตรวจสอบว่าข้อมูลปรากฏใน Google Sheets (ดู tab `expenses`)
4. ทดสอบ **🖨️ พิมพ์** ใบสำคัญจ่าย

---

## โครงสร้างไฟล์

```
expenseai/
├── src/
│   ├── App.jsx          ← แอพหลัก
│   └── main.jsx         ← entry point
├── Code.gs              ← Google Apps Script (วางใน Apps Script)
├── index.html
├── package.json
├── vite.config.js
├── netlify.toml
├── .env.example         ← template
└── .env                 ← ไม่ commit! ใส่ใน .gitignore
```

---

## แก้ปัญหาที่พบบ่อย

| ปัญหา | สาเหตุ | แก้ไข |
|-------|--------|--------|
| API ตอบ 403 | Who has access ไม่ถูก | ตั้ง "Anyone" แล้ว redeploy Apps Script |
| ข้อมูลไม่ขึ้น Sheets | URL ผิด | เช็ค VITE_SHEET_API ใน .env |
| AI วิเคราะห์ไม่ได้ | ใช้ quota Claude | ลองใหม่หรือ upgrade plan |
| พิมพ์ไม่ได้ | Popup blocked | กด Ctrl+P แทน หรือ Allow popup |
| Build fail | Node version เก่า | อัพเดต Node.js เป็น v18+ |

---

## หมายเหตุความปลอดภัย

- `.env` ห้าม commit ลง GitHub เด็ดขาด (เพิ่มใน `.gitignore`)
- Apps Script URL เป็น public — ใครก็เรียกได้ ถ้าต้องการความปลอดภัยเพิ่มให้เพิ่ม token check ใน `Code.gs`
- ข้อมูลบิลจะผ่าน Claude API — ไม่เก็บรูปถาวร แค่ base64 ชั่วคราว

---

## ต้องการช่วย?
บอก Claude ได้เลย! แค่บอกว่าติดขั้นตอนไหน 🙌
