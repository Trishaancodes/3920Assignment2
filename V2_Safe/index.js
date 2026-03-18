require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const port = process.env.PORT || 3000;
const session = require('express-session');
const bcrypt = require('bcrypt');
const MongoStore = require('connect-mongo');
const { connection: sqlConnection } = require("../scripts/databaseSQL.js");
console.log("sqlConnection is:", sqlConnection);
console.log("typeof sqlConnection.query:", typeof sqlConnection.query);
const Joi = require('joi');

const ROOT = path.join(__dirname, "..");

const sqlTable = 'CREATE TABLE IF NOT EXISTS users('
+    'id INT AUTO_INCREMENT PRIMARY KEY,'
+   'firstName VARCHAR(255) NOT NULL,'
+   'email VARCHAR(255) NOT NULL UNIQUE,'
+   'passwordHash VARCHAR(255) NOT NULL'
+');';

function logUsersTable(context) {
  sqlConnection.query(
    "SELECT id, firstName, email FROM users",
    (err, rows) => {
      if (err) {
        console.error(`❌ [${context}] Failed to read users table:`, err.message);
        return;
      }

      console.log(`\n📦 USERS TABLE (${context})`);
      console.table(rows);
    }
  );
}

sqlConnection.query(sqlTable,(err, result) => {
    if (err){
        console.error("❌ Error creating SQL table:", err.message);
    }
    console.log("✅ SQL Table created or already exists.");
    logUsersTable("after table creation");
});

const signupSchema = Joi.object({
    firstName: Joi.string().min(1).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required()
});

// ✅ ONLY CHANGE: use ROOT instead of __dirname so it finds shared folders at project root
app.use('/static', express.static(path.join(ROOT, 'pages')));
app.use('/public', express.static(path.join(ROOT, 'public')));
app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/scripts', express.static(path.join(ROOT, 'scripts')));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI, // <-- simplest & cleanest
    dbName: "users",                // your mongo DB name for sessions
    collectionName: "sessions",
    ttl: 60 * 60,                   // seconds (1 hour)
  }),
  cookie: {
    maxAge: 60 * 60 * 1000,         // ms (1 hour)
    httpOnly: true,
    sameSite: "lax",
    secure: false,                  // true only with HTTPS
  }
}));

app.get("/user", (req, res) => {
  if (!req.session.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  sqlConnection.query(
    "SELECT firstName FROM users WHERE email = ? LIMIT 1",
    [req.session.user.email],
    (err, results) => {
      if (err) {
        console.error("MySQL error:", err);
        return res.status(500).json({ error: "Server error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.json({ firstName: results[0].firstName });
    }
  );
});

// Serve public pages
// ✅ ONLY CHANGE: use ROOT for sendFile paths
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'pages/index.html')));
app.get('/signIn', (req, res) => res.sendFile(path.join(ROOT, 'pages/signIn.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(ROOT, 'pages/signUp.html')));

// Authenticated landing page
app.get('/authenticated', (req, res) => {
  if (!req.session.user) return res.redirect('/signIn');
  res.sendFile(path.join(ROOT, 'pages/authenticated.html'));
});

// Members-only page
app.get('/membersOnly', (req, res) => {
  if (!req.session.user) return res.redirect('/signIn');
  res.sendFile(path.join(ROOT, 'pages/membersOnly.html'));
});

// Signup logic
app.post("/signup", async (req, res) => {
  // 1) Validate body with Joi
  const { error, value } = signupSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.send(`<p>${error.details[0].message}</p><a href="/signup">Try again</a>`);
  }

  const { firstName, email, password } = value;

  // 2) Check if email already exists
  sqlConnection.query(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email],
    async (err, results) => {
      if (err) {
        console.error("MySQL error:", err);
        return res.status(500).send("Server error");
      }

      if (results.length > 0) {
        return res.send(`<p>Email already registered</p><a href="/signup">Try again</a>`);
      }

      try {
        // 3) Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // 4) Insert user into MySQL
        sqlConnection.query(
          "INSERT INTO users (firstName, email, passwordHash) VALUES (?, ?, ?)",
          [firstName, email, passwordHash],
          (err2) => {
            if (err2) {
              console.error("MySQL insert error:", err2);
              return res.status(500).send("Server error");
            }

            // 5) Create session (stored in MongoDB sessions collection)
            req.session.user = { email };
            logUsersTable("after signup");

            // 6) Redirect
            return res.redirect("/authenticated");
          }
        );
      } catch (e) {
        console.error("Signup error:", e);
        return res.status(500).send("Server error");
      }
    }
  );
});

// Login logic
app.post("/signIn", (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  // 2) Fetch user from MySQL (need passwordHash!)
  sqlConnection.query(
    "SELECT firstName, email, passwordHash FROM users WHERE email = ? LIMIT 1",
    [email],
    async (err, results) => {
      if (err) {
        console.error("MySQL error:", err);
        return res.status(500).send("Server error");
      }

      if (results.length === 0) {
        return res.send(`<p>User not found</p><a href="/signIn">Try again</a>`);
      }

      const user = results[0];
      console.log("👤 Login attempt for:", email);
      logUsersTable("during login");

      // 3) Compare password
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        return res.send(`<p>Incorrect password</p><a href="/signIn">Try again</a>`);
      }

      // 4) Save session (MongoDB)
      req.session.user = { email: user.email };

      // 5) Redirect
      return res.redirect("/authenticated");
    }
  );
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.send("Error logging out.");
    }
    logUsersTable("after logout");
    res.redirect('/');
  });
});

app.use((req, res) => {
  res.status(404).send(`
    <h1>404 - Page Not Found</h1>
    <p>The page you're looking for doesn't exist.</p>
    <a href="/">Return to Home</a>
  `);
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
