
const { createServer } = require("http");
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');

// simple uploads dir
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Token and upload tracking (persists across requests)
const uploads = {}; // track ongoing uploads by uploadId
const tokens = new Map(); // token -> { filename, expires }

// Initialize optional S3 client (non-fatal if aws-sdk not installed)
let s3Client = null;
let s3Region = process.env.AWS_REGION || null;
let s3Bucket = process.env.S3_BUCKET || null;
try {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && s3Bucket) {
    const AWS = require('aws-sdk');
    AWS.config.update({ region: process.env.AWS_REGION });
    s3Client = new AWS.S3();
    s3Region = process.env.AWS_REGION;
    console.log('S3 enabled for bucket', s3Bucket);
  }
} catch (err) {
  console.log('AWS SDK not available or not configured — continuing without S3:', err && err.message);
}

const httpServer = createServer((req, res) => {
  // handle CORS preflight for upload-direct and others
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-File-Name',
      'Access-Control-Max-Age': 86400
    });
    res.end();
    return;
  }

  // simple mobile receiver page at /mobile
  if (req.method === 'GET' && req.url && (req.url === '/mobile' || req.url === '/mobile.html')) {
    const html = `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Phone Receiver</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,"Helvetica Neue",Arial;margin:0;padding:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#111}
    .container{width:100%;max-width:420px;padding:16px;color:#fff}
    h1{font-size:18px;margin:0 0 8px}
    #status{font-size:14px;color:#9ca3af;margin-bottom:8px}
    video{width:100%;border-radius:10px;background:#000}
    .play-btn{margin-top:8px;padding:10px 12px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:600;width:100%}
    a{color:#60a5fa}
  </style>
</head>
<body>
  <div class="container">
    <h1>Phone Receiver</h1>
    <div id="status">Connecting…</div>
    <video id="v" controls playsinline webkit-playsinline muted></video>
    <button id="playBtn" class="play-btn" style="display:none">Tap to Play</button>
    <p style="margin-top:8px;font-size:12px;color:#9ca3af">Powered by demo server</p>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const status = document.getElementById('status');
    const video = document.getElementById('v');
    const playBtn = document.getElementById('playBtn');

    socket.on('connect', () => {
      socket.emit('register-device', 'android');
      status.textContent = 'Registered as Android receiver (' + socket.id + ')';
    });

    socket.on('disconnect', () => { status.textContent = 'Disconnected'; });

    socket.on('mobile-video', (info) => {
      status.textContent = 'Video received: ' + (info.name || 'untitled');
      // info.url can be either relative (/uploads/..?token=..) or absolute (http://.. or https://..)
      const url = info.url || info.src || '';
      if (!url) return;
      // make absolute if relative
      const full = url.startsWith('http') ? url : (location.origin + url);
      console.log('🎥 Mobile: Setting video source to', full);
      video.src = full;
      video.muted = true;
      playBtn.style.display = 'none';
      video.play().then(() => {
        // autoplay succeeded (muted)
      }).catch(() => {
        // show play button for user gesture
        playBtn.style.display = '';
      });
    });

    playBtn.addEventListener('click', () => {
      video.muted = false;
      video.play();
      playBtn.style.display = 'none';
    });
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // direct upload endpoint for creating a short link immediately
  if (req.method === 'POST' && req.url === '/upload-direct') {
    const filenameHeader = req.headers['x-file-name'] || `upload-${Date.now()}`;
    const safeName = path.basename(String(filenameHeader));
    const filename = `${Date.now()}-${safeName}`;
    const filePath = path.join(uploadsDir, filename);

    const writeStream = fs.createWriteStream(filePath);
    req.pipe(writeStream);

    writeStream.on('finish', async () => {
      try {
        // create token
        const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
        tokens.set(token, { filename, expires });

        // schedule cleanup
        setTimeout(() => tokens.delete(token), 10 * 60 * 1000 + 1000);

        const rawHost = req.headers.host || 'localhost:3000';
        let host = rawHost;
        // if host is localhost, try to find a LAN IP to make the link usable on phone
        if (rawHost.startsWith('localhost') || rawHost.startsWith('127.0.0.1')) {
          const os = require('os');
          const nets = os.networkInterfaces();
          for (const name of Object.keys(nets)) {
            for (const ni of nets[name]) {
              if (ni.family === 'IPv4' && !ni.internal) {
                host = `${ni.address}:3000`;
                break;
              }
            }
            if (!host.startsWith('localhost')) break;
          }
        }

        // If S3 is enabled, upload the file there and return public play URL
        let playUrl = `http://${host}/play?file=${encodeURIComponent(filename)}&token=${token}`;
        let uploadUrl = `http://${host}/uploads/${encodeURIComponent(filename)}?token=${token}`;

        if (s3Client && s3Bucket) {
          try {
            const contentType = req.headers['content-type'] || 'application/octet-stream';
            await s3Client.putObject({
              Bucket: s3Bucket,
              Key: filename,
              Body: fs.createReadStream(filePath),
              ACL: 'public-read',
              ContentType: contentType
            }).promise();

            // public S3 url
            const s3Url = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${encodeURIComponent(filename)}`;
            uploadUrl = s3Url;
            playUrl = s3Url; // direct link is playable

            // Optionally remove local copy to save space
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
          } catch (s3err) {
            console.error('S3 upload failed:', s3err);
            // fall back to local urls
          }
        }

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ uploadUrl, playUrl, token }));
      } catch (err) {
        console.error('direct upload finish error', err);
        res.writeHead(500);
        res.end('Upload failed');
      }
    });

    writeStream.on('error', (err) => {
      console.error('direct upload error', err);
      res.writeHead(500);
      res.end('Upload failed');
    });

    return;
  }

  // simple play page for a tokenized file: /play?file=FILENAME&token=...
  if (req.method === 'GET' && req.url && req.url.startsWith('/play')) {
    const [pathPart, query] = req.url.split('?');
    const urlParams = new URLSearchParams(query || '');
    const fileName = urlParams.get('file');
    const token = urlParams.get('token');
    if (!fileName || !token) {
      res.writeHead(400);
      res.end('Missing file or token');
      return;
    }

    const tokenInfo = tokens.get(token);
    if (!tokenInfo || tokenInfo.filename !== fileName || Date.now() > tokenInfo.expires) {
      res.writeHead(403);
      res.end('Invalid or expired token');
      return;
    }

    const playerHtml = `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Play Video</title>
  <style>body{margin:0;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh}video{width:100%;height:auto;max-width:720px;border-radius:8px}</style>
</head>
<body>
  <video id="v" controls playsinline webkit-playsinline muted autoplay>
    <source src="/uploads/${encodeURIComponent(fileName)}?token=${encodeURIComponent(token)}">
    Your browser does not support HTML5 video.
  </video>
  <script>
    const v = document.getElementById('v');
    v.addEventListener('play', ()=>{ v.muted = false; });
    // if autoplay blocked, show play button (browser does this by default)
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
    res.end(playerHtml);
    return;
  }

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

    // support range requests for video streaming
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const range = req.headers.range;

    // determine mime type from extension
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap = {
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v'
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      if (start >= total || end >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': (end - start) + 1,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      return;
    }

    // full content
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': total,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
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
    origin: "*",
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


io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);
  // register client entry object
  clients.set(socket.id, { socket, device: null });

  // allow client to announce its device type
  socket.on('register-device', (device) => {
    registerClientDevice(socket, device);
    console.log(`✅ Registered device for ${socket.id}: ${device}`);
    console.log(`📊 Total registered clients: ${Array.from(clients.values()).filter(e => e.device).length}`);
    console.log(`   All clients:`, Array.from(clients.entries()).map(([id, e]) => `${id.substring(0, 8)}:${e.device || 'unregistered'}`).join(', '));
  });

  socket.on('disconnect', () => {
    console.log(`⚠️ Client disconnected: ${socket.id}`);
    clients.delete(socket.id);
  });




  socket.on("test", (data) => {
    console.log("test message:", data);
    console.log("from client:", socket.id);

    socket.emit("test response", "server received the message");
  });

  // Handle video URL forwarding (direct streaming without file upload)
  socket.on('send-video-url', (data, callback) => {
    try {
      const { url, name, targetId } = data;

      if (!url) {
        console.log(`  ❌ Missing URL`);
        socket.emit('delivery-status', { delivered: false, reason: 'missing-url' });
        if (callback) callback(false);
        return;
      }

      console.log(`📺 URL streaming request from ${socket.id.substring(0, 8)}: ${url}`);

      // Validate basic URL format
      try {
        new URL(url);
      } catch (e) {
        console.log(`  ❌ Invalid URL format: ${e.message}`);
        socket.emit('delivery-status', { delivered: false, reason: 'invalid-url' });
        if (callback) callback(false);
        return;
      }

      // If targetId specified, send to that client only
      if (targetId) {
        const entry = clients.get(targetId);
        const targetSocket = entry && entry.socket;
        const targetIsAndroid = entry && entry.device === 'android';

        if (targetSocket && targetIsAndroid) {
          // Send URL directly to target device (not file, just the URL)
          targetSocket.emit('mobile-video', {
            name: name || url.split('/').pop() || 'video',
            url: url, // Direct URL, not a /uploads/ path
            from: socket.id,
            isDirectUrl: true // Flag to indicate this is a direct URL stream
          });
          console.log(`  ✅ Sent to target ${targetId.substring(0, 8)}`);
          socket.emit('delivery-status', { delivered: true, to: targetId, recipients: 1 });
          if (callback) callback(true);
        } else if (targetSocket && !targetIsAndroid) {
          socket.emit('delivery-status', { delivered: false, reason: 'target-not-android', recipients: 0 });
          if (callback) callback(false);
        } else {
          socket.emit('delivery-status', { delivered: false, reason: 'target-not-found', recipients: 0 });
          if (callback) callback(false);
        }
      } else {
        // Broadcast to all android clients (excluding sender)
        console.log(`📤 Broadcasting URL to android clients. Total clients: ${clients.size}`);

        const recipientIds = Array.from(clients.entries())
          .filter(([id, entry]) => {
            const isAndroid = entry && entry.device === 'android';
            const isSender = id === socket.id;
            console.log(`  Client ${id.substring(0, 8)}: device=${entry?.device}, isSender=${isSender}`);
            return !isSender && isAndroid;
          })
          .map(([id]) => id);

        console.log(`📡 Sending to ${recipientIds.length} android recipients`);

        recipientIds.forEach(id => {
          const targetSocket = clients.get(id).socket;
          if (targetSocket) {
            console.log(`  → Emitting mobile-video to ${id.substring(0, 8)}`);
            targetSocket.emit('mobile-video', {
              name: name || url.split('/').pop() || 'video',
              url: url, // Direct URL
              from: socket.id,
              isDirectUrl: true
            });
          }
        });

        const recipients = recipientIds.length;
        socket.emit('delivery-status', { delivered: true, to: 'broadcast', recipients });
        if (callback) callback(recipients > 0);
      }
    } catch (err) {
      console.error('send-video-url error', err);
      socket.emit('delivery-status', { delivered: false, reason: 'error', error: err.message });
      if (callback) callback(false);
    }
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

