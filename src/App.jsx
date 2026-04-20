import { useState, useRef, useCallback, useEffect } from "react";

// ─── Config ─────────────────────────────────────────────────────────────────
// วางลิงก์ Google Apps Script Web App URL ตรงนี้หลัง deploy
const SHEET_API = import.meta.env.VITE_SHEET_API || "";

// ─── Constants ───────────────────────────────────────────────────────────────
const CATS = [
  { id:"goods_purchase", label:"ซื้อสินค้าเพื่อขาย",     icon:"🛒", color:"#0ea5e9", group:"goods"   },
  { id:"goods_import",   label:"นำเข้าสินค้า",           icon:"🚢", color:"#0284c7", group:"goods"   },
  { id:"goods_material", label:"วัตถุดิบ / บรรจุภัณฑ์", icon:"📦", color:"#0369a1", group:"goods"   },
  { id:"food",           label:"อาหาร & เครื่องดื่ม",     icon:"🍽️", color:"#f59e0b", group:"expense" },
  { id:"transport",      label:"ค่าเดินทาง",              icon:"🚗", color:"#3b82f6", group:"expense" },
  { id:"utilities",      label:"ค่าสาธารณูปโภค",          icon:"💡", color:"#10b981", group:"expense" },
  { id:"office",         label:"ค่าสำนักงาน",             icon:"🏢", color:"#6366f1", group:"expense" },
  { id:"marketing",      label:"ค่าการตลาด",              icon:"📢", color:"#ec4899", group:"expense" },
  { id:"equipment",      label:"อุปกรณ์ & เครื่องใช้",    icon:"🔧", color:"#f97316", group:"expense" },
  { id:"salary",         label:"เงินเดือน & ค่าจ้าง",     icon:"👥", color:"#8b5cf6", group:"expense" },
  { id:"tax_fee",        label:"ภาษี & ค่าธรรมเนียม",     icon:"📋", color:"#ef4444", group:"expense" },
  { id:"other",          label:"อื่นๆ",                   icon:"📦", color:"#6b7280", group:"expense" },
];
const PAY    = ["เงินสด","โอนเงิน","บัตรเครดิต","บัตรเดบิต","QR Code","เช็ค","อื่นๆ"];
const fmt    = n => Number(n||0).toLocaleString("th-TH",{minimumFractionDigits:2});
const genId  = () => Date.now().toString(36)+Math.random().toString(36).slice(2);
const getCat = id => CATS.find(c=>c.id===id)||CATS[CATS.length-1];
const thDate = d => d ? new Date(d+"T00:00:00").toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"}) : "-";
const toB64  = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});

// ─── Sheets API ──────────────────────────────────────────────────────────────
const api = {
  async call(action, params={}, body=null) {
    if(!SHEET_API) throw new Error("ยังไม่ได้ตั้งค่า SHEET_API ใน .env");
    const url = new URL(SHEET_API);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
    const opts = body
      ? {method:"POST", body:JSON.stringify(body), headers:{"Content-Type":"application/json"}}
      : {method:"GET"};
    const res = await fetch(url.toString(), opts);
    const d   = await res.json();
    if(!d.ok) throw new Error(d.error||"API error");
    return d;
  },
  list:   (period="all") => api.call("list",{period}),
  add:    expense => api.call("add",{},{...expense}),
  bulk:   expenses => api.call("bulk",{},{expenses}),
  update: expense => api.call("update",{},{...expense}),
  delete: id => api.call("delete",{id}),
};

// ─── AI Analysis ─────────────────────────────────────────────────────────────
async function analyzeFile(b64, mime) {
  const isImg = mime.startsWith("image/");
  const contentItem = isImg
    ? {type:"image",source:{type:"base64",media_type:mime,data:b64}}
    : {type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}};
  const PROMPT = `คุณคือผู้เชี่ยวชาญอ่านบิล/ใบเสร็จภาษาไทยและอังกฤษ รวมถึงบิลเงินสดที่เขียนมือหรือปริ้นจาก POS
ตอบเป็น JSON array เท่านั้น ห้ามมี backtick หรือข้อความอื่น
- ชื่อร้าน: อยู่บนสุด ถ้าไม่มีให้ใส่ "ร้านค้าทั่วไป"
- วันที่: แปลง พ.ศ.→ค.ศ. (ลบ 543) format "YYYY-MM-DD"
- ยอดเงิน: มองหา "รวม","ยอดรวม","total","รับเงิน","จำนวนเงิน" ตัด ฿ บาท ออก
- ภาษี: VAT, ภาษี, 7% ถ้าไม่มีให้ใส่ 0
category: goods_purchase=ซื้อสินค้าเพื่อขายต่อ, goods_import=นำเข้า, goods_material=วัตถุดิบ
food=อาหาร, transport=เดินทาง/น้ำมัน, utilities=ค่าไฟ/น้ำ, office=ค่าสำนักงาน
marketing=โฆษณา, equipment=อุปกรณ์, salary=เงินเดือน, tax_fee=ภาษี, other=อื่นๆ
[{"vendor":"ชื่อร้าน","amount":ตัวเลข,"date":"YYYY-MM-DD","description":"รายละเอียด","category":"id","tax_amount":ตัวเลข,"confidence":"high|medium|low","paymentMethod":"เงินสด"}]`;
  const res = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:{"Content-Type":"application/json","anthropic-version":"2023-06-01"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2000,
      messages:[{role:"user",content:[contentItem,{type:"text",text:PROMPT}]}]})
  });
  if(!res.ok){const t=await res.text();throw new Error(`AI ${res.status}: ${t.slice(0,80)}`);}
  const d = await res.json();
  const raw = (d.content?.[0]?.text||"[]").trim().replace(/```json|```/gi,"").trim();
  try{const p=JSON.parse(raw.startsWith("[")?raw:"["+raw+"]");return Array.isArray(p)?p:[p];}
  catch{const m=raw.match(/\[[\s\S]*\]/);if(m)return JSON.parse(m[0]);throw new Error("แปลง AI ไม่ได้");}
}

