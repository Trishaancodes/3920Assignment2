require("dotenv").config();
const mysql = require("mysql2");
const fs = require("fs");
const path = require("path");

const connection = mysql.createConnection({
  host: process.env.SQLHOST,
  port: Number(process.env.SQLPORT),
  user: process.env.SQLUSER,
  password: process.env.SQLPASSWORD,
  database: process.env.SQLDATABASE,

  // ✅ REQUIRED for Aiven
  ssl: {
    ca: fs.readFileSync(path.join(__dirname, "aiven-ca.pem")),
    rejectUnauthorized: true,
  },
});

connection.connect((err) => {
  if (err) {
    console.error("❌ MySQL SSL connection failed:", err);
    return;
  }
  console.log("✅ Connected to Aiven MySQL with SSL");
});

module.exports = { connection };
