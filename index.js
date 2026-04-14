require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const port = process.env.PORT || 3000;
const session = require('express-session');
const bcrypt = require('bcrypt');
const MongoStore = require('connect-mongo').default;
const { connection: sqlConnection, initializeDatabase } = require("./scripts/databaseSQL.js");
const Joi = require('joi');

initializeDatabase();

const ROOT = __dirname;

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

const signupSchema = Joi.object({
  firstName: Joi.string().min(1).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(10).required()
});

app.use('/static', express.static(path.join(ROOT, 'pages')));
app.use('/public', express.static(path.join(ROOT, 'public')));
app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/scripts', express.static(path.join(ROOT, 'scripts')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    dbName: "users",
    collectionName: "sessions",
    ttl: 60 * 60,
  }),
  cookie: {
    maxAge: 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: false,
  }
}));

function requireAuthJson(req, res, next) {
  if (!req.session.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function requireAuthPage(req, res, next) {
  if (!req.session.user?.email) {
    return res.redirect("/signIn");
  }
  next();
}

/* =========================
   MOBILE/API ROUTES
   ========================= */

// Mobile/API login: returns JSON
app.post("/api/signIn", (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  sqlConnection.query(
    "SELECT id, firstName, email, passwordHash FROM users WHERE email = ? LIMIT 1",
    [email],
    async (err, results) => {
      if (err) {
        console.error("MySQL error:", err);
        return res.status(500).json({ message: "Server error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const user = results[0];
      console.log("👤 API login attempt for:", email);
      logUsersTable("during api login");

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        return res.status(401).json({ message: "Incorrect password" });
      }

      req.session.user = { email: user.email };

      return res.status(200).json({
        success: true,
        id: user.id,
        firstName: user.firstName,
        email: user.email
      });
    }
  );
});

// Mobile/API user: fuller JSON for Flutter profile
app.get("/api/user", requireAuthJson, (req, res) => {
  sqlConnection.query(
    "SELECT id, firstName, email FROM users WHERE email = ? LIMIT 1",
    [req.session.user.email],
    (err, results) => {
      if (err) {
        console.error("MySQL error:", err);
        return res.status(500).json({ error: "Server error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.json({
        id: results[0].id,
        firstName: results[0].firstName,
        email: results[0].email
      });
    }
  );
});

// Optional API logout
app.post("/api/logout", requireAuthJson, (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ message: "Error logging out" });
    }
    return res.json({ success: true, message: "Logged out" });
  });
});

/* =========================
   SHARED JSON ROUTES
   ========================= */

