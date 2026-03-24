window.onload = async () => {
  try {
    // Load user
    const userRes = await fetch("/user");

    if (!userRes.ok) {
      window.location.href = "/signIn";
      return;
    }

    const userData = await userRes.json();

    if (userData.firstName) {
      document.getElementById("username").textContent =
        `Hello, ${userData.firstName}`;
    }

    // Load groups
    const groupsRes = await fetch("/groups");

    if (!groupsRes.ok) {
      window.location.href = "/signIn";
      return;
    }

    const groupsData = await groupsRes.json();

    document.getElementById("totalGroups").textContent =
      `Total Groups: ${groupsData.totalGroups}`;

    const container = document.getElementById("groupsContainer");

    if (!groupsData.groups || groupsData.groups.length === 0) {
      container.innerHTML = "<p>No groups yet.</p>";
      return;
    }

    // Render groups (NEW UI)
    container.innerHTML = groupsData.groups.map(group => `
      <div class="group-card" onclick="openGroup(${group.group_id})">

        <div class="group-header">
          <span>${group.group_name}</span>
          ${
            group.unread_count > 0
              ? `<span class="unread-badge">${group.unread_count}</span>`
              : ""
          }
        </div>

        <div class="group-preview">
          ${
            group.last_message_date
              ? new Date(group.last_message_date).toLocaleString()
              : "No messages yet"
          }
        </div>

      </div>
    `).join("");

  } catch (err) {
    console.error("Error loading groups:", err);
    document.getElementById("groupsContainer").innerHTML =
      "<p>Error loading groups.</p>";
  }
};

// Navigation
function openGroup(groupId) {
  window.location.href = `/group/${groupId}`;
}

function logout() {
  window.location.href = "/logout";
}

function goToCreateGroup() {
  window.location.href = "/createGroup";
}