
const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);


  socket.on("test", (data) => {
    console.log("test message:", data);
    console.log("from client:", socket.id);


    socket.emit("test response", "server received the message");
  });


  socket.on("message", (data) => {
    console.log("Message from client:", data);
  });
});

httpServer.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});