// ─── Print ───────────────────────────────────────────────────────────────────
function buildVoucherContent(e) {
  const cat=getCat(e.category); const net=(e.amount||0)-(e.tax_amount||0);
  const grp=cat.group==="goods"?"สินค้าเพื่อขาย":"ค่าใช้จ่าย";
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:16px">
  <div><div style="font-size:22px;font-weight:800">ใบสำคัญจ่าย</div><div style="font-size:11px;color:#64748b;margin-top:3px">Payment Voucher</div>
  <div style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${cat.color}18;color:${cat.color};margin-top:6px">${cat.icon} ${grp} › ${cat.label}</div></div>
  <div style="text-align:right"><div style="font-size:16px;font-weight:800">${e.voucherNo||"-"}</div><div style="font-size:11px;color:#64748b">วันที่ ${thDate(e.date)}</div>
  ${e.paid?'<div style="display:inline-block;border:2px solid #10b981;color:#10b981;font-weight:700;font-size:11px;letter-spacing:2px;padding:2px 8px;border-radius:4px;margin-top:5px">จ่ายแล้ว</div>':""}</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
  ${[["จ่ายให้",e.vendor||"-"],["วิธีชำระเงิน",e.paymentMethod||"-"],["ประเภท",cat.icon+" "+cat.label],["อ้างอิง",e.reference||"-"]].map(([l,v])=>`<div style="border:1px solid #e2e8f0;padding:9px 13px;border-radius:6px"><div style="font-size:10px;color:#94a3b8;text-transform:uppercase">${l}</div><div style="font-size:13px;font-weight:700;margin-top:3px">${v}</div></div>`).join("")}
</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px">
  <thead><tr><th style="background:#0f172a;color:#fff;padding:8px 10px;text-align:left;width:45%">รายละเอียด</th><th style="background:#0f172a;color:#fff;padding:8px 10px;text-align:right">ก่อนภาษี (บาท)</th><th style="background:#0f172a;color:#fff;padding:8px 10px;text-align:right">ภาษี (บาท)</th><th style="background:#0f172a;color:#fff;padding:8px 10px;text-align:right">รวม (บาท)</th></tr></thead>
  <tbody><tr><td style="padding:9px 10px;border-bottom:1px solid #f1f5f9">${e.description||"-"}</td><td style="padding:9px 10px;text-align:right;border-bottom:1px solid #f1f5f9">${fmt(net)}</td><td style="padding:9px 10px;text-align:right;border-bottom:1px solid #f1f5f9">${fmt(e.tax_amount||0)}</td><td style="padding:9px 10px;text-align:right;font-weight:800;border-bottom:1px solid #f1f5f9">${fmt(e.amount)}</td></tr></tbody>
</table>
<div style="display:flex;justify-content:flex-end;margin-bottom:14px"><table style="width:270px;font-size:12px;border-collapse:collapse">
  <tr><td style="padding:5px 10px">ยอดก่อนภาษี</td><td style="padding:5px 10px;text-align:right">${fmt(net)} บาท</td></tr>
  <tr><td style="padding:5px 10px">ภาษีมูลค่าเพิ่ม 7%</td><td style="padding:5px 10px;text-align:right">${fmt(e.tax_amount||0)} บาท</td></tr>
  <tr><td style="padding:8px 10px;font-weight:800;font-size:15px;border-top:2px solid #0f172a">ยอดรวมทั้งสิ้น</td><td style="padding:8px 10px;text-align:right;font-weight:800;font-size:15px;border-top:2px solid #0f172a">${fmt(e.amount)} บาท</td></tr>
</table></div>
${e.notes?`<div style="background:#f8fafc;border-left:4px solid ${cat.color};padding:9px 13px;border-radius:4px;font-size:12px;margin-bottom:14px"><b>หมายเหตุ:</b> ${e.notes}</div>`:""}
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:48px">
  ${["ผู้จ่ายเงิน","ผู้อนุมัติ","ผู้รับเงิน"].map(s=>`<div style="text-align:center"><div style="border-top:1px solid #0f172a;padding-top:6px;font-size:11px;color:#64748b;margin-top:44px">${s}</div></div>`).join("")}
</div>
<div style="margin-top:20px;text-align:center;font-size:10px;color:#cbd5e1;border-top:1px solid #f1f5f9;padding-top:8px">พิมพ์โดย ExpenseAI • ${new Date().toLocaleString("th-TH")}</div>`;
}

function buildReceiptContent(e) {
  const cat=getCat(e.category); const net=(e.amount||0)-(e.tax_amount||0);
  const rcNo=(e.voucherNo||"RC-0001").replace("PV-","RC-");
  return `<div style="display:flex;justify-content:space-between;border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:16px">
  <div><div style="font-size:22px;font-weight:800">ใบรับรองการรับเงิน</div><div style="font-size:11px;color:#64748b;margin-top:3px">Official Receipt</div></div>
  <div style="text-align:right"><div style="font-size:16px;font-weight:800">${rcNo}</div><div style="font-size:11px;color:#64748b">วันที่ ${thDate(e.date)}</div>
  <div style="display:inline-block;border:2px solid #10b981;color:#10b981;font-weight:700;font-size:11px;letter-spacing:2px;padding:2px 8px;border-radius:4px;margin-top:5px">ได้รับเงินแล้ว</div></div>
</div>
<div style="background:#f0fdf4;border:1.5px solid #6ee7b7;border-radius:8px;padding:14px 18px;margin-bottom:14px">
  <div style="font-size:11px;color:#064e3b;font-weight:700;margin-bottom:6px">ได้รับเงินจาก</div>
  <div style="font-size:15px;font-weight:800;margin-bottom:8px">___________________________________</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <div><div style="font-size:10px;color:#94a3b8">วิธีชำระเงิน</div><div style="font-weight:700;margin-top:2px">${e.paymentMethod||"เงินสด"}</div></div>
    <div><div style="font-size:10px;color:#94a3b8">เลขที่อ้างอิง</div><div style="font-weight:700;margin-top:2px">${e.reference||"-"}</div></div>
  </div>
</div>
<table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px">
  <thead><tr><th style="background:#0f172a;color:#fff;padding:8px 10px;text-align:left;width:50%">รายการ</th><th style="background:#0f172a;color:#fff;padding:8px 10px;text-align:right">จำนวนหน่วย</th><th style="background:#0f172a;color:#fff;padding:8px 10px;text-align:right">ราคา</th><th style="background:#0f172a;color:#fff;padding:8px 10px;text-align:right">จำนวนเงิน</th></tr></thead>
  <tbody><tr><td style="padding:9px 10px;border-bottom:1px solid #f1f5f9">${e.description||"-"}</td><td style="padding:9px 10px;text-align:right;border-bottom:1px solid #f1f5f9">1</td><td style="padding:9px 10px;text-align:right;border-bottom:1px solid #f1f5f9">${fmt(net)}</td><td style="padding:9px 10px;text-align:right;font-weight:800;border-bottom:1px solid #f1f5f9">${fmt(net)}</td></tr></tbody>
</table>
<div style="display:flex;justify-content:flex-end;margin-bottom:14px"><table style="width:270px;font-size:12px;border-collapse:collapse">
  <tr><td style="padding:5px 10px">ก่อนภาษี</td><td style="padding:5px 10px;text-align:right">${fmt(net)} บาท</td></tr>
  <tr><td style="padding:5px 10px">ภาษีมูลค่าเพิ่ม 7%</td><td style="padding:5px 10px;text-align:right">${fmt(e.tax_amount||0)} บาท</td></tr>
  <tr><td style="padding:8px 10px;font-weight:800;font-size:15px;color:#059669;border-top:2px solid #0f172a">ยอดรวมที่ได้รับ</td><td style="padding:8px 10px;text-align:right;font-weight:800;font-size:15px;color:#059669;border-top:2px solid #0f172a">${fmt(e.amount)} บาท</td></tr>
</table></div>
<div style="border:2px solid #0f172a;border-radius:8px;padding:14px 18px;margin-bottom:14px">
  <div style="font-size:11px;color:#64748b;margin-bottom:4px">จำนวนเงิน (ตัวอักษร)</div>
  <div style="font-size:14px;font-weight:800">_____________________________________________ บาท</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:48px">
  ${["ผู้รับเงิน","ผู้จ่ายเงิน","ผู้อนุมัติ"].map(s=>`<div style="text-align:center"><div style="border-top:1px solid #0f172a;padding-top:6px;font-size:11px;color:#64748b;margin-top:44px">${s}</div></div>`).join("")}
</div>
<div style="margin-top:20px;text-align:center;font-size:10px;color:#cbd5e1;border-top:1px solid #f1f5f9;padding-top:8px">ExpenseAI • ${new Date().toLocaleString("th-TH")}</div>`;
}

function buildReportContent(rows,label,totals) {
  const rowsHtml=rows.map((e,i)=>{const cat=getCat(e.category);const net=(e.amount||0)-(e.tax_amount||0);return`<tr style="background:${i%2?"#f8fafc":"#fff"}"><td style="padding:6px 8px;font-size:10px;color:#94a3b8">${e.voucherNo||""}</td><td style="padding:6px 8px;white-space:nowrap">${e.date||""}</td><td style="padding:6px 8px;font-weight:600">${e.vendor||""}</td><td style="padding:6px 8px;color:#64748b">${e.description||""}</td><td style="padding:6px 8px"><span style="background:${cat.group==="goods"?"#e0f2fe":"#fef3c7"};color:${cat.group==="goods"?"#0369a1":"#92400e"};padding:1px 7px;border-radius:20px;font-size:10px;font-weight:700">${cat.group==="goods"?"🛒 สินค้า":"💸 ค่าใช้จ่าย"}</span></td><td style="padding:6px 8px;font-size:11px">${cat.label}</td><td style="padding:6px 8px">${e.paymentMethod||""}</td><td style="padding:6px 8px;text-align:right">${fmt(net)}</td><td style="padding:6px 8px;text-align:right">${fmt(e.tax_amount||0)}</td><td style="padding:6px 8px;text-align:right;font-weight:700">${fmt(e.amount)}</td><td style="padding:6px 8px;text-align:center">${e.paid?"✅":"⏳"}</td></tr>`;}).join("");
  return `<div style="display:flex;justify-content:space-between;border-bottom:3px solid #0f172a;padding-bottom:10px;margin-bottom:12px"><div><div style="font-size:17px;font-weight:800">รายงานค่าใช้จ่าย</div><div style="font-size:11px;color:#64748b;margin-top:2px">${label}</div></div><div style="text-align:right;font-size:10px;color:#64748b">พิมพ์: ${new Date().toLocaleString("th-TH")}</div></div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">${[["ยอดรวม","฿"+fmt(totals.total),"#6366f1"],["🛒 สินค้า","฿"+fmt(totals.goods),"#0ea5e9"],["💸 ค่าใช้จ่าย","฿"+fmt(totals.exp),"#f59e0b"],["รายการ",rows.length+" รายการ","#10b981"]].map(([l,v,c])=>`<div style="border:1px solid #e2e8f0;padding:8px 10px;border-radius:6px"><div style="font-size:9px;color:#94a3b8;text-transform:uppercase">${l}</div><div style="font-size:14px;font-weight:800;color:${c};margin-top:2px">${v}</div></div>`).join("")}</div>
<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#0f172a">${["เลขที่","วันที่","ร้าน/บริษัท","รายละเอียด","กลุ่ม","ประเภท","วิธีจ่าย","ก่อนภาษี","ภาษี","ยอดรวม","สถานะ"].map(h=>`<th style="padding:7px 8px;text-align:${["ก่อนภาษี","ภาษี","ยอดรวม"].includes(h)?"right":"left"};color:#94a3b8;font-weight:700;font-size:10px">${h}</th>`).join("")}</tr></thead>
<tbody>${rowsHtml}</tbody>
<tfoot><tr style="background:#f1f5f9;border-top:2px solid #e2e8f0"><td colspan="7" style="padding:8px;text-align:right;font-weight:800">รวม (${rows.length} รายการ)</td><td style="padding:8px;text-align:right;font-weight:800">${fmt(totals.net)}</td><td style="padding:8px;text-align:right;font-weight:800">${fmt(totals.tax)}</td><td style="padding:8px;text-align:right;font-weight:800;font-size:13px;color:#6366f1">฿${fmt(totals.total)}</td><td></td></tr></tfoot></table>`;
}