app.get("/user", requireAuthJson, (req, res) => {
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

app.get("/group/:groupId", requireAuthPage, (req, res) => {
  const groupId = Number(req.params.groupId);

  const sql = `
    SELECT 1
    FROM users u
    JOIN group_members gm ON gm.user_id = u.id
    WHERE u.email = ?
      AND gm.group_id = ?
    LIMIT 1
  `;

  sqlConnection.query(sql, [req.session.user.email, groupId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Server error");
    }

    if (results.length === 0) {
      return res.status(403).send("You are not a member of this group");
    }

    res.sendFile(path.join(ROOT, "pages/groupChat.html"));
  });
});

app.get("/group/:groupId/messages", requireAuthJson, (req, res) => {
  const groupId = Number(req.params.groupId);

  if (!groupId) {
    return res.status(400).json({ error: "Invalid group id" });
  }

  const messagesSql = `
    SELECT 
      m.id,
      m.group_id,
      m.message_text,
      m.sent_at,
      m.sender_user_id AS sender_id,
      sender.firstName AS sender_name,
      currentUser.id AS current_user_id,
      CASE
        WHEN mr.message_id IS NOT NULL THEN 1
        ELSE 0
      END AS is_read
    FROM users currentUser
    JOIN group_members gm
      ON gm.user_id = currentUser.id
    JOIN messages m
      ON m.group_id = gm.group_id
    JOIN users sender
      ON sender.id = m.sender_user_id
    LEFT JOIN message_reads mr
      ON mr.message_id = m.id
     AND mr.user_id = currentUser.id
    WHERE currentUser.email = ?
      AND gm.group_id = ?
    ORDER BY m.sent_at ASC
  `;

  sqlConnection.query(messagesSql, [req.session.user.email, groupId], (err, messages) => {
    if (err) {
      console.error("MySQL error in /group/:groupId/messages:", err);
      return res.status(500).json({ error: "Server error" });
    }

    if (messages.length === 0) {
      return res.json([]);
    }

    const messageIds = messages.map(m => m.id);

    const reactionsSql = `
      SELECT
        mr.message_id,
        e.id AS emoji_id,
        e.emoji_symbol,
        e.emoji_name,
        u.firstName AS reactor_name
      FROM message_reactions mr
      JOIN emojis e
        ON e.id = mr.emoji_id
      JOIN users u
        ON u.id = mr.user_id
      WHERE mr.message_id IN (?)
      ORDER BY mr.message_id ASC, e.id ASC, u.firstName ASC
    `;

    sqlConnection.query(reactionsSql, [messageIds], (err2, reactions) => {
      if (err2) {
        console.error("MySQL error loading reactions:", err2);
        return res.status(500).json({ error: "Server error" });
      }

      const reactionsByMessage = {};

      reactions.forEach(r => {
        if (!reactionsByMessage[r.message_id]) {
          reactionsByMessage[r.message_id] = {};
        }

        if (!reactionsByMessage[r.message_id][r.emoji_id]) {
          reactionsByMessage[r.message_id][r.emoji_id] = {
            emoji_id: r.emoji_id,
            emoji_symbol: r.emoji_symbol,
            emoji_name: r.emoji_name,
            reaction_count: 0,
            reactors: []
          };
        }

        reactionsByMessage[r.message_id][r.emoji_id].reaction_count += 1;
        reactionsByMessage[r.message_id][r.emoji_id].reactors.push(r.reactor_name);
      });

      const finalMessages = messages.map(msg => ({
        ...msg,
        reactions: reactionsByMessage[msg.id]
          ? Object.values(reactionsByMessage[msg.id])
          : []
      }));

      return res.json(finalMessages);
    });
  });
});

app.get("/emojis", requireAuthJson, (req, res) => {
  sqlConnection.query(
    "SELECT id, emoji_symbol, emoji_name FROM emojis ORDER BY id ASC",
    (err, results) => {
      if (err) {
        console.error("MySQL error loading emojis:", err);
        return res.status(500).json({ error: "Server error" });
      }

      return res.json(results);
    }
  );
});

app.post("/group/:groupId/message/:messageId/reaction", requireAuthJson, (req, res) => {
  const groupId = Number(req.params.groupId);
  const messageId = Number(req.params.messageId);
  const { emojiId } = req.body;

  if (!groupId || !messageId || !emojiId) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const membershipSql = `
    SELECT u.id
    FROM users u
    JOIN group_members gm
      ON gm.user_id = u.id
    WHERE u.email = ?
      AND gm.group_id = ?
    LIMIT 1
  `;

  sqlConnection.query(membershipSql, [req.session.user.email, groupId], (err, userResults) => {
    if (err) {
      console.error("MySQL error checking membership:", err);
      return res.status(500).json({ error: "Server error" });
    }

    if (userResults.length === 0) {
      return res.status(403).json({ error: "You are not a member of this group" });
    }

    const userId = userResults[0].id;

    const messageCheckSql = `
      SELECT id
      FROM messages
      WHERE id = ?
        AND group_id = ?
      LIMIT 1
    `;

    sqlConnection.query(messageCheckSql, [messageId, groupId], (err2, messageResults) => {
      if (err2) {
        console.error("MySQL error checking message:", err2);
        return res.status(500).json({ error: "Server error" });
      }

      if (messageResults.length === 0) {
        return res.status(404).json({ error: "Message not found in this group" });
      }

      const existingSql = `
        SELECT 1
        FROM message_reactions
        WHERE message_id = ?
          AND user_id = ?
          AND emoji_id = ?
        LIMIT 1
      `;

      sqlConnection.query(existingSql, [messageId, userId, emojiId], (err3, existingResults) => {
        if (err3) {
          console.error("MySQL error checking existing reaction:", err3);
          return res.status(500).json({ error: "Server error" });
        }

        if (existingResults.length > 0) {
          const deleteSql = `
            DELETE FROM message_reactions
            WHERE message_id = ?
              AND user_id = ?
              AND emoji_id = ?
          `;

          sqlConnection.query(deleteSql, [messageId, userId, emojiId], (err4) => {
            if (err4) {
              console.error("MySQL error removing reaction:", err4);
              return res.status(500).json({ error: "Failed to remove reaction" });
            }

            return res.json({ message: "Reaction removed" });
          });
        } else {
          const insertSql = `
            INSERT INTO message_reactions (message_id, user_id, emoji_id)
            VALUES (?, ?, ?)
          `;

          sqlConnection.query(insertSql, [messageId, userId, emojiId], (err5) => {
            if (err5) {
              console.error("MySQL error adding reaction:", err5);
              return res.status(500).json({ error: "Failed to add reaction" });
            }

            return res.json({ message: "Reaction added" });
          });
        }
      });
    });
  });
});

app.get("/createGroup", requireAuthPage, (req, res) => {
  res.sendFile(path.join(ROOT, "pages/createGroup.html"));
});

app.get("/users-for-group", requireAuthJson, (req, res) => {
  const sql = `
    SELECT id, firstName, email
    FROM users
    WHERE email <> ?
    ORDER BY firstName ASC, email ASC
  `;

  sqlConnection.query(sql, [req.session.user.email], (err, results) => {
    if (err) {
      console.error("MySQL error in /users-for-group:", err);
      return res.status(500).json({ error: "Server error" });
    }

    res.json(results);
  });
});

app.post("/createGroup", requireAuthJson, (req, res) => {
  const { groupName, memberIds } = req.body;

  if (!groupName || !groupName.trim()) {
    return res.status(400).json({ error: "Group name is required" });
  }

  sqlConnection.query(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [req.session.user.email],
    (err, userResults) => {
      if (err) {
        console.error("MySQL error finding creator:", err);
        return res.status(500).json({ error: "Server error" });
      }

      if (userResults.length === 0) {
        return res.status(404).json({ error: "Logged in user not found" });
      }

      const creatorId = userResults[0].id;

      sqlConnection.query(
        "INSERT INTO chat_groups (group_name, created_by) VALUES (?, ?)",
        [groupName.trim(), creatorId],
        (err2, groupResult) => {
          if (err2) {
            console.error("MySQL error creating group:", err2);
            return res.status(500).json({ error: "Server error" });
          }

          const groupId = groupResult.insertId;
          const ids = Array.isArray(memberIds) ? memberIds.map(Number).filter(Boolean) : [];
          const uniqueMemberIds = [...new Set([creatorId, ...ids])];
          const values = uniqueMemberIds.map((userId) => [groupId, userId]);

          sqlConnection.query(
            "INSERT INTO group_members (group_id, user_id) VALUES ?",
            [values],
            (err3) => {
              if (err3) {
                console.error("MySQL error adding group members:", err3);
                return res.status(500).json({ error: "Server error" });
              }

              return res.json({
                message: "Group created successfully",
                groupId: groupId
              });
            }
          );
        }
      );
    }
  );
});

app.get("/group/:groupId/available-users", requireAuthJson, (req, res) => {
  const groupId = Number(req.params.groupId);

  if (!groupId) {
    return res.status(400).json({ error: "Invalid group id" });
  }

  const membershipCheckSql = `
    SELECT u.id
    FROM users u
    JOIN group_members gm
      ON gm.user_id = u.id
    WHERE u.email = ?
      AND gm.group_id = ?
    LIMIT 1
  `;

  sqlConnection.query(membershipCheckSql, [req.session.user.email, groupId], (err, membershipResults) => {
    if (err) {
      console.error("MySQL error checking membership:", err);
      return res.status(500).json({ error: "Server error" });
    }

    if (membershipResults.length === 0) {
      return res.status(403).json({ error: "You are not a member of this group" });
    }

    const sql = `
      SELECT id, firstName, email
      FROM users
      WHERE id NOT IN (
        SELECT user_id
        FROM group_members
        WHERE group_id = ?
      )
      ORDER BY firstName ASC, email ASC
    `;

    sqlConnection.query(sql, [groupId], (err2, results) => {
      if (err2) {
        console.error("MySQL error loading available users:", err2);
        return res.status(500).json({ error: "Server error" });
      }

      return res.json(results);
    });
  });
});

app.post("/group/:groupId/add-members", requireAuthJson, (req, res) => {
  const groupId = Number(req.params.groupId);
  const { memberIds } = req.body;

  if (!groupId) {
    return res.status(400).json({ error: "Invalid group id" });
  }

  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: "No members selected" });
  }

  const membershipCheckSql = `
    SELECT u.id
    FROM users u
    JOIN group_members gm
      ON gm.user_id = u.id
    WHERE u.email = ?
      AND gm.group_id = ?
    LIMIT 1
  `;

  sqlConnection.query(membershipCheckSql, [req.session.user.email, groupId], (err, membershipResults) => {
    if (err) {
      console.error("MySQL error checking membership:", err);
      return res.status(500).json({ error: "Server error" });
    }

    if (membershipResults.length === 0) {
      return res.status(403).json({ error: "You are not a member of this group" });
    }

    const cleanMemberIds = [...new Set(memberIds.map(Number).filter(Boolean))];

    if (cleanMemberIds.length === 0) {
      return res.status(400).json({ error: "No valid members selected" });
    }

    const values = cleanMemberIds.map(userId => [groupId, userId]);

    const insertSql = `
      INSERT IGNORE INTO group_members (group_id, user_id)
      VALUES ?
    `;

    sqlConnection.query(insertSql, [values], (err2, result) => {
      if (err2) {
        console.error("MySQL error adding group members:", err2);
        return res.status(500).json({ error: "Failed to add members" });
      }

      return res.json({
        message: "Members added successfully",
        addedCount: result.affectedRows
      });
    });
  });
});

