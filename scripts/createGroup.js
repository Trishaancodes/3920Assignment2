window.onload = async () => {
  try {
    const res = await fetch("/users-for-group");
    const users = await res.json();

    const usersList = document.getElementById("users-list");

    if (!Array.isArray(users) || users.length === 0) {
      usersList.innerHTML = "<p>No other users available.</p>";
      return;
    }

    usersList.innerHTML = users.map(user => `
      <label class="user-option">
        <input type="checkbox" name="memberIds" value="${user.id}">
        ${user.firstName} (${user.email})
      </label>
    `).join("");
  } catch (err) {
    console.error("Error loading users:", err);
    document.getElementById("users-list").innerHTML = "<p>Error loading users.</p>";
  }
};

document.getElementById("create-group-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const groupName = document.getElementById("groupName").value.trim();
  const checkedBoxes = document.querySelectorAll('input[name="memberIds"]:checked');
  const memberIds = Array.from(checkedBoxes).map(box => Number(box.value));

  try {
    const res = await fetch("/createGroup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ groupName, memberIds })
    });

    const data = await res.json();

    if (!res.ok) {
      document.getElementById("message").textContent = data.error || "Failed to create group";
      return;
    }

    document.getElementById("message").textContent = data.message;
    setTimeout(() => {
      window.location.href = "/groupsPage";
    }, 1000);
  } catch (err) {
    console.error("Error creating group:", err);
    document.getElementById("message").textContent = "Error creating group.";
  }
});

function goBack() {
  window.location.href = "/membersOnly";
}