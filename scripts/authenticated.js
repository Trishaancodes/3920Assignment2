
window.onload = async () => {
    try {
      const res = await fetch('/user');
      const data = await res.json();
  
      if (data && data.firstName) {
        document.getElementById('user-name').textContent = data.firstName;
      } else {
        document.getElementById('user-name').textContent = "Guest";
      }
    } catch (err) {
      console.error("Error loading user name:", err);
      document.getElementById('user-name').textContent = "Guest";
    }
  };
  
  function goToMembers() {
    window.location.href = "/membersOnly";
  }
  
  function logout() {
    window.location.href = "/logout";
  }
  