
const { createServer } = require("http");
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');

// simple uploads dir
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const httpServer = createServer((req, res) => {
  // serve uploaded files under /uploads/:filename
  if (req.method === 'GET' && req.url && req.url.startsWith('/uploads/')) {
    // support token query for access control: /uploads/filename?token=...
    const [pathPart, query] = req.url.split('?');
    const fileName = decodeURIComponent(pathPart.replace('/uploads/', ''));
    const filePath = path.join(uploadsDir, fileName);
    const urlParams = new URLSearchParams(query || '');
    const token = urlParams.get('token');

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (!token) {
      res.writeHead(401);
      res.end('Token required');
      return;
    }

    const tokenInfo = tokens.get(token);
    if (!tokenInfo || tokenInfo.filename !== fileName || Date.now() > tokenInfo.expires) {
      res.writeHead(403);
      res.end('Invalid or expired token');
      return;
    }

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    credentials: true,
  },
});

console.log("Video Streaming Server");

const clients = new Map(); // map socketId => { socket, device }

// Helper to register client device
function registerClientDevice(socket, device) {
  const entry = clients.get(socket.id) || {};
  entry.socket = socket;
  entry.device = device;
  clients.set(socket.id, entry);
}
const uploads = {}; // track ongoing uploads by uploadId
const tokens = new Map(); // token -> { filename, expires }




io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);
  // register client entry object
  clients.set(socket.id, { socket, device: null });

  // allow client to announce its device type
  socket.on('register-device', (device) => {
    registerClientDevice(socket, device);
    console.log(`Registered device for ${socket.id}: ${device}`);
  });




  socket.on("test", (data) => {
    console.log("test message:", data);
    console.log("from client:", socket.id);

    socket.emit("test response", "server received the message");
  });

  // receive upload chunk: meta + binary chunk (supports resume via chunk index)
  socket.on('upload-chunk', (meta, chunk) => {
    try {
      const { uploadId, name, index, total, size, targetId, deviceType, chunkSize } = meta;
      if (!uploadId) {
        socket.emit('upload-error', { uploadId: null, message: 'Missing uploadId' });
        return;
      }

      const filename = `${uploadId}-${name}`;
      const filePath = path.join(uploadsDir, filename);

      if (!uploads[uploadId]) {
        uploads[uploadId] = { path: filePath, receivedChunks: new Set(), total, size, name, from: socket.id };
      }

      // write chunk at correct offset so resume/retries work
      const fd = fs.openSync(filePath, 'a+');
      const offset = index * (chunkSize || chunk.length);
      fs.writeSync(fd, Buffer.from(chunk), 0, chunk.length, offset);
      fs.closeSync(fd);

      // record this chunk
      if (!uploads[uploadId].receivedChunks.has(index)) uploads[uploadId].receivedChunks.add(index);

      const receivedCount = uploads[uploadId].receivedChunks.size;
      const percent = Math.round((receivedCount / total) * 100);

      // ack progress to uploader
      socket.emit('upload-progress', { uploadId, percent, received: receivedCount, total });

      // when complete
      if (receivedCount === total) {
        console.log(`Upload complete: ${name} (${size} bytes) from ${socket.id}`);

        // generate a short-lived token (10 minutes)
        const token = `${uploadId}-${Math.random().toString(36).slice(2, 10)}`;
        const expires = Date.now() + 10 * 60 * 1000;
        tokens.set(token, { filename, expires });

        socket.emit('upload-complete', { uploadId, name, size, url: `/uploads/${encodeURIComponent(filename)}?token=${token}`, token });

        // send to target client if provided
        if (targetId) {
          const entry = clients.get(targetId);
          const targetSocket = entry && entry.socket;
          const targetIsAndroid = entry && entry.device === 'android';
          if (targetSocket && targetIsAndroid) {
            targetSocket.emit('mobile-video', { name, size, from: socket.id, deviceType, url: `/uploads/${encodeURIComponent(filename)}?token=${token}` });
            socket.emit('delivery-status', { uploadId, delivered: true, to: targetId, recipients: 1 });
          } else if (targetSocket && !targetIsAndroid) {
            socket.emit('delivery-status', { uploadId, delivered: false, reason: 'target-not-android', recipients: 0 });
          } else {
            socket.emit('delivery-status', { uploadId, delivered: false, reason: 'target-not-found', recipients: 0 });
          }
        } else {
          // broadcast to others
          // only deliver to clients registered as android devices
          const recipientIds = Array.from(clients.entries())
            .filter(([id, entry]) => id !== socket.id && entry && entry.device === 'android')
            .map(([id]) => id);

          recipientIds.forEach(id => {
            const targetSocket = clients.get(id).socket;
            if (targetSocket) targetSocket.emit('mobile-video', { name, size, from: socket.id, url: `/uploads/${encodeURIComponent(filename)}?token=${token}` });
          });

          const recipients = recipientIds.length;
          socket.emit('delivery-status', { uploadId, delivered: true, to: 'broadcast', recipients });
        }

        // cleanup upload tracking
        delete uploads[uploadId];

        // schedule token cleanup
        setTimeout(() => {
          tokens.delete(token);
        }, 10 * 60 * 1000 + 1000);
      }
    } catch (err) {
      console.error('upload-chunk error', err);
      socket.emit('upload-error', { message: err.message });
    }
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
    clients.delete(socket.id);
  });
});

httpServer.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
  console.log("Ready to send videos to mobile");
});

