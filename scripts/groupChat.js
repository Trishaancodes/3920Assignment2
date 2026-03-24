const groupId = window.location.pathname.split("/")[2];
let availableEmojis = [];
let pollingInterval = null;

async function fetchJsonOrThrow(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text}`);
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed for ${url}`);
  }

  return data;
}

async function loadEmojis() {
  availableEmojis = await fetchJsonOrThrow("/emojis");
}

function renderReactions(reactions) {
  if (!reactions || reactions.length === 0) {
    return "";
  }

  return `
    <div class="reaction-list">
      ${reactions.map(r => `
        <span
          class="reaction-pill"
          title="${r.reactors.join(", ")}"
        >
          ${r.emoji_symbol} ${r.reaction_count}
        </span>
      `).join("")}
    </div>
  `;
}

function renderEmojiPicker(messageId) {
  return `
    <div class="emoji-picker">
      ${availableEmojis.map(emoji => `
        <button
          type="button"
          class="emoji-btn"
          onclick="toggleReaction(${messageId}, ${emoji.id})"
          title="${emoji.emoji_name}"
        >
          ${emoji.emoji_symbol}
        </button>
      `).join("")}
    </div>
  `;
}

async function loadMessages(silent = false) {
  const messages = await fetchJsonOrThrow(`/group/${groupId}/messages`);
  const container = document.getElementById("messages");

  const isAtBottom =
    container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

  if (!Array.isArray(messages) || messages.length === 0) {
    container.innerHTML = "<p>No messages yet.</p>";
    return;
  }

  container.innerHTML = "";

  let unreadLineShown = false;

  messages.forEach(msg => {
    if (
      Number(msg.is_read) === 0 &&
      Number(msg.sender_id) !== Number(msg.current_user_id) &&
      !unreadLineShown
    ) {
      container.innerHTML += `
        <div class="unread-divider">
          <span>Unread messages</span>
        </div>
      `;
      unreadLineShown = true;
    }

    const isOwn = Number(msg.sender_id) === Number(msg.current_user_id);

    container.innerHTML += `
      <div class="message-block ${isOwn ? "own-block" : "other-block"}">
        <div class="message ${isOwn ? "own-message" : "other-message"}">
          <strong>${isOwn ? "You" : msg.sender_name}</strong>
          <div>${msg.message_text}</div>
          <small>${new Date(msg.sent_at).toLocaleTimeString()}</small>
        </div>

        ${renderReactions(msg.reactions)}
        ${renderEmojiPicker(msg.id)}
      </div>
    `;
  });

  if (!silent || isAtBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

function startPolling() {
  if (pollingInterval) return;

  pollingInterval = setInterval(async () => {
    try {
      await loadMessages(true);
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 2000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

async function toggleReaction(messageId, emojiId) {
  try {
    await fetchJsonOrThrow(`/group/${groupId}/message/${messageId}/reaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ emojiId })
    });

    await loadMessages(true);
  } catch (err) {
    console.error("Error toggling reaction:", err);
    alert(err.message || "Error reacting to message");
  }
}

document.getElementById("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const input = document.getElementById("messageInput");
  const message = input.value.trim();

  if (!message) {
    return;
  }

  try {
    await fetchJsonOrThrow(`/group/${groupId}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    input.value = "";
    await loadMessages();
  } catch (err) {
    console.error("Error sending message:", err);
    alert(err.message || "Error sending message");
  }
});

function goBack() {
  window.location.href = "/groupsPage";
}

window.onload = async () => {
  await loadEmojis();
  await loadMessages();
  startPolling();

  setTimeout(async () => {
    try {
      await fetch(`/group/${groupId}/read`, { method: "POST" });
    } catch (err) {
      console.error("Error marking read:", err);
    }
  }, 1500);
};

async function showAddMembers() {
  const panel = document.getElementById("add-members-panel");
  const list = document.getElementById("available-users-list");

  if (panel.style.display === "block") {
    panel.style.display = "none";
    return;
  }

  try {
    const users = await fetchJsonOrThrow(`/group/${groupId}/available-users`);

    if (!users.length) {
      list.innerHTML = "<p>No users available to add.</p>";
    } else {
      list.innerHTML = users.map(user => `
        <label>
          <input type="checkbox" value="${user.id}">
          ${user.firstName} (${user.email})
        </label><br>
      `).join("");
    }

    panel.style.display = "block";
  } catch (err) {
    console.error("Error loading available users:", err);
    alert(err.message || "Error loading users");
  }
}

async function submitAddMembers() {
  const checked = [
    ...document.querySelectorAll('#available-users-list input[type="checkbox"]:checked')
  ];

  const memberIds = checked.map(cb => Number(cb.value));

  if (memberIds.length === 0) {
    alert("Select at least one user");
    return;
  }

  try {
    await fetchJsonOrThrow(`/group/${groupId}/add-members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ memberIds })
    });

    alert("Members added successfully");
    document.getElementById("add-members-panel").style.display = "none";
  } catch (err) {
    console.error("Error adding members:", err);
    alert(err.message || "Error adding members");
  }
}

window.onbeforeunload = () => {
  stopPolling();
};