app.post("/group/:groupId/message", requireAuthJson, (req, res) => {
  const groupId = Number(req.params.groupId);
  const { message } = req.body;

  if (!groupId) {
    return res.status(400).json({ error: "Invalid group id" });
  }

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Message cannot be empty" });
  }

  const findUserSql = `
    SELECT u.id
    FROM users u
    JOIN group_members gm
      ON gm.user_id = u.id
    WHERE u.email = ?
      AND gm.group_id = ?
    LIMIT 1
  `;

  sqlConnection.query(findUserSql, [req.session.user.email, groupId], (err, results) => {
    if (err) {
      console.error("MySQL error finding sender:", err);
      return res.status(500).json({ error: "Server error" });
    }

    if (results.length === 0) {
      return res.status(403).json({ error: "You are not a member of this group" });
    }

    const senderId = results[0].id;

    const insertMessageSql = `
      INSERT INTO messages (group_id, sender_user_id, message_text)
      VALUES (?, ?, ?)
    `;

    sqlConnection.query(insertMessageSql, [groupId, senderId, message.trim()], (err2, result) => {
      if (err2) {
        console.error("MySQL error sending message:", err2);
        return res.status(500).json({ error: "Failed to send message" });
      }

      return res.json({
        message: "Message sent successfully",
        messageId: result.insertId
      });
    });
  });
});