// ─── Print Overlay ───────────────────────────────────────────────────────────
function PrintOverlay({title, content, isLandscape, onClose}) {
  useEffect(()=>{
    const s=document.createElement("style");s.id="eai-print";
    s.textContent=`@media print{body>*:not(#eai-overlay){visibility:hidden!important}#eai-overlay{visibility:visible!important;position:fixed!important;inset:0!important;z-index:99999!important;background:white!important}#eai-overlay .np{display:none!important}@page{size:A4 ${isLandscape?"landscape":"portrait"};margin:12mm}-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
    document.head.appendChild(s);
    return()=>{s.remove();};
  },[isLandscape]);

  return(
    <div id="eai-overlay" style={{position:"fixed",inset:0,zIndex:9000,background:"white",display:"flex",flexDirection:"column",fontFamily:"'Sarabun','Prompt',sans-serif"}}>
      <div className="np" style={{background:"#0f172a",padding:"10px 20px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <span style={{color:"white",fontWeight:700,fontSize:15}}>🖨️ {title}</span>
        <div style={{flex:1}}/>
        <button onClick={()=>window.print()} style={{background:"#10b981",color:"white",border:"none",borderRadius:8,padding:"9px 26px",fontWeight:800,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>🖨️ พิมพ์ (Ctrl+P)</button>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.12)",color:"white",border:"none",borderRadius:8,padding:"9px 16px",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>✕ ปิด</button>
      </div>
      <div style={{flex:1,overflow:"auto",background:"#94a3b8",padding:"20px",display:"flex",justifyContent:"center"}}>
        <div style={{background:"white",width:isLandscape?"277mm":"210mm",minHeight:isLandscape?"190mm":"295mm",padding:"15mm 20mm",boxShadow:"0 4px 32px #0004",fontFamily:"'Sarabun',sans-serif",fontSize:"13px",color:"#0f172a"}}
          dangerouslySetInnerHTML={{__html:content}}/>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const S={
  input:{width:"100%",padding:"9px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:13,outline:"none",background:"white",fontFamily:"inherit",color:"#0f172a"},
  label:{fontSize:11,fontWeight:700,color:"#64748b",marginBottom:4,display:"block"},
  btn:(bg,c="white",ex={})=>({padding:"9px 16px",borderRadius:9,border:"none",background:bg,color:c,fontWeight:700,cursor:"pointer",fontSize:13,fontFamily:"inherit",...ex}),
};
function Toast({msg,type}){return<div style={{position:"fixed",top:16,right:16,zIndex:8999,background:type==="error"?"#ef4444":type==="warn"?"#f59e0b":type==="info"?"#3b82f6":"#10b981",color:"white",padding:"11px 20px",borderRadius:10,fontWeight:700,boxShadow:"0 4px 20px #0003",fontSize:13,maxWidth:380,whiteSpace:"pre-line",lineHeight:1.6}}>{msg}</div>;}
function CatBadge({id}){const c=getCat(id);return<span style={{background:c.color+"18",color:c.color,borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{c.icon} {c.label}</span>;}
function GrpBadge({group}){const g=group==="goods";return<span style={{background:g?"#e0f2fe":"#fef3c7",color:g?"#0369a1":"#92400e",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{g?"🛒 สินค้า":"💸 ค่าใช้จ่าย"}</span>;}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [expenses,  setExpenses]  = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [syncing,   setSyncing]   = useState(false);
  const [view,      setView]      = useState("dash");
  const [sel,       setSel]       = useState(null);
  const [period,    setPeriod]    = useState("month");
  const [catFilter, setCatFilter] = useState("all");
  const [grpFilter, setGrpFilter] = useState("all");
  const [editId,    setEditId]    = useState(null);
  const [viewMode,  setViewMode]  = useState("bill");
  const [toast,     setToast]     = useState(null);
  const [printDoc,  setPrintDoc]  = useState(null);
  const [uploadQ,   setUploadQ]   = useState([]);
  const [noApi,     setNoApi]     = useState(!SHEET_API);

  const emptyForm = {vendor:"",amount:"",description:"",category:"other",date:new Date().toISOString().split("T")[0],paymentMethod:"เงินสด",tax_amount:"0",reference:"",notes:"",paid:false};
  const [form, setForm] = useState(emptyForm);
  const sf=(k,v)=>setForm(p=>({...p,[k]:v}));
  const fileRef = useRef();

  const notify=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),5000);};
  const resetForm=()=>{setForm(emptyForm);setEditId(null);};

  // ── Load from Sheets on mount ──
  useEffect(()=>{
    if(!SHEET_API) return;
    setLoading(true);
    api.list("all").then(d=>{setExpenses(d.expenses||[]);}).catch(err=>notify("โหลดข้อมูลไม่ได้: "+err.message,"error")).finally(()=>setLoading(false));
  },[]);

  // ── Filter ──
  const filtered = useCallback(()=>{
    const now=new Date();
    return expenses.filter(e=>{
      if(!e.date)return true;
      const d=new Date(e.date+"T00:00:00");
      let ok=true;
      if(period==="week"){const w=new Date(now);w.setDate(now.getDate()-7);ok=d>=w;}
      else if(period==="month")ok=d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
      else if(period==="year")ok=d.getFullYear()===now.getFullYear();
      const cat=getCat(e.category);
      return ok&&(grpFilter==="all"||cat.group===grpFilter)&&(catFilter==="all"||e.category===catFilter);
    }).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  },[expenses,period,catFilter,grpFilter])();

  const totals={
    total:filtered.reduce((s,e)=>s+(e.amount||0),0),
    goods:filtered.filter(e=>getCat(e.category).group==="goods").reduce((s,e)=>s+(e.amount||0),0),
    exp:filtered.filter(e=>getCat(e.category).group==="expense").reduce((s,e)=>s+(e.amount||0),0),
    net:filtered.reduce((s,e)=>s+((e.amount||0)-(e.tax_amount||0)),0),
    tax:filtered.reduce((s,e)=>s+(e.tax_amount||0),0),
  };

  const billGroups=useCallback(()=>{
    const map={};
    filtered.forEach(e=>{const k=e.billGroupId||e.id;if(!map[k])map[k]={id:k,fileName:e.billFileName||"ลงเอง",date:e.date,preview:e.billPreview||null,items:[]};map[k].items.push(e);});
    return Object.values(map).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  },[filtered])();

  // ── CRUD with Sheets sync ──
  const syncAdd = async exp => {
    const withId={...exp,id:exp.id||genId(),voucherNo:exp.voucherNo||`PV-${new Date().getFullYear()}-${String(expenses.length+1).padStart(4,"0")}`,createdAt:new Date().toISOString(),categoryLabel:getCat(exp.category).label,group:getCat(exp.category).group};
    setExpenses(p=>[withId,...p]);
    if(SHEET_API){setSyncing(true);try{await api.add(withId);}catch(err){notify("⚠️ บันทึก Sheets ไม่ได้: "+err.message,"warn");}finally{setSyncing(false);}}
    return withId;
  };

  const syncBulk = async items => {
    const count=expenses.length;
    const withIds=items.map((e,i)=>({...e,id:e.id||genId(),voucherNo:`PV-${new Date().getFullYear()}-${String(count+i+1).padStart(4,"0")}`,createdAt:new Date().toISOString(),categoryLabel:getCat(e.category).label,group:getCat(e.category).group}));
    setExpenses(p=>[...withIds,...p]);
    if(SHEET_API){setSyncing(true);try{await api.bulk(withIds);}catch(err){notify("⚠️ Sheets sync ไม่ได้: "+err.message,"warn");}finally{setSyncing(false);}}
    return withIds;
  };

  const syncUpdate = async exp => {
    const updated={...exp,updatedAt:new Date().toISOString(),categoryLabel:getCat(exp.category).label,group:getCat(exp.category).group};
    setExpenses(p=>p.map(e=>e.id===updated.id?updated:e));
    if(SHEET_API){setSyncing(true);try{await api.update(updated);}catch(err){notify("⚠️ Sheets sync ไม่ได้: "+err.message,"warn");}finally{setSyncing(false);}}
  };

  const syncDelete = async id => {
    setExpenses(p=>p.filter(e=>e.id!==id));
    if(SHEET_API){setSyncing(true);try{await api.delete(id);}catch(err){notify("⚠️ Sheets sync ไม่ได้: "+err.message,"warn");}finally{setSyncing(false);}}
  };

  // ── Upload ──
  const handleFiles = async files => {
    const arr=Array.from(files).filter(f=>f.type.startsWith("image/")||f.type==="application/pdf");
    if(!arr.length){notify("รองรับเฉพาะ JPG, PNG, WEBP, PDF","error");return;}
    const queue=arr.map(f=>({id:genId(),file:f,status:"pending",items:[],error:null,preview:f.type.startsWith("image/")?URL.createObjectURL(f):null,fileName:f.name}));
    setUploadQ(queue);setView("upload");
    for(let i=0;i<queue.length;i++){
      setUploadQ(q=>q.map((it,j)=>j===i?{...it,status:"analyzing"}:it));
      try{
        const b64=await toB64(arr[i]);
        const result=await analyzeFile(b64,arr[i].type);
        const billGroupId=queue[i].id;
        const items=result.map(r=>({...r,id:genId(),billGroupId,billFileName:arr[i].name,billPreview:queue[i].preview,amount:parseFloat(r.amount)||0,tax_amount:parseFloat(r.tax_amount)||0,date:r.date||new Date().toISOString().split("T")[0],paymentMethod:r.paymentMethod||"เงินสด",paid:false,reference:"",notes:""}));
        setUploadQ(q=>q.map((it,j)=>j===i?{...it,status:"done",items}:it));
      }catch(err){setUploadQ(q=>q.map((it,j)=>j===i?{...it,status:"error",error:err.message}:it));}
    }
  };

  const commitAll=async()=>{
    const all=uploadQ.flatMap(q=>q.items);
    if(!all.length){notify("ไม่มีรายการ","warn");return;}
    await syncBulk(all);
    notify(`✅ บันทึก ${all.length} รายการ${SHEET_API?" → Google Sheets แล้ว":""}`);
    setUploadQ([]);setView("list");
  };

  const updQ=(qIdx,iIdx,k,v)=>setUploadQ(q=>q.map((it,j)=>j!==qIdx?it:{...it,items:it.items.map((r,l)=>l!==iIdx?r:{...r,[k]:v})}));
  const delQItem=(qIdx,iIdx)=>setUploadQ(q=>q.map((it,j)=>j!==qIdx?it:{...it,items:it.items.filter((_,l)=>l!==iIdx)}));
  const addQItem=qIdx=>{setUploadQ(q=>q.map((it,j)=>j!==qIdx?it:{...it,items:[...it.items,{id:genId(),billGroupId:q[qIdx].id,billFileName:q[qIdx].fileName,billPreview:q[qIdx].preview,vendor:"",amount:0,tax_amount:0,description:"",category:"other",date:new Date().toISOString().split("T")[0],paymentMethod:"เงินสด",paid:false,reference:"",notes:"",confidence:"manual"}]}));};

  const save=async()=>{
    if(!form.vendor.trim()){notify("กรุณากรอกชื่อร้าน","error");return;}
    if(!form.amount||isNaN(parseFloat(form.amount))){notify("กรุณากรอกยอดเงิน","error");return;}
    const data={...form,amount:parseFloat(form.amount),tax_amount:parseFloat(form.tax_amount)||0};
    if(editId){await syncUpdate({...expenses.find(e=>e.id===editId),...data});notify("✏️ แก้ไขสำเร็จ");}
    else{await syncAdd({...data,billGroupId:genId(),billFileName:"ลงเอง"});notify("✅ บันทึกสำเร็จ");}
    resetForm();setView("list");
  };

  const doDelete=async id=>{if(!window.confirm("ยืนยันลบ?"))return;await syncDelete(id);setView("list");notify("🗑️ ลบแล้ว");};
  const doEdit=e=>{setForm({...e,amount:e.amount.toString(),tax_amount:(e.tax_amount||0).toString()});setEditId(e.id);setView("add");};

  const printVoucher=e=>setPrintDoc({title:"ใบสำคัญจ่าย",content:buildVoucherContent(e),isLandscape:false});
  const printReceipt=e=>setPrintDoc({title:"ใบรับรองการรับเงิน",content:buildReceiptContent(e),isLandscape:false});
  const printReport=()=>{
    const lbl=`${period==="week"?"รายสัปดาห์":period==="month"?"รายเดือน":period==="year"?"รายปี":"ทั้งหมด"}${grpFilter!=="all"?" · "+(grpFilter==="goods"?"สินค้าเพื่อขาย":"ค่าใช้จ่าย"):""}${catFilter!=="all"?" · "+getCat(catFilter).label:""}`;
    setPrintDoc({title:"รายงาน",content:buildReportContent(filtered,lbl,totals),isLandscape:true});
  };

  // ── NAV ──
  const Nav=()=>(
    <div style={{background:"linear-gradient(135deg,#0f172a,#1e293b)",padding:"12px 18px 10px",flexShrink:0}}>
      <div style={{maxWidth:1000,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}>
          <div>
            <div style={{color:"white",fontWeight:800,fontSize:17}}><span style={{color:"#fbbf24"}}>⚡</span> ExpenseAI</div>
            <div style={{color:"#475569",fontSize:10}}>
              {SHEET_API ? <span style={{color:"#10b981"}}>● Google Sheets{syncing?" (กำลังซิงค์...)":""}</span> : <span style={{color:"#ef4444"}}>● ยังไม่ได้เชื่อม Sheets</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
            {[["dash","📊"],["list","📋"],["add","✍️"],["upload","📤"]].map(([v,icon])=>(
              <button key={v} onClick={()=>{setView(v);if(v!=="add")resetForm();}}
                style={{padding:"6px 11px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",background:view===v?"#fbbf24":"rgba(255,255,255,0.08)",color:view===v?"#0f172a":"white"}}>
                {icon} {v==="dash"?"ภาพรวม":v==="list"?"รายการ":v==="add"?"ลงเอง":"อัพโหลด AI"}
              </button>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{color:"#475569",fontSize:10,marginRight:2}}>ช่วง:</span>
          {[["week","สัปดาห์"],["month","เดือน"],["year","ปี"],["all","ทั้งหมด"]].map(([p,l])=>(
            <button key={p} onClick={()=>setPeriod(p)} style={{padding:"3px 10px",borderRadius:20,border:`1.5px solid ${period===p?"#fbbf24":"rgba(255,255,255,0.15)"}`,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:period===p?"#fbbf2420":"transparent",color:period===p?"#fbbf24":"#94a3b8"}}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  );

  const wrap={maxWidth:1000,margin:"0 auto",padding:"16px 18px"};

  // ── No API banner ──
  const NoBanner=()=>noApi?(
    <div style={{background:"#fef3c7",border:"1px solid #fbbf24",borderRadius:12,padding:"12px 16px",marginBottom:14,fontSize:13}}>
      <b>⚠️ ยังไม่ได้เชื่อม Google Sheets</b> — ข้อมูลเก็บในหน่วยความจำชั่วคราว (หายเมื่อรีโหลด)<br/>
      ตั้งค่า <code>VITE_SHEET_API</code> ใน <code>.env</code> แล้ว deploy ใหม่เพื่อเชื่อม Sheets ถาวรครับ
    </div>
  ):null;

  // ════ UPLOAD ════
  if(view==="upload") return(
    <div style={{minHeight:"100vh",background:"#f1f5f9",fontFamily:"'Sarabun','Prompt',sans-serif"}}>
      {toast&&<Toast {...toast}/>}
      {printDoc&&<PrintOverlay {...printDoc} onClose={()=>setPrintDoc(null)}/>}
      <Nav/>
      <div style={wrap}>
        <NoBanner/>
        <div onClick={()=>fileRef.current?.click()} style={{border:"2px dashed #6366f1",borderRadius:14,padding:"26px 20px",textAlign:"center",cursor:"pointer",background:"#fafaff",marginBottom:16}}>
          <div style={{fontSize:42,marginBottom:6}}>📂</div>
          <div style={{fontWeight:700,fontSize:15,color:"#4f46e5"}}>คลิกหรือลากไฟล์มาวาง</div>
          <div style={{fontSize:12,color:"#94a3b8",marginTop:4}}>JPG · PNG · WEBP · PDF — หลายไฟล์พร้อมกันได้</div>
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple style={{display:"none"}} onChange={e=>handleFiles(e.target.files)}/>
        {uploadQ.map((q,qIdx)=>(
          <div key={q.id} style={{background:"white",borderRadius:14,padding:18,marginBottom:14,boxShadow:"0 1px 4px #0001"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,paddingBottom:12,borderBottom:"1px solid #f1f5f9"}}>
              {q.preview?<img src={q.preview} alt="" style={{width:54,height:54,objectFit:"cover",borderRadius:8,border:"1px solid #e2e8f0"}}/>:<div style={{width:54,height:54,borderRadius:8,background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>📄</div>}
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{q.fileName}</div>
                <div style={{fontSize:12,color:"#94a3b8",marginTop:2}}>
                  {q.status==="pending"&&"⏳ รอ..."}
                  {q.status==="analyzing"&&<span style={{color:"#6366f1",fontWeight:600}}>🤖 AI กำลังวิเคราะห์...</span>}
                  {q.status==="done"&&<span style={{color:"#10b981",fontWeight:600}}>✅ พบ {q.items.length} รายการ</span>}
                  {q.status==="error"&&<span style={{color:"#ef4444"}}>❌ {q.error}</span>}
                </div>
              </div>
              {q.status==="done"&&<button onClick={()=>addQItem(qIdx)} style={{...S.btn("#f1f5f9","#0f172a"),padding:"6px 12px",fontSize:12}}>+ เพิ่มรายการ</button>}
            </div>
            {q.items.map((item,iIdx)=>(
              <div key={item.id} style={{background:"#f8fafc",borderRadius:10,padding:14,marginBottom:10,border:"1px solid #e2e8f0"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                  <span style={{fontWeight:700,fontSize:13}}>รายการที่ {iIdx+1} {item.confidence&&<span style={{fontSize:10,color:item.confidence==="high"?"#10b981":item.confidence==="medium"?"#f59e0b":"#6366f1",fontWeight:700,marginLeft:6}}>● {item.confidence==="high"?"แม่น":item.confidence==="medium"?"ปานกลาง":"manual"}</span>}</span>
                  <button onClick={()=>delQItem(qIdx,iIdx)} style={{...S.btn("#fee2e2","#ef4444"),padding:"3px 8px",fontSize:11}}>✕</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {[["ชื่อร้าน/บริษัท","vendor","text"],["ยอดเงิน (บาท)","amount","number"],["ภาษี (บาท)","tax_amount","number"],["วันที่","date","date"]].map(([lbl,key,type])=>(
                    <div key={key}><label style={S.label}>{lbl}</label><input style={S.input} type={type} value={item[key]||""} onChange={e=>updQ(qIdx,iIdx,key,e.target.value)}/></div>
                  ))}
                  <div><label style={S.label}>ประเภท</label>
                    <select style={S.input} value={item.category} onChange={e=>updQ(qIdx,iIdx,"category",e.target.value)}>
                      <optgroup label="🛒 สินค้าเพื่อขาย">{CATS.filter(c=>c.group==="goods").map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</optgroup>
                      <optgroup label="💸 ค่าใช้จ่าย">{CATS.filter(c=>c.group==="expense").map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</optgroup>
                    </select>
                  </div>
                  <div><label style={S.label}>วิธีชำระ</label><select style={S.input} value={item.paymentMethod} onChange={e=>updQ(qIdx,iIdx,"paymentMethod",e.target.value)}>{PAY.map(m=><option key={m}>{m}</option>)}</select></div>
                  <div style={{gridColumn:"1/-1"}}><label style={S.label}>รายละเอียด</label><input style={S.input} value={item.description||""} onChange={e=>updQ(qIdx,iIdx,"description",e.target.value)}/></div>
                </div>
                <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>updQ(qIdx,iIdx,"paid",!item.paid)}>
                  <div style={{width:38,height:22,borderRadius:11,background:item.paid?"#10b981":"#e2e8f0",position:"relative",transition:"background .2s"}}><div style={{position:"absolute",top:3,left:item.paid?19:3,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .2s"}}/></div>
                  <span style={{fontSize:12,fontWeight:700}}>{item.paid?"✅ จ่ายแล้ว":"⏳ ยังไม่จ่าย"}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
        {uploadQ.length>0&&(
          <div style={{position:"sticky",bottom:16,display:"flex",gap:10,justifyContent:"center"}}>
            <button onClick={commitAll} style={{...S.btn("#0f172a"),padding:"12px 30px",fontSize:15,boxShadow:"0 4px 20px #0f172a50"}}>
              ✅ บันทึก {uploadQ.flatMap(q=>q.items).length} รายการ {SHEET_API?"→ Sheets":""}
            </button>
            <button onClick={()=>setUploadQ([])} style={{...S.btn("#f1f5f9","#475569"),padding:"12px 18px"}}>ล้าง</button>
          </div>
        )}
      </div>
    </div>
  );

  // ════ DASHBOARD ════
  if(view==="dash") return(
    <div style={{minHeight:"100vh",background:"#f1f5f9",fontFamily:"'Sarabun','Prompt',sans-serif"}}>
      {toast&&<Toast {...toast}/>}
      {printDoc&&<PrintOverlay {...printDoc} onClose={()=>setPrintDoc(null)}/>}
      <Nav/>
      <div style={wrap}>
        <NoBanner/>
        {loading&&<div style={{textAlign:"center",padding:40,color:"#6366f1",fontWeight:600}}>⏳ โหลดข้อมูลจาก Google Sheets...</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:16}}>
          {[["💰 รวม",`฿${fmt(totals.total)}`,"#6366f1"],["🛒 สินค้า",`฿${fmt(totals.goods)}`,"#0ea5e9"],["💸 ค่าใช้จ่าย",`฿${fmt(totals.exp)}`,"#f59e0b"],["📋 รายการ",filtered.length,"#10b981"],["✅ จ่ายแล้ว",filtered.filter(e=>e.paid).length,"#10b981"],["⏳ ค้างจ่าย",filtered.filter(e=>!e.paid).length,"#ef4444"]].map(([l,v,c])=>(
            <div key={l} style={{background:"white",borderRadius:11,padding:"12px 14px",borderLeft:`4px solid ${c}`,boxShadow:"0 1px 3px #0001"}}>
              <div style={{fontSize:11,color:"#94a3b8"}}>{l}</div>
              <div style={{fontSize:18,fontWeight:800,color:c,marginTop:2}}>{v}</div>
            </div>
          ))}
        </div>
        {filtered.length===0&&!loading?(
          <div style={{textAlign:"center",padding:"50px 20px",background:"white",borderRadius:14,color:"#94a3b8"}}>
            <div style={{fontSize:50}}>📊</div>
            <div style={{fontWeight:700,marginTop:10,fontSize:16}}>ยังไม่มีข้อมูล</div>
            <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:14}}>
              <button onClick={()=>setView("upload")} style={S.btn("#6366f1")}>📤 อัพโหลดบิล AI</button>
              <button onClick={()=>setView("add")} style={S.btn("#0f172a")}>✍️ ลงเอง</button>
            </div>
          </div>
        ):(
          <div style={{background:"white",borderRadius:14,padding:18,boxShadow:"0 1px 4px #0001"}}>
            <div style={{fontWeight:800,fontSize:15,marginBottom:14}}>📊 สรุปตามประเภท</div>
            {["goods","expense"].map(grp=>{
              const grpCats=CATS.filter(c=>c.group===grp);
              if(!grpCats.some(c=>filtered.some(e=>e.category===c.id)))return null;
              return<div key={grp} style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:800,color:grp==="goods"?"#0369a1":"#92400e",marginBottom:8}}>{grp==="goods"?"🛒 สินค้าเพื่อขาย":"💸 ค่าใช้จ่าย"}</div>
                {grpCats.map(c=>{const sum=filtered.filter(e=>e.category===c.id).reduce((s,e)=>s+(e.amount||0),0);const cnt=filtered.filter(e=>e.category===c.id).length;if(!cnt)return null;return(
                  <div key={c.id} style={{marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:12}}>{c.icon} {c.label} <span style={{color:"#cbd5e1",fontSize:10}}>({cnt})</span></span><span style={{fontWeight:800,fontSize:12,color:c.color}}>฿{fmt(sum)}</span></div>
                    <div style={{background:"#f1f5f9",borderRadius:5,height:6,overflow:"hidden"}}><div style={{background:c.color,height:"100%",width:`${totals.total>0?(sum/totals.total)*100:0}%`,borderRadius:5}}/></div>
                  </div>
                );})}
              </div>;
            })}
          </div>
        )}
      </div>
    </div>
  );

  // ════ LIST ════
  if(view==="list") return(
    <div style={{minHeight:"100vh",background:"#f1f5f9",fontFamily:"'Sarabun','Prompt',sans-serif"}}>
      {toast&&<Toast {...toast}/>}
      {printDoc&&<PrintOverlay {...printDoc} onClose={()=>setPrintDoc(null)}/>}
      <Nav/>
      <div style={wrap}>
        <NoBanner/>
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
          <select value={grpFilter} onChange={e=>setGrpFilter(e.target.value)} style={{...S.input,width:"auto",padding:"7px 10px",fontSize:12}}>
            <option value="all">ทุกกลุ่ม</option><option value="goods">🛒 สินค้า</option><option value="expense">💸 ค่าใช้จ่าย</option>
          </select>
          <select value={catFilter} onChange={e=>setCatFilter(e.target.value)} style={{...S.input,width:"auto",padding:"7px 10px",fontSize:12}}>
            <option value="all">ทุกประเภท</option>
            <optgroup label="🛒 สินค้า">{CATS.filter(c=>c.group==="goods").map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
            <optgroup label="💸 ค่าใช้จ่าย">{CATS.filter(c=>c.group==="expense").map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
          </select>
          <div style={{display:"flex",gap:3,background:"#e2e8f0",borderRadius:8,padding:3}}>
            {[["bill","แยกบิล"],["flat","ตาราง"]].map(([m,l])=>(
              <button key={m} onClick={()=>setViewMode(m)} style={{padding:"4px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",background:viewMode===m?"white":"transparent",color:viewMode===m?"#0f172a":"#64748b"}}>{l}</button>
            ))}
          </div>
          <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:13,fontWeight:700}}>{filtered.length} · <span style={{color:"#6366f1"}}>฿{fmt(totals.total)}</span></span>
            <button onClick={printReport} style={{...S.btn("#0f172a"),padding:"7px 13px",fontSize:12}}>🖨️ พิมพ์รายงาน</button>
          </div>
        </div>

        {filtered.length===0&&<div style={{textAlign:"center",padding:56,background:"white",borderRadius:14,color:"#94a3b8"}}><div style={{fontSize:40}}>🗒️</div><div style={{marginTop:8,fontWeight:600}}>ไม่พบรายการ</div></div>}

        {viewMode==="bill"&&billGroups.map(grp=>(
          <div key={grp.id} style={{background:"white",borderRadius:14,marginBottom:12,overflow:"hidden",boxShadow:"0 1px 4px #0001"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",background:"#f8fafc",borderBottom:"1px solid #f1f5f9"}}>
              {grp.preview?<img src={grp.preview} alt="" style={{width:44,height:44,objectFit:"cover",borderRadius:8,border:"1px solid #e2e8f0"}}/>:<div style={{width:44,height:44,borderRadius:8,background:"#e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>📄</div>}
              <div><div style={{fontWeight:700,fontSize:13}}>{grp.fileName}</div><div style={{fontSize:11,color:"#94a3b8"}}>📅 {grp.date} · {grp.items.length} รายการ · ฿{fmt(grp.items.reduce((s,e)=>s+(e.amount||0),0))}</div></div>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:700}}>
                <thead><tr style={{background:"#f1f5f9"}}>{["เลขที่","ร้าน/บริษัท","รายละเอียด","กลุ่ม","ประเภท","วิธีจ่าย","ก่อนภาษี","ภาษี","ยอดรวม",""].map(h=><th key={h} style={{padding:"7px 10px",textAlign:["ก่อนภาษี","ภาษี","ยอดรวม"].includes(h)?"right":"left",fontSize:10,color:"#64748b",fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                <tbody>{grp.items.map((e,i)=>{const net=(e.amount||0)-(e.tax_amount||0);return(
                  <tr key={e.id} style={{borderBottom:"1px solid #f8fafc",background:i%2?"#fafafa":"white"}}>
                    <td style={{padding:"8px 10px",fontSize:10,color:"#94a3b8",whiteSpace:"nowrap"}}>{e.voucherNo}</td>
                    <td style={{padding:"8px 10px",fontWeight:700,cursor:"pointer"}} onClick={()=>{setSel(e);setView("detail");}}>{e.vendor}</td>
                    <td style={{padding:"8px 10px",color:"#64748b",maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.description||"-"}</td>
                    <td style={{padding:"8px 10px"}}><GrpBadge group={getCat(e.category).group}/></td>
                    <td style={{padding:"8px 10px"}}><CatBadge id={e.category}/></td>
                    <td style={{padding:"8px 10px",color:"#64748b",whiteSpace:"nowrap"}}>{e.paymentMethod}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:"#64748b"}}>{fmt(net)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:"#64748b"}}>{fmt(e.tax_amount||0)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,whiteSpace:"nowrap"}}>฿{fmt(e.amount)}</td>
                    <td style={{padding:"8px 6px"}}>
                      <div style={{display:"flex",gap:3}}>
                        <button onClick={()=>printVoucher(e)} style={{...S.btn("#6366f1"),padding:"3px 6px",fontSize:10}} title="ใบสำคัญจ่าย">จ่าย</button>
                        <button onClick={()=>printReceipt(e)} style={{...S.btn("#10b981"),padding:"3px 6px",fontSize:10}} title="ใบรับรองรับเงิน">รับ</button>
                        <button onClick={()=>doEdit(e)} style={{...S.btn("#f1f5f9","#475569"),padding:"3px 6px",fontSize:10}}>✏️</button>
                        <button onClick={()=>doDelete(e.id)} style={{...S.btn("#fee2e2","#ef4444"),padding:"3px 6px",fontSize:10}}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                );})}
                </tbody>
                <tfoot><tr style={{background:"#f8fafc",borderTop:"2px solid #e2e8f0"}}>
                  <td colSpan={6} style={{padding:"8px 10px",fontWeight:800,fontSize:12}}>รวมบิลนี้</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800}}>{fmt(grp.items.reduce((s,e)=>s+((e.amount||0)-(e.tax_amount||0)),0))}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800}}>{fmt(grp.items.reduce((s,e)=>s+(e.tax_amount||0),0))}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontWeight:900,color:"#6366f1"}}>฿{fmt(grp.items.reduce((s,e)=>s+(e.amount||0),0))}</td>
                  <td/>
                </tr></tfoot>
              </table>
            </div>
          </div>
        ))}

        {viewMode==="flat"&&filtered.length>0&&(
          <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 1px 4px #0001"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:800}}>
                <thead><tr style={{background:"#0f172a"}}>{["เลขที่","วันที่","ร้าน/บริษัท","รายละเอียด","กลุ่ม","ประเภท","วิธีจ่าย","ก่อนภาษี","ภาษี","ยอดรวม",""].map(h=><th key={h} style={{padding:"9px 10px",textAlign:["ก่อนภาษี","ภาษี","ยอดรวม"].includes(h)?"right":"left",fontSize:10,color:"#94a3b8",fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                <tbody>{filtered.map((e,i)=>{const net=(e.amount||0)-(e.tax_amount||0);return(
                  <tr key={e.id} style={{borderBottom:"1px solid #f1f5f9",background:i%2?"#fafafa":"white"}}>
                    <td style={{padding:"8px 10px",fontSize:10,color:"#94a3b8",whiteSpace:"nowrap"}}>{e.voucherNo}</td>
                    <td style={{padding:"8px 10px",color:"#64748b",whiteSpace:"nowrap"}}>{e.date}</td>
                    <td style={{padding:"8px 10px",fontWeight:700,cursor:"pointer"}} onClick={()=>{setSel(e);setView("detail");}}>{e.vendor}</td>
                    <td style={{padding:"8px 10px",color:"#64748b",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.description||"-"}</td>
                    <td style={{padding:"8px 10px"}}><GrpBadge group={getCat(e.category).group}/></td>
                    <td style={{padding:"8px 10px"}}><CatBadge id={e.category}/></td>
                    <td style={{padding:"8px 10px",color:"#64748b",whiteSpace:"nowrap"}}>{e.paymentMethod}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:"#64748b"}}>{fmt(net)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",color:"#64748b"}}>{fmt(e.tax_amount||0)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,whiteSpace:"nowrap"}}>฿{fmt(e.amount)}</td>
                    <td style={{padding:"8px 6px"}}>
                      <div style={{display:"flex",gap:3}}>
                        <button onClick={()=>printVoucher(e)} style={{...S.btn("#6366f1"),padding:"3px 6px",fontSize:10}}>จ่าย</button>
                        <button onClick={()=>printReceipt(e)} style={{...S.btn("#10b981"),padding:"3px 6px",fontSize:10}}>รับ</button>
                        <button onClick={()=>doEdit(e)} style={{...S.btn("#f1f5f9","#475569"),padding:"3px 6px",fontSize:10}}>✏️</button>
                        <button onClick={()=>doDelete(e.id)} style={{...S.btn("#fee2e2","#ef4444"),padding:"3px 6px",fontSize:10}}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                );})}
                </tbody>
                <tfoot><tr style={{background:"#f8fafc",borderTop:"2px solid #e2e8f0"}}>
                  <td colSpan={7} style={{padding:"9px 10px",fontWeight:800}}>รวม ({filtered.length})</td>
                  <td style={{padding:"9px 10px",textAlign:"right",fontWeight:800}}>{fmt(totals.net)}</td>
                  <td style={{padding:"9px 10px",textAlign:"right",fontWeight:800}}>{fmt(totals.tax)}</td>
                  <td style={{padding:"9px 10px",textAlign:"right",fontWeight:900,fontSize:14,color:"#6366f1"}}>฿{fmt(totals.total)}</td>
                  <td/>
                </tr></tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ════ ADD ════
  if(view==="add") return(
    <div style={{minHeight:"100vh",background:"#f1f5f9",fontFamily:"'Sarabun','Prompt',sans-serif"}}>
      {toast&&<Toast {...toast}/>}
      <Nav/>
      <div style={wrap}>
        <div style={{background:"white",borderRadius:16,padding:22,boxShadow:"0 1px 8px #0001"}}>
          <div style={{fontWeight:800,fontSize:17,marginBottom:18}}>{editId?"✏️ แก้ไขรายการ":"✍️ ลงรายการเอง"}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:13}}>
            <div><label style={S.label}>ชื่อร้าน / บริษัท *</label><input style={S.input} value={form.vendor} onChange={e=>sf("vendor",e.target.value)}/></div>
            <div><label style={S.label}>ยอดเงินรวม (บาท) *</label><input style={S.input} type="number" value={form.amount} onChange={e=>sf("amount",e.target.value)}/></div>
            <div><label style={S.label}>ภาษีมูลค่าเพิ่ม (บาท)</label><input style={S.input} type="number" value={form.tax_amount} onChange={e=>sf("tax_amount",e.target.value)}/></div>
            <div><label style={S.label}>วันที่</label><input style={S.input} type="date" value={form.date} onChange={e=>sf("date",e.target.value)}/></div>
            <div><label style={S.label}>ประเภท</label>
              <select style={S.input} value={form.category} onChange={e=>sf("category",e.target.value)}>
                <optgroup label="🛒 สินค้าเพื่อขาย">{CATS.filter(c=>c.group==="goods").map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</optgroup>
                <optgroup label="💸 ค่าใช้จ่าย">{CATS.filter(c=>c.group==="expense").map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</optgroup>
              </select>
            </div>
            <div><label style={S.label}>วิธีชำระ</label><select style={S.input} value={form.paymentMethod} onChange={e=>sf("paymentMethod",e.target.value)}>{PAY.map(m=><option key={m}>{m}</option>)}</select></div>
            <div style={{gridColumn:"1/-1"}}><label style={S.label}>รายละเอียด</label><input style={S.input} value={form.description} onChange={e=>sf("description",e.target.value)}/></div>
            <div><label style={S.label}>เลขที่อ้างอิง</label><input style={S.input} value={form.reference} onChange={e=>sf("reference",e.target.value)}/></div>
            <div><label style={S.label}>หมายเหตุ</label><input style={S.input} value={form.notes} onChange={e=>sf("notes",e.target.value)}/></div>
          </div>
          <div style={{marginTop:14,display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>sf("paid",!form.paid)}>
            <div style={{width:40,height:22,borderRadius:11,background:form.paid?"#10b981":"#e2e8f0",position:"relative",transition:"background .2s"}}><div style={{position:"absolute",top:3,left:form.paid?20:3,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .2s"}}/></div>
            <span style={{fontWeight:700,fontSize:13}}>{form.paid?"✅ จ่ายแล้ว":"⏳ ยังไม่จ่าย"}</span>
          </div>
          <div style={{display:"flex",gap:10,marginTop:18}}>
            <button onClick={save} style={{...S.btn("#0f172a"),flex:1,padding:12,fontSize:14}}>{editId?"💾 บันทึกการแก้ไข":"✅ บันทึก"}{SHEET_API?" → Sheets":""}</button>
            <button onClick={()=>{resetForm();setView("list");}} style={{...S.btn("#f1f5f9","#475569"),padding:"12px 18px"}}>ยกเลิก</button>
          </div>
        </div>
      </div>
    </div>
  );

  // ════ DETAIL ════
  if(view==="detail"&&sel){
    const e=sel;const cat=getCat(e.category);const net=(e.amount||0)-(e.tax_amount||0);
    return(
      <div style={{minHeight:"100vh",background:"#f1f5f9",fontFamily:"'Sarabun','Prompt',sans-serif"}}>
        {toast&&<Toast {...toast}/>}
        {printDoc&&<PrintOverlay {...printDoc} onClose={()=>setPrintDoc(null)}/>}
        <Nav/>
        <div style={wrap}>
          <div style={{background:"white",borderRadius:16,padding:22,boxShadow:"0 1px 8px #0001"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
              <div>
                <div style={{fontSize:21,fontWeight:800}}>{e.vendor}</div>
                <div style={{color:"#94a3b8",fontSize:12,marginTop:2}}>{e.voucherNo} · {e.date}</div>
                <div style={{display:"flex",gap:6,marginTop:7,flexWrap:"wrap"}}>
                  <GrpBadge group={cat.group}/><CatBadge id={e.category}/>
                  {e.paid?<span style={{background:"#d1fae5",color:"#065f46",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700}}>✅ จ่ายแล้ว</span>:<span style={{background:"#fee2e2",color:"#991b1b",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700}}>⏳ ค้างจ่าย</span>}
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:26,fontWeight:900,color:cat.color}}>฿{fmt(e.amount)}</div>
                <div style={{fontSize:11,color:"#94a3b8"}}>ก่อนภาษี ฿{fmt(net)}</div>
                {(e.tax_amount||0)>0&&<div style={{fontSize:11,color:"#94a3b8"}}>ภาษี ฿{fmt(e.tax_amount)}</div>}
              </div>
            </div>
            {e.billPreview&&<div style={{marginBottom:14}}><div style={{fontSize:11,fontWeight:700,color:"#6366f1",marginBottom:6}}>🖼️ ภาพบิลต้นทาง</div><img src={e.billPreview} alt="" style={{maxWidth:"100%",maxHeight:200,borderRadius:10,border:"1px solid #e2e8f0"}}/></div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
              <button onClick={()=>printVoucher(e)} style={{...S.btn("#6366f1"),flex:1,padding:11}}>🖨️ ใบสำคัญจ่าย</button>
              <button onClick={()=>printReceipt(e)} style={{...S.btn("#10b981"),flex:1,padding:11}}>🖨️ ใบรับรองรับเงิน</button>
              <button onClick={()=>doEdit(e)} style={{...S.btn("white","#6366f1"),border:"1.5px solid #6366f1",padding:"11px 14px"}}>✏️</button>
              <button onClick={()=>doDelete(e.id)} style={{...S.btn("white","#ef4444"),border:"1.5px solid #ef4444",padding:"11px 14px"}}>🗑️</button>
              <button onClick={()=>setView("list")} style={{...S.btn("#f1f5f9","#475569"),padding:"11px 14px"}}>← กลับ</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
