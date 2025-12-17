
const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    credentials: true,
  },
});

console.log("Video Streaming Server");

const clients = new Map();




io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);




  socket.on("test", (data) => {
    console.log("test message:", data);
    console.log("from client:", socket.id);

    socket.emit("test response", "server received the message");
  });

  // the video part


  socket.on("send-video", (videoData) => {
    console.log("📹 VIDEO RECEIVED from web:");
    console.log("   Name:", videoData.name);
    console.log("   Size:", videoData.size, "bytes");
    console.log("   Type:", videoData.type);
    console.log("   Preview:", videoData.data.substring(0, 100) + "...");

    // here in the real app, you would forward the video to the mobile client

    // socket.broadcast.emit('mobile-video', videoData);


    socket.emit("video-received", {
      message: "Video ready for mobile!",
      name: videoData.name,
      size: videoData.size
    });

    console.log("Video marked for mobile delivery");
  });





  socket.on("message", (data) => {
    console.log("Message from client:", data);
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected:", socket.id);
  });
});

httpServer.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
  console.log("Ready to send videos to mobile");
});

