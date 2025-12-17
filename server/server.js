
const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer(); // Consistent naming

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("message", (data) => {
    console.log("Message from client:", data);
  });
});

httpServer.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});

