const { createServer } = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const httpServer = createServer((req, res) => {
  // Serve client files
  let filePath =
    req.url === "/"
      ? path.join(__dirname, "../client/index.html")
      : path.join(__dirname, "../client", req.url);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentType =
      ext === ".js" ? "application/javascript" : "text/html";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

const io = new Server(httpServer, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);


  // هنا الي بيظهر في الكوسنول في الويب سايد
  // Send a message to the client upon connection(it will show in the browser console)

  socket.emit("message", "Hello from server123");

  socket.on("message", (data) => {
    console.log("From client:", data);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

httpServer.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