app.post("/group/:groupId/read", requireAuthJson, (req, res) => {
  const groupId = Number(req.params.groupId);

  if (!groupId) {
    return res.status(400).json({ error: "Invalid group id" });
  }

  const findUserSql = `
    SELECT u.id
    FROM users u
    JOIN group_members gm
      ON gm.user_id = u.id
    WHERE u.email = ?
      AND gm.group_id = ?
    LIMIT 1
  `;

  sqlConnection.query(findUserSql, [req.session.user.email, groupId], (err, userResults) => {
    if (err) {
      console.error("MySQL error finding reader:", err);
      return res.status(500).json({ error: "Server error" });
    }

    if (userResults.length === 0) {
      return res.status(403).json({ error: "You are not a member of this group" });
    }

    const userId = userResults[0].id;

    const insertReadsSql = `
      INSERT IGNORE INTO message_reads (message_id, user_id)
      SELECT m.id, ?
      FROM messages m
      WHERE m.group_id = ?
        AND m.sender_user_id <> ?
    `;

    sqlConnection.query(insertReadsSql, [userId, groupId, userId], (err2) => {
      if (err2) {
        console.error("MySQL error marking messages as read:", err2);
        return res.status(500).json({ error: "Failed to mark messages as read" });
      }

      return res.json({ message: "Messages marked as read" });
    });
  });
});

