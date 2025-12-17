const socket = io();


socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
});


socket.on("message", (data) => {
  console.log("From server:", data);




  socket.emit("message", "hello server");

});
