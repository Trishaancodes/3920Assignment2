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

async function initializeDatabase() {
    const queries = [

        `CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            firstName VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            passwordHash VARCHAR(255) NOT NULL
        );`,

        `CREATE TABLE IF NOT EXISTS chat_groups (
            id INT AUTO_INCREMENT PRIMARY KEY,
            group_name VARCHAR(100) NOT NULL,
            created_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        );`,

        `CREATE TABLE IF NOT EXISTS group_members (
            group_id INT NOT NULL,
            user_id INT NOT NULL,
            PRIMARY KEY (group_id, user_id),
            FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`,

        `CREATE TABLE IF NOT EXISTS messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            group_id INT NOT NULL,
            sender_user_id INT NOT NULL,
            message_text TEXT NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
            FOREIGN KEY (sender_user_id) REFERENCES users(id)
        );`,

        `CREATE TABLE IF NOT EXISTS message_reads (
            message_id INT NOT NULL,
            user_id INT NOT NULL,
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );`,

        `CREATE TABLE IF NOT EXISTS emojis (
            id INT AUTO_INCREMENT PRIMARY KEY,
            emoji_symbol VARCHAR(10) UNIQUE,
            emoji_name VARCHAR(50) UNIQUE
        );`,

        `CREATE TABLE IF NOT EXISTS message_reactions (
            message_id INT NOT NULL,
            user_id INT NOT NULL,
            emoji_id INT NOT NULL,
            PRIMARY KEY (message_id, user_id, emoji_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (emoji_id) REFERENCES emojis(id) ON DELETE CASCADE
        );`
    ];

    queries.forEach((q) => {
        connection.query(q, (err) => {
            if (err) console.error("❌ Schema error:", err.message);
        });
    });

        connection.query(`
        INSERT IGNORE INTO emojis (emoji_symbol, emoji_name) VALUES
        ('👍', 'thumbs_up'),
        ('❤️', 'heart'),
        ('😂', 'laugh'),
        ('😮', 'wow'),
        ('😢', 'sad'),
        ('😡', 'angry'),
        ('🔥', 'fire'),
        ('👏', 'clap'),
        ('🎉', 'party'),
        ('💯', 'hundred'),
        ('😎', 'cool'),
        ('🤔', 'thinking'),
        ('🙌', 'raised_hands'),
        ('👀', 'eyes'),
        ('🚀', 'rocket');
    `);
}

module.exports = { connection, initializeDatabase };



