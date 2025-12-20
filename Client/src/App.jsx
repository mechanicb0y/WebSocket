import { useEffect, useState, useRef } from 'react' // i added useRef but not used
import io from 'socket.io-client'
import './App.css'
import Input from './components/input';

function App() {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverResponse, setServerResponse] = useState('');
  //i also added these states but not used
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoName, setVideoName] = useState('');
  const [showSelectedInfo, setShowSelectedInfo] = useState(false);
  const fileInputRef = useRef(null);
  // generate thumbnail from video file (returns dataURL)
  const generateThumbnail = (file) => {
    return new Promise((resolve, reject) => {
      try {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.addEventListener('loadeddata', () => {
          const time = Math.min(0.5, video.duration / 2 || 0);
          video.currentTime = time;
        });
        video.addEventListener('seeked', () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(320, video.videoWidth);
            canvas.height = Math.min(180, video.videoHeight);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            URL.revokeObjectURL(url);
            resolve(dataUrl);
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        });
        setTimeout(() => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(320, video.videoWidth || 320);
            canvas.height = Math.min(180, video.videoHeight || 180);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            URL.revokeObjectURL(url);
            resolve(dataUrl);
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e);
          }
        }, 3000);
      } catch (e) {
        reject(e);
      }
    });
  };

  // upload states
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState('');
  const [uploadETA, setUploadETA] = useState('');
  const [uploadBytesSent, setUploadBytesSent] = useState(0);
  const [uploadId, setUploadId] = useState(null);
  const [targetId, setTargetId] = useState('');
  const [clients, setClients] = useState([]);
  const [successMessage, setSuccessMessage] = useState('');
  const [thumbnail, setThumbnail] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [uploadBroadcast, setUploadBroadcast] = useState(false);

  // Phone mockup states
  const [receivedVideo, setReceivedVideo] = useState(null);
  const [videoPlaying, setVideoPlaying] = useState(false);

  // URL-based streaming states
  const [videoUrl, setVideoUrl] = useState('');
  const [urlError, setUrlError] = useState('');

  const DEVICE_TYPE = 'android'; // restricted to Android phones only now

  // helper: format bytes to human readable string
  const formatBytes = (bytes) => {
    if (typeof bytes !== 'number') return '';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const uploadIdRef = useRef(null);
  useEffect(() => { uploadIdRef.current = uploadId; }, [uploadId]);

  useEffect(() => {
    // Build socket server URL dynamically (localStorage override -> current host :3000)
    const socketServerUrl = localStorage.getItem('socketServerUrl') || (() => {
      const host = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '127.0.0.1' : window.location.hostname;
      return `http://${host}:3000`;
    })();
    console.log('Connecting to socket server at', socketServerUrl);

    const newSocket = io(socketServerUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // do not cap reconnection attempts so the dashboard will keep trying after a reboot
      // (remove `reconnectionAttempts` so default of unlimited attempts applies)
      transports: ['websocket', 'polling']
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('✅ Connected to server:', newSocket.id);
      setIsConnected(true);
      newSocket.emit('register-device', 'dashboard');
    });

    newSocket.on('disconnect', () => {
      console.log('⚠️ Disconnected from server');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error);
    });

    newSocket.on('reconnect_attempt', () => {
      console.log('🔄 Attempting to reconnect...');
      setServerResponse('🔄 Attempting to reconnect...');
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('🔄 Reconnected after', attemptNumber, 'attempts');
      setServerResponse('✅ Reconnected to server');
    });

    newSocket.on('reconnect_failed', () => {
      console.error('❌ Reconnect failed — will keep trying in background');
      setServerResponse('❌ Failed to reconnect (will keep trying)');
    });

    // updated clients list from server (contains [{id, device}])
    newSocket.on('clients-updated', (list) => {
      setClients(Array.isArray(list) ? list : []);
    });


    newSocket.on('test response', (data) => {
      console.log('📨 Response from server:', data);
      setServerResponse(data);
    });

    //receive video confirmation from server
    newSocket.on('video-received', (data) => {
      console.log('Video sent to server:', data);
      // use the name sent by the server to avoid stale closures
      setServerResponse(`✅ Video "${data.name}" sent to mobile!`);
    });

    // optional: show server inactive messages if server emits them
    newSocket.on('server inactive', (msg) => {
      console.log('Server inactive:', msg);
      setServerResponse(msg);
    });

    // upload-related events
    newSocket.on('upload-progress', (data) => {
      if (data && data.uploadId === uploadIdRef.current) {
        setUploadProgress(data.percent || 0);
      }
    });

    newSocket.on('upload-complete', (data) => {
      if (data && data.uploadId === uploadIdRef.current) {
        const msg = `✅ Upload complete: ${data.name}`;
        console.log(msg);
        setServerResponse(msg);
        setUploadProgress(100);
        setUploading(false);
        setUploadSpeed('');
        setUploadETA('');
      }
    });

    newSocket.on('upload-error', (err) => {
      console.error('❌ Upload error from server', err);
      const errorMsg = err?.message || 'Upload failed';
      setServerResponse(`Upload error: ${errorMsg}`);
      setUploading(false);
      setUploadError(errorMsg);
    });

    newSocket.on('delivery-status', (status) => {
      if (status && status.uploadId === uploadIdRef.current) {
        if (status.delivered) {
          const recipients = status.recipients || (status.to && status.to !== 'broadcast' ? 1 : 0);
          const msg = `✅ Video delivered to ${recipients} device${recipients !== 1 ? 's' : ''}`;
          setSuccessMessage(msg);
          console.log(msg);
          setUploadProgress(100);
          setUploading(false);
          setUploadSpeed('');
          setUploadETA('');
          setTimeout(() => {
            setSuccessMessage('');
            setUploadProgress(0);
            setUploadId(null);
          }, 3000);
        } else {
          const reason = status.reason === 'target-not-android' ? 'Target device is not Android' :
            status.reason === 'target-not-found' ? 'Target device not found' :
              status.reason || 'Unknown error';
          setServerResponse(`❌ Delivery failed: ${reason}`);
          setUploading(false);
        }
      }
    });

    // Listen for video from other senders (for phone mockup)
    newSocket.on('mobile-video', (info) => {
      console.log('📱 Video received for phone mockup:', info);
      const serverUrl = window.location.origin || 'http://172.100.0.118:3000';
      const videoUrl = info.url?.startsWith('http') ? info.url : `${serverUrl}${info.url}`;
      setReceivedVideo({ ...info, url: videoUrl });
      setVideoPlaying(true);
    });




    return () => {
      newSocket.disconnect();
    };
  }, []);


  useEffect(() => {
    if (!serverResponse) return;
    const timer = setTimeout(() => {
      setServerResponse('');
    }, 3000);
    return () => clearTimeout(timer);
  }, [serverResponse]);

  // auto-hide selected video info after 3 seconds (does not clear selection)
  useEffect(() => {
    if (!selectedVideo) return;
    setShowSelectedInfo(true);
    const t = setTimeout(() => setShowSelectedInfo(false), 10000); // show for 10s
    return () => clearTimeout(t);
  }, [selectedVideo]);


  // direct upload short-link states
  const [directUrl, setDirectUrl] = useState('');
  const [directUploading, setDirectUploading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // to handle file selection
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (file.type.startsWith('video/')) {
        setSelectedVideo(file);
        setVideoName(file.name);
        setServerResponse(`Selected: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
        setShowSelectedInfo(true);
        // reset input so selecting the same file again triggers onChange
        if (fileInputRef?.current) fileInputRef.current.value = '';

        // generate thumbnail preview (client-side)
        generateThumbnail(file).then(dataUrl => setThumbnail(dataUrl)).catch(() => setThumbnail(null));

        // create a short URL for this file by uploading directly
        uploadDirect(file);
      } else {
        alert('Please select a video file');
      }
    }
  };

  const uploadDirect = async (file) => {
    try {
      setDirectUploading(true);
      setDirectUrl('');
      // Always use 172.100.0.118:3000 for API calls (server runs on 3000)
      const serverApiUrl = 'http://172.100.0.118:3000';
      const endpoint = `${serverApiUrl}/upload-direct`;
      console.log('📤 Uploading to:', endpoint);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-file-name': file.name,
          'content-type': file.type || 'application/octet-stream'
        },
        body: file
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt || 'Upload failed'}`);
      }
      const data = await res.json();
      const short = data?.playUrl || data?.uploadUrl || data?.url;
      if (short) {
        setDirectUrl(short);
        console.log('✅ Short URL ready:', short);
        setServerResponse(`✅ Short link ready: ${short}`);
      } else {
        throw new Error('No URL in response');
      }
    } catch (err) {
      console.error('❌ Direct upload failed:', err.message);
      setServerResponse(`❌ Short-link failed: ${err.message}`);
    } finally {
      setDirectUploading(false);
    }
  };

  const copyDirectUrl = async () => {
    if (!directUrl) return;
    try {
      await navigator.clipboard.writeText(directUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (e) {
      console.error('copy failed', e);
    }
  };

  // chunked upload function (new) — keeps progress, speed and ETA
  const CHUNK_SIZE_LOCAL = 256 * 1024; // 256KB

  // pause/resume support
  const [isPaused, setIsPaused] = useState(false);
  const [isCanceled, setIsCanceled] = useState(false);
  const currentChunkRef = useRef(0);
  const totalChunksRef = useRef(0);

  const sendVideoToMobileChunked = async (broadcast = false) => {
    if (!socket || !selectedVideo) {
      alert('Please select a video file first!');
      return;
    }

    // quick validation of target id for direct sends
    if (!broadcast && targetId && !clients.find(c => c.id === targetId)) {
      setServerResponse('❌ Target ID not connected');
      return;
    }

    const totalSize = selectedVideo.size;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE_LOCAL);
    totalChunksRef.current = totalChunks;

    // if resuming an existing upload, reuse uploadId and currentChunkRef; otherwise start fresh
    const isResume = !!uploadId;
    const id = isResume ? uploadId : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    if (!isResume) setUploadId(id);
    if (!isResume) currentChunkRef.current = 0;

    setUploading(true);
    setUploadProgress(prev => (isResume ? prev : 0));
    setUploadBytesSent(prev => (isResume ? prev : 0));
    setUploadSpeed('');
    setUploadETA('');
    setIsPaused(false);
    setIsCanceled(false);
    setUploadError(null);
    setServerResponse(`Uploading "${selectedVideo.name}"...`);

    const startTime = Date.now() - (uploadBytesSent || 0) / (Math.max(1, parseFloat(uploadSpeed) || 1));

    // process remaining chunks starting from currentChunkRef.current
    for (let i = currentChunkRef.current; i < totalChunks; i++) {
      if (isCanceled) break;
      // pause loop when requested
      if (isPaused) {
        currentChunkRef.current = i; // remember where we stopped
        break;
      }

      const start = i * CHUNK_SIZE_LOCAL;
      const end = Math.min(totalSize, (i + 1) * CHUNK_SIZE_LOCAL);
      const chunkBlob = selectedVideo.slice(start, end);
      const arrayBuffer = await chunkBlob.arrayBuffer();

      // emit chunk with chunkSize so server can write at correct offset
      socket.emit('upload-chunk', {
        uploadId: id,
        name: selectedVideo.name,
        index: i,
        total: totalChunks,
        size: totalSize,
        targetId: broadcast ? null : (targetId || null),
        deviceType: DEVICE_TYPE,
        chunkSize: CHUNK_SIZE_LOCAL
      }, new Uint8Array(arrayBuffer));

      // update client-side progress counters
      setUploadBytesSent(prev => {
        const newSent = prev + (end - start);
        const percent = Math.min(100, Math.round((newSent / totalSize) * 100));
        setUploadProgress(percent);

        const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
        const speed = newSent / elapsedSec; // bytes/sec
        setUploadSpeed(`${formatBytes(Math.round(speed))}/s`);
        const remaining = totalSize - newSent;
        const etaSec = speed > 0 ? Math.round(remaining / speed) : 0;
        setUploadETA(`${Math.floor(etaSec / 60)}m ${etaSec % 60}s`);

        return newSent;
      });

      currentChunkRef.current = i + 1;

      // small throttle to prevent starving event loop
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // if we finished all chunks and not canceled, wait for server to emit upload-complete
    if (!isCanceled && currentChunkRef.current >= totalChunks) {
      // nothing else to do here — server will send completion/delivery-status
    } else if (isCanceled) {
      setUploading(false);
      setServerResponse('Upload canceled');
    }
  };

  // pause/resume controls
  const pauseUpload = () => { setIsPaused(true); };
  const resumeUpload = async () => {
    if (!uploadId) return;
    setIsPaused(false);
    // continue sending from current chunk
    await sendVideoToMobileChunked(uploadBroadcast);
  };
  const cancelUpload = () => { setIsCanceled(true); setIsPaused(false); };
  const retryUpload = async () => {
    // reset progress and start over
    setUploadError(null);
    currentChunkRef.current = 0;
    await sendVideoToMobileChunked(uploadBroadcast);
  };


  // send video to mobile
  const sendVideoToMobile = () => {
    if (!socket || !selectedVideo) {
      alert('Please select a video file first!');
      return;
    }

    if (targetId && !clients.find(c => c.id === targetId)) {
      setServerResponse('❌ Target ID not connected');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      // send video data to server
      socket.emit('send-video', {
        name: selectedVideo.name,
        size: selectedVideo.size,
        type: selectedVideo.type,
        // just sending a snippet of the data for demo purposes
        data: e.target.result.substring(0, 500) + '...'
      });

      setServerResponse(`Sending "${selectedVideo.name}" to mobile...`);
    };
    reader.readAsDataURL(selectedVideo);
  };


  // button to open file picker
  const openFilePicker = () => {
    fileInputRef.current.click();
  };

  // Validate and send video URL
  const validateAndSendUrl = (url) => {
    setUrlError('');

    if (!url.trim()) {
      setUrlError('Please enter a video URL');
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch (e) {
      setUrlError('Invalid URL format');
      return;
    }

    // Check for common video extensions or MIME types
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.m4v', '.mkv', '.avi', '.flv', '.wmv'];
    const isVideoUrl = videoExtensions.some(ext => url.toLowerCase().includes(ext)) ||
      url.includes('youtube.com') ||
      url.includes('vimeo.com') ||
      url.includes('stream');

    if (!isVideoUrl && !url.includes('?')) {
      setUrlError('⚠️ URL might not be a video. Proceeding anyway...');
      // Don't return - still allow it
    }

    sendVideoUrl(url);
  };

  // Send video URL to connected phone
  const sendVideoUrl = (url) => {
    if (!socket) {
      setServerResponse('❌ Not connected to server');
      return;
    }

    if (!isConnected) {
      setServerResponse('❌ Socket not connected');
      return;
    }

    console.log('🎬 Sending video URL to phone:', url);

    // Send URL as event (now supports optional targetId)
    socket.emit('send-video-url', {
      url: url,
      name: url.split('/').pop() || 'video',
      timestamp: Date.now(),
      targetId: targetId || null
    }, (ack) => {
      if (ack) {
        setServerResponse(`✅ URL sent to phone: ${url}`);
        setVideoUrl('');
      } else {
        setServerResponse('❌ Failed to send URL to phone');
      }
    });
  };

  // Handle keyboard enter in URL input
  const handleUrlKeyPress = (e) => {
    if (e.key === 'Enter') {
      validateAndSendUrl(videoUrl);
    }
  };


  return (
    <div className="app-container">
      <div className="header">
        <div className="brand">
          <div className="logo-circle">MV</div>
          <div>
            <h1>Multicast Video Dashboard</h1>
            <div className="small-muted">Send videos to connected Android devices</div>
          </div>
        </div>
        <div>
          <div className="small-muted">Connection: {isConnected ? 'Connected' : 'Disconnected'}</div>
          <div className="small-muted">Socket ID: {socket?.id || 'Not connected'}</div>
        </div>
      </div>

      <div className="main-grid">
        <div className="card">
          <h2>Sender</h2>

          {/* button to open file picker */}
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="video/*"
            onChange={handleFileSelect}
          />

          <div style={{ marginTop: 12 }}>
            <button className="send-btn" onClick={openFilePicker} title="Select a video file to send">Choose Video File</button>
          </div>

          {/* Video URL input section */}
          <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 16 }}>
            <div style={{ fontSize: '0.9em', fontWeight: 600, marginBottom: 8, color: '#06b6d4' }}>OR send video via URL:</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                onKeyPress={handleUrlKeyPress}
                placeholder="https://example.com/video.mp4"
                style={{ flex: 1, minWidth: 200 }}
              />
              <button
                className="send-btn"
                onClick={() => validateAndSendUrl(videoUrl)}
                disabled={!isConnected || !videoUrl.trim()}
                style={{ whiteSpace: 'nowrap' }}
              >
                Send URL to Phone
              </button>
            </div>
            {urlError && <div style={{ color: '#ff6b6b', fontSize: '0.85em', marginTop: 6 }}>{urlError}</div>}
          </div>

          {/* display selected video info */}
          {selectedVideo && (
            <div className={`selected-video ${!showSelectedInfo ? 'hidden' : ''}`} style={{ marginTop: 12 }}>
              {thumbnail && <img src={thumbnail} alt="thumb" style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8 }} />}
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700 }}>{selectedVideo.name}</div>
                <div className="small-muted">{formatBytes(selectedVideo.size)} • {selectedVideo.type || (selectedVideo.name.split('.').pop() || 'unknown')}</div>

                {/* Direct short URL (prominent) */}
                <div style={{ marginTop: 10 }}>
                  {directUploading ? (
                    <div>Generating short link…</div>
                  ) : (directUrl && (
                    <div className="link-box">
                      <a href={directUrl} target="_blank" rel="noreferrer">{directUrl}</a>
                      <button className="copy-btn" onClick={copyDirectUrl}>{copiedUrl ? 'Copied' : 'Copy URL'}</button>
                    </div>
                  ))}
                </div>

              </div>
            </div>
          )}

          {/* send video to mobile */}
          {selectedVideo && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 8 }}>
                <label style={{ marginRight: 8 }}>Target ID:</label>
                <input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="(optional) target client id" />
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="send-btn"
                  onClick={() => { setUploadBroadcast(false); sendVideoToMobileChunked(false); }}
                  disabled={!isConnected || uploading}
                >
                  {uploading && !isPaused ? 'Uploading...' : 'Send to Android Phone'}
                </button>

                <button
                  className="broadcast-btn"
                  onClick={() => { if (!selectedVideo) return; const ok = window.confirm('Send this upload to ALL connected clients?'); if (ok) { setUploadBroadcast(true); sendVideoToMobileChunked(true); } }}
                  disabled={!isConnected || uploading}
                >
                  Send to All Connected Clients
                </button>

                {/* pause/resume/cancel/retry controls */}
                {uploading && (
                  <>
                    {!isPaused ? (
                      <button onClick={pauseUpload}>⏸ Pause</button>
                    ) : (
                      <button onClick={resumeUpload}>▶ Resume</button>
                    )}
                    <button onClick={cancelUpload}>✖ Cancel</button>
                  </>
                )}

                {uploadError && (
                  <button onClick={retryUpload}>↻ Retry</button>
                )}
              </div>

              {/* show progress while uploading (hide when reaches 100%) */}
              {(uploadProgress > 0 && uploadProgress < 100) && (
                <div className="upload-progress">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${uploadProgress}%` }}></div>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <strong>{uploadProgress}%</strong> • {uploadSpeed}
                  </div>
                </div>
              )}

              {/* success message shown briefly */}
              {successMessage && (
                <div className="response-box" style={{ marginTop: 10 }}>
                  <strong>✓ {successMessage}</strong>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Phone Mockup */}
        {receivedVideo && (
          <div className="phone-mockup-container">
            <div className="phone-mockup">
              {/* Phone frame */}
              <div className="phone-frame">
                {/* Status bar */}
                <div className="phone-status-bar">
                  <span>9:41</span>
                  <div className="phone-status-icons">
                    <span>📶</span>
                    <span>🔋</span>
                  </div>
                </div>

                {/* Video display */}
                <div className="phone-video-container">
                  <video
                    src={receivedVideo.url}
                    controls
                    autoPlay
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onPlay={() => setVideoPlaying(true)}
                    onEnded={() => setVideoPlaying(false)}
                  />
                </div>
              </div>

              {/* Phone notch */}
              <div className="phone-notch"></div>
            </div>

            {/* Video info */}
            <div style={{ marginTop: 12, textAlign: 'center', color: '#fff' }}>
              <p style={{ fontSize: 12, margin: '4px 0' }}>📱 {receivedVideo.name}</p>
              <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>{videoPlaying ? '▶ Playing...' : 'Ready'}</p>
              <button
                onClick={() => setReceivedVideo(null)}
                style={{ marginTop: 8, padding: '6px 12px', borderRadius: 4, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 12 }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        <div className="card">
          <h2>Controls</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => { if (socket) { socket.emit('test', 'test msg from web'); alert('message sent'); } }} className="copy-btn">Send Test Message</button>

            <div style={{ marginTop: 12 }}>
              <div className="small-muted">Connected devices:</div>
              {clients.length === 0 ? (
                <div className="response-box" style={{ marginTop: 6 }}>No clients connected</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                  {clients.map(c => (
                    <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontSize: 12 }}><strong>{c.device || 'unknown'}</strong> • <code style={{ fontSize: 11 }}>{c.id.substring(0, 8)}</code></div>
                      <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(c.id); setServerResponse('Copied ID'); }}>Copy ID</button>
                      <button className="copy-btn" onClick={() => { setTargetId(c.id); setServerResponse(`Target set to ${c.id.substring(0, 8)}`); }}>Set Target</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="small-muted" style={{ marginTop: 12 }}>Server response:</div>
            {serverResponse && <div className="response-box"><p style={{ margin: 0 }}>{serverResponse}</p><p style={{ marginTop: 8, fontSize: 12 }}><small>🕐 {new Date().toLocaleTimeString()}</small></p></div>}
          </div>


        </div>
      </div>
    </div>
  );
}

export default App;