function logout() {
    window.location.href = "/logout";
  }
  
  window.onload = function () {
    const imagePlaceholder = document.querySelector(".image-placeholder");

    const images = ["/public/dog1.jpg", "/public/dog2.jpg", "/public/dog3.jpeg"];
    const randomImage = images[Math.floor(Math.random() * images.length)];

    const imgElement = document.createElement("img");
    imgElement.src = randomImage;

    imagePlaceholder.appendChild(imgElement);
};