app.get("/groups", requireAuthJson, (req, res) => {
  const sql = `
    SELECT
      cg.id AS group_id,
      cg.group_name,
      MAX(m.sent_at) AS last_message_date,
      COALESCE(SUM(
        CASE
          WHEN m.id IS NOT NULL
               AND m.sender_user_id <> u.id
               AND mr.message_id IS NULL
          THEN 1
          ELSE 0
        END
      ), 0) AS unread_count
    FROM users u
    JOIN group_members gm
      ON gm.user_id = u.id
    JOIN chat_groups cg
      ON cg.id = gm.group_id
    LEFT JOIN messages m
      ON m.group_id = cg.id
    LEFT JOIN message_reads mr
      ON mr.message_id = m.id
     AND mr.user_id = u.id
    WHERE u.email = ?
    GROUP BY cg.id, cg.group_name
    ORDER BY last_message_date DESC, cg.group_name ASC
  `;

  sqlConnection.query(sql, [req.session.user.email], (err, results) => {
    if (err) {
      console.error("MySQL error in /groups:", err);
      return res.status(500).json({ error: "Server error" });
    }

    return res.json({
      totalGroups: results.length,
      groups: results
    });
  });
});

/* =========================
   WEBSITE ROUTES
   ========================= */

app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'pages/index.html')));
app.get('/signIn', (req, res) => res.sendFile(path.join(ROOT, 'pages/signIn.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(ROOT, 'pages/signUp.html')));

app.get('/authenticated', (req, res) => {
  if (!req.session.user) return res.redirect('/signIn');
  res.sendFile(path.join(ROOT, 'pages/authenticated.html'));
});

app.get("/groupsPage", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/signIn");
  }
  res.sendFile(path.join(ROOT, "pages/groups.html"));
});

app.get('/membersOnly', (req, res) => {
  if (!req.session.user) return res.redirect('/signIn');
  res.sendFile(path.join(ROOT, 'pages/membersOnly.html'));
});

// Website signup: redirect flow
app.post("/signup", async (req, res) => {
  const { error, value } = signupSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.send(`<p>${error.details[0].message}</p><a href="/signup">Try again</a>`);
  }

  const { firstName, email, password } = value;

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
        const passwordHash = await bcrypt.hash(password, 10);

        sqlConnection.query(
          "INSERT INTO users (firstName, email, passwordHash) VALUES (?, ?, ?)",
          [firstName, email, passwordHash],
          (err2) => {
            if (err2) {
              console.error("MySQL insert error:", err2);
              return res.status(500).send("Server error");
            }

            req.session.user = { email };
            logUsersTable("after signup");

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

// Website login: redirect flow
app.post("/signIn", (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

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
      console.log("👤 Website login attempt for:", email);
      logUsersTable("during website login");

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        return res.send(`<p>Incorrect password</p><a href="/signIn">Try again</a>`);
      }

      req.session.user = { email: user.email };

      return res.redirect("/authenticated");
    }
  );
});

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