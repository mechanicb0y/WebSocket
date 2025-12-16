const socket = io();


// Handle connection event
socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
});


// Handle messages from server
socket.on("message", (data) => {
  console.log("From server:", data);


  //دي البتطلع لينا في التيرمنال بعدين تحت لم نشغل الكود
  // Send a response back to server (it will show in the terminal) 

  socket.emit("message", "hello server");
  
});
