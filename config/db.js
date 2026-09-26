const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME || 'BoardGameCafeDB',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: false,              // เชื่อมต่อ localhost ไม่ต้องเข้ารหัส
    trustServerCertificate: true
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let pool = null;

// เชื่อมต่อแบบ lazy + reconnect อัตโนมัติ: ถ้า SQL Server ยังไม่พร้อมตอนเปิดเว็บ
// แอปจะไม่ crash แค่ error เฉพาะหน้าที่เรียก แล้วลองเชื่อมใหม่ในรีเควสต์ถัดไป
async function getPool() {
  if (pool && pool.connected) return pool;
  pool = await new sql.ConnectionPool(config).connect();
  console.log('Connected to SQL Server:', config.database);
  return pool;
}

module.exports = { sql, getPool };
