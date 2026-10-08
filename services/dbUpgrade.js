// อัปเดตฐานข้อมูลให้ตรงกับเว็บอัตโนมัติตอนเชื่อมต่อครั้งแรก (ไม่ลบข้อมูล)
// อ่าน boardgame_cafe_sqlserver.sql แล้วรันเฉพาะ batch ที่เป็น "CREATE OR ALTER ..."
// (Function / View / Trigger / Stored Procedure ของหน้า "จัดการข้อมูล", ต่อเวลา, รายงาน)
// — สร้างใหม่ถ้ายังไม่มี / แก้ให้เป็นเวอร์ชันล่าสุดถ้ามีอยู่แล้ว รันซ้ำกี่ครั้งก็ได้
const fs = require('fs');
const path = require('path');

const SQL_FILE = path.join(__dirname, '..', 'boardgame_cafe_sqlserver.sql');

function upgradeBatches() {
  const text = fs.readFileSync(SQL_FILE, 'utf8').replace(/^﻿/, '');
  return text
    .split(/^\s*GO\s*$/im)
    .map(b => b.trim())
    .filter(b => /CREATE OR ALTER\s+(FUNCTION|VIEW|TRIGGER|PROCEDURE)\b/i.test(b))
    .filter(b => !/\b(DROP DATABASE|CREATE TABLE|INSERT INTO|ALTER TABLE)\b/i.test(b.replace(/--.*$/gm, '')
      .replace(/CREATE OR ALTER[\s\S]*$/i, '')));            // กันพลาด: ส่วนก่อน CREATE ต้องเป็นคอมเมนต์เท่านั้น
}

async function runUpgrade(pool) {
  let batches;
  try { batches = upgradeBatches(); } catch (err) {
    console.warn('[db-upgrade] อ่านไฟล์ SQL ไม่ได้:', err.message);
    return;
  }
  let ok = 0;
  const failed = [];
  for (const b of batches) {
    const name = (b.match(/CREATE OR ALTER\s+\w+\s+(?:dbo\.)?(\w+)/i) || [])[1] || '?';
    try {
      await pool.request().batch(b);
      ok++;
    } catch (err) {
      failed.push(`${name}: ${err.message}`);
    }
  }
  console.log(`[db-upgrade] อัปเดต Function/View/Trigger/Stored Procedure แล้ว ${ok}/${batches.length} รายการ`);
  if (failed.length) {
    console.warn('[db-upgrade] ไม่สำเร็จ (ลองรัน boardgame_cafe_sqlserver.sql ใน SSMS):\n  ' + failed.join('\n  '));
  }
}

module.exports = { runUpgrade, upgradeBatches